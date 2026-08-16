import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import qrcode from "qrcode";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { config } from "../../config/index.js";
import { getDb } from "../../database/index.js";
import { logger, systemLog } from "../../backend/src/utils/logger.js";
import { nowSql } from "../../backend/src/utils/persian.js";
import { absUpload } from "../../backend/src/utils/files.js";

const STATUSES = [
  "disconnected",
  "connecting",
  "qr_required",
  "connected",
  "reconnecting",
  "authentication_failed"
];

function jidToPhone(jid = "") {
  return String(jid).split("@")[0].split(":")[0];
}

function isGroupJid(jid = "") {
  return String(jid).endsWith("@g.us");
}

export class WhatsAppService extends EventEmitter {
  constructor(sessionKey = "default") {
    super();
    this.sessionKey = sessionKey;
    this.sock = null;
    this.qrDataUrl = null;
    this.status = "disconnected";
    this.starting = false;
    this.shouldReconnect = true;
    this.rowId = null;
  }

  row() {
    return getDb()
      .prepare("SELECT * FROM whatsapp_sessions WHERE session_key = ?")
      .get(this.sessionKey);
  }

  setStatus(status, extra = {}) {
    if (!STATUSES.includes(status)) return;
    this.status = status;
    const now = nowSql();
    const fields = { status, updated_at: now, ...extra };
    const keys = Object.keys(fields);
    const sql = `UPDATE whatsapp_sessions SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE session_key = ?`;
    getDb()
      .prepare(sql)
      .run(...keys.map((k) => fields[k]), this.sessionKey);
    this.emit("status", this.publicStatus());
  }

  publicStatus() {
    const row = this.row();
    const connectedAt = row?.connected_at ? new Date(row.connected_at.replace(" ", "T") + "Z") : null;
    const durationMs = row?.status === "connected" && connectedAt ? Date.now() - connectedAt.getTime() : 0;
    return {
      sessionKey: this.sessionKey,
      status: row?.status || this.status,
      phone: row?.phone || null,
      accountName: row?.account_name || null,
      lastConnectedAt: row?.last_connected_at || null,
      connectedAt: row?.connected_at || null,
      sessionDurationMs: durationMs,
      lastError: row?.last_error || null,
      hasQr: Boolean(this.qrDataUrl) && (row?.status === "qr_required" || this.status === "qr_required")
    };
  }

  getQr() {
    if (this.status !== "qr_required" && this.status !== "connecting") return null;
    return this.qrDataUrl;
  }

  sessionDir() {
    return path.join(config.paths.sessions, this.sessionKey);
  }

  async start() {
    if (this.starting || this.sock) return;
    this.starting = true;
    this.shouldReconnect = true;
    fs.mkdirSync(this.sessionDir(), { recursive: true });
    this.setStatus(this.hasAuthFiles() ? "reconnecting" : "connecting");
    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir());
      const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1027934701] }));
      this.sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: Browsers.ubuntu("Chrome"),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false
      });
      this.sock.ev.on("creds.update", saveCreds);
      this.sock.ev.on("connection.update", (u) => this.onConnection(u));
      this.sock.ev.on("messages.upsert", (m) => this.onMessages(m));
      systemLog("whatsapp_connect_start", "WhatsApp connection started");
    } catch (err) {
      logger.error({ err: err.message }, "whatsapp start failed");
      this.setStatus("disconnected", { last_error: "start_failed" });
      this.sock = null;
    } finally {
      this.starting = false;
    }
  }

  hasAuthFiles() {
    return fs.existsSync(path.join(this.sessionDir(), "creds.json"));
  }

  async onConnection(update) {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      this.qrDataUrl = await qrcode.toDataURL(qr, { margin: 1, width: 320 });
      this.setStatus("qr_required", { last_qr_at: nowSql(), last_error: null });
      this.emit("qr", { hasQr: true });
      systemLog("qr_generated", "QR generated for WhatsApp login");
    }
    if (connection === "open") {
      this.qrDataUrl = null;
      const phone = jidToPhone(this.sock?.user?.id || "");
      const accountName = this.sock?.user?.name || this.sock?.user?.notify || "";
      const ts = nowSql();
      this.setStatus("connected", {
        phone,
        account_name: accountName,
        last_connected_at: ts,
        connected_at: ts,
        last_error: null
      });
      systemLog("whatsapp_connected", `Connected as ${accountName || phone}`);
      this.emit("connected");
      this.syncGroups().catch((e) => logger.warn({ err: e.message }, "group sync failed"));
    }
    if (connection === "close") {
      this.qrDataUrl = null;
      const code = lastDisconnect?.error instanceof Boom ? lastDisconnect.error.output?.statusCode : 0;
      const loggedOut = code === DisconnectReason.loggedOut;
      this.sock = null;
      if (loggedOut) {
        this.shouldReconnect = false;
        this.setStatus("authentication_failed", { last_error: "logged_out", connected_at: null });
        systemLog("whatsapp_auth_failed", "WhatsApp authentication failed / logged out");
        this.emit("disconnected", { reason: "authentication_failed" });
        return;
      }
      this.setStatus("reconnecting", { last_error: "connection_closed" });
      systemLog("whatsapp_disconnected", "WhatsApp disconnected, reconnecting");
      this.emit("disconnected", { reason: "reconnecting" });
      if (this.shouldReconnect) {
        setTimeout(() => this.start().catch(() => {}), 4000);
      }
    }
  }

  async onMessages(upsert) {
    if (upsert.type !== "notify") return;
    for (const msg of upsert.messages || []) {
      if (!msg.message || msg.key.fromMe) continue;
      const chatId = msg.key.remoteJid;
      if (!chatId || chatId === "status@broadcast") continue;
      const body =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        msg.message.videoMessage?.caption ||
        "";
      const chatType = isGroupJid(chatId) ? "group" : "contact";
      const session = this.row();
      let chatName = chatId;
      try {
        if (chatType === "group") {
          const meta = await this.sock.groupMetadata(chatId);
          chatName = meta.subject;
        } else {
          chatName = msg.pushName || jidToPhone(chatId);
        }
      } catch {
        chatName = msg.pushName || jidToPhone(chatId);
      }
      getDb()
        .prepare(
          `INSERT INTO inbox_messages
           (session_id, chat_id, chat_name, chat_type, direction, body, unread, wa_message_id)
           VALUES (?, ?, ?, ?, 'in', ?, 1, ?)`
        )
        .run(session.id, chatId, chatName, chatType, String(body).slice(0, 8000), msg.key.id || null);
      this.emit("inbox", { chatId, chatName, chatType, body });
    }
  }

  async logout() {
    this.shouldReconnect = false;
    try {
      if (this.sock) await this.sock.logout();
    } catch {
      /* ignore */
    }
    this.sock = null;
    this.qrDataUrl = null;
    try {
      fs.rmSync(this.sessionDir(), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    this.setStatus("disconnected", {
      phone: null,
      account_name: null,
      connected_at: null,
      last_error: null
    });
    systemLog("whatsapp_logout", "WhatsApp session logged out");
  }

  isConnected() {
    return this.status === "connected" && Boolean(this.sock);
  }

  assertConnected() {
    if (!this.isConnected()) {
      const err = new Error("WhatsApp is not connected");
      err.code = "not_connected";
      throw err;
    }
  }

  async syncGroups() {
    this.assertConnected();
    const session = this.row();
    const participating = await this.sock.groupFetchAllParticipating();
    const me = this.sock.user?.id;
    const mePhone = jidToPhone(me);
    const upsert = getDb().prepare(`
      INSERT INTO groups (session_id, wa_id, name, member_count, membership_status, is_admin, updated_at)
      VALUES (@session_id, @wa_id, @name, @member_count, 'member', @is_admin, datetime('now'))
      ON CONFLICT(session_id, wa_id) DO UPDATE SET
        name = excluded.name,
        member_count = excluded.member_count,
        membership_status = 'member',
        is_admin = excluded.is_admin,
        updated_at = datetime('now')
    `);
    const seen = [];
    for (const [jid, meta] of Object.entries(participating || {})) {
      const participants = meta.participants || [];
      const self = participants.find((p) => jidToPhone(p.id) === mePhone || p.id === me);
      const isAdmin = self?.admin === "admin" || self?.admin === "superadmin" ? 1 : 0;
      upsert.run({
        session_id: session.id,
        wa_id: jid,
        name: meta.subject || "بدون نام",
        member_count: participants.length || meta.size || null,
        is_admin: isAdmin
      });
      seen.push(jid);
      this.refreshPicture(session.id, jid).catch(() => {});
    }
    if (seen.length) {
      const placeholders = seen.map(() => "?").join(",");
      getDb()
        .prepare(
          `UPDATE groups SET membership_status = 'left', updated_at = datetime('now')
           WHERE session_id = ? AND wa_id NOT IN (${placeholders})`
        )
        .run(session.id, ...seen);
    }
    return this.listGroups();
  }

  async refreshPicture(sessionId, jid) {
    try {
      const url = await this.sock.profilePictureUrl(jid, "image");
      if (!url) return;
      const res = await fetch(url);
      if (!res.ok) return;
      const buf = Buffer.from(await res.arrayBuffer());
      const rel = path.join("groups", `${sessionId}-${jid.replace(/[^a-zA-Z0-9]/g, "_")}.jpg`);
      const abs = path.join(config.paths.uploads, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, buf);
      getDb().prepare("UPDATE groups SET picture_path = ? WHERE session_id = ? AND wa_id = ?").run(rel, sessionId, jid);
    } catch {
      /* picture may be hidden */
    }
  }

  listGroups({ q = "", favorite, admin } = {}) {
    const session = this.row();
    let sql = "SELECT * FROM groups WHERE session_id = ? AND membership_status = 'member'";
    const params = [session.id];
    if (q) {
      sql += " AND name LIKE ?";
      params.push(`%${q}%`);
    }
    if (favorite === true || favorite === "1") sql += " AND is_favorite = 1";
    if (admin === true || admin === "1") sql += " AND is_admin = 1";
    sql += " ORDER BY is_favorite DESC, name COLLATE NOCASE ASC";
    return getDb().prepare(sql).all(...params);
  }

  async sendToGroup({ waId, text, caption, attachmentRel }) {
    this.assertConnected();
    if (!isGroupJid(waId)) {
      const err = new Error("Destination is not a group the account belongs to");
      err.code = "not_group";
      throw err;
    }
    const session = this.row();
    const group = getDb()
      .prepare("SELECT * FROM groups WHERE session_id = ? AND wa_id = ? AND membership_status = 'member'")
      .get(session.id, waId);
    if (!group) {
      const err = new Error("Account is not a member of this group");
      err.code = "not_member";
      throw err;
    }
    let result;
    if (attachmentRel) {
      const abs = absUpload(attachmentRel);
      const buffer = fs.readFileSync(abs);
      const mimeGuess = mimeFromName(attachmentRel);
      const cap = caption || text || "";
      if (mimeGuess.startsWith("image/")) {
        result = await this.sock.sendMessage(waId, { image: buffer, caption: cap });
      } else if (mimeGuess.startsWith("video/")) {
        result = await this.sock.sendMessage(waId, { video: buffer, caption: cap });
      } else {
        result = await this.sock.sendMessage(waId, {
          document: buffer,
          mimetype: mimeGuess,
          fileName: path.basename(attachmentRel),
          caption: cap
        });
        if (text && text !== cap) {
          await this.sock.sendMessage(waId, { text });
        }
      }
    } else {
      result = await this.sock.sendMessage(waId, { text: text || "" });
    }
    return result;
  }

  async sendChat({ chatId, text }) {
    this.assertConnected();
    return this.sock.sendMessage(chatId, { text });
  }
}

function mimeFromName(name) {
  const ext = path.extname(name).toLowerCase();
  const map = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".mp4": "video/mp4",
    ".pdf": "application/pdf"
  };
  return map[ext] || "application/octet-stream";
}

export const waManager = {
  clients: new Map(),
  get(sessionKey = "default") {
    if (!this.clients.has(sessionKey)) {
      this.clients.set(sessionKey, new WhatsAppService(sessionKey));
    }
    return this.clients.get(sessionKey);
  },
  primary() {
    return this.get("default");
  },
  async startAll() {
    const rows = getDb().prepare("SELECT session_key FROM whatsapp_sessions").all();
    for (const row of rows) {
      const client = this.get(row.session_key);
      if (client.hasAuthFiles()) await client.start();
    }
  }
};
