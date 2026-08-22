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
import { inferCityFromName } from "../finder/cities.js";

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
      sessionId: row?.id || null,
      label: row?.label || null,
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
    return this.qrDataUrl || null;
  }

  sessionDir() {
    return path.join(config.paths.sessions, this.sessionKey);
  }

  async waitForQr(ms = 15000) {
    const started = Date.now();
    while (Date.now() - started < ms) {
      if (this.qrDataUrl) return this.qrDataUrl;
      if (this.status === "connected" || this.status === "authentication_failed") return null;
      await new Promise((r) => setTimeout(r, 250));
    }
    return this.qrDataUrl;
  }

  async start({ force = false } = {}) {
    if (this.starting) {
      await this.waitForQr(8000);
      return;
    }
    if (this.sock && !force && (this.status === "connected" || this.status === "qr_required")) return;
    if (this.sock) {
      try {
        this.sock.ev.removeAllListeners();
        this.sock.ws?.close();
      } catch {
        /* ignore */
      }
      this.sock = null;
    }
    this.starting = true;
    this.shouldReconnect = true;
    fs.mkdirSync(this.sessionDir(), { recursive: true });
    this.setStatus(this.hasAuthFiles() ? "reconnecting" : "connecting");
    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir());
      const { version } = await Promise.race([
        fetchLatestBaileysVersion(),
        new Promise((resolve) => setTimeout(() => resolve({ version: [2, 3000, 1027934701] }), 5000))
      ]).catch(() => ({ version: [2, 3000, 1027934701] }));
      this.sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: Browsers.ubuntu("Chrome"),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        connectTimeoutMs: 25000
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
      this.emit("qr", { hasQr: true, sessionKey: this.sessionKey });
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

  messageBody(msg) {
    const m = msg.message || {};
    return (
      m.conversation ||
      m.extendedTextMessage?.text ||
      m.imageMessage?.caption ||
      m.videoMessage?.caption ||
      m.documentMessage?.caption ||
      ""
    );
  }

  async onMessages(upsert) {
    if (upsert.type !== "notify" && upsert.type !== "append") return;
    for (const msg of upsert.messages || []) {
      if (!msg.message) continue;
      const chatId = msg.key.remoteJid;
      if (!chatId || chatId === "status@broadcast") continue;
      const body = this.messageBody(msg);
      const fromMe = Boolean(msg.key.fromMe);
      const chatType = isGroupJid(chatId) ? "group" : "contact";
      const senderJid = chatType === "group" ? msg.key.participant || "" : chatId;
      const senderName = msg.pushName || "";
      const session = this.row();
      let chatName = chatId;
      try {
        if (chatType === "group") {
          const cached = getDb()
            .prepare("SELECT name FROM groups WHERE session_id = ? AND wa_id = ?")
            .get(session.id, chatId);
          chatName = cached?.name || chatId;
          if (!cached && this.sock) {
            const meta = await this.sock.groupMetadata(chatId);
            chatName = meta.subject;
          }
        } else {
          chatName = senderName || jidToPhone(chatId);
        }
      } catch {
        chatName = senderName || jidToPhone(chatId);
      }

      if (chatType === "group") {
        getDb()
          .prepare(
            `UPDATE groups SET last_activity_at = datetime('now'), updated_at = datetime('now')
             WHERE session_id = ? AND wa_id = ?`
          )
          .run(session.id, chatId);
        if (body) {
          this.emit("group-message", {
            sessionKey: this.sessionKey,
            chatId,
            chatName,
            body,
            senderJid,
            senderName,
            fromMe
          });
        }
      }

      if (fromMe) continue;
      getDb()
        .prepare(
          `INSERT INTO inbox_messages
           (session_id, chat_id, chat_name, chat_type, direction, body, unread, wa_message_id)
           VALUES (?, ?, ?, ?, 'in', ?, 1, ?)`
        )
        .run(session.id, chatId, chatName, chatType, String(body).slice(0, 8000), msg.key.id || null);
      this.emit("inbox", { sessionKey: this.sessionKey, chatId, chatName, chatType, body });
      if (chatType === "contact") {
        this.emit("private-message", { sessionKey: this.sessionKey, chatId, chatName, body, senderName });
      }
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
      INSERT INTO groups (session_id, wa_id, name, member_count, admin_count, city, last_activity_at, membership_status, is_admin, updated_at)
      VALUES (@session_id, @wa_id, @name, @member_count, @admin_count, @city, @last_activity_at, 'member', @is_admin, datetime('now'))
      ON CONFLICT(session_id, wa_id) DO UPDATE SET
        name = excluded.name,
        member_count = excluded.member_count,
        admin_count = excluded.admin_count,
        city = CASE WHEN groups.city = 'سایر' THEN excluded.city ELSE groups.city END,
        last_activity_at = COALESCE(excluded.last_activity_at, groups.last_activity_at),
        membership_status = 'member',
        is_admin = excluded.is_admin,
        updated_at = datetime('now')
    `);
    const seen = [];
    for (const [jid, meta] of Object.entries(participating || {})) {
      const participants = meta.participants || [];
      const self = participants.find((p) => jidToPhone(p.id) === mePhone || p.id === me);
      const isAdmin = self?.admin === "admin" || self?.admin === "superadmin" ? 1 : 0;
      const adminCount = participants.filter((p) => p.admin === "admin" || p.admin === "superadmin").length;
      const ts = meta.conversationTimestamp ? Number(meta.conversationTimestamp) : 0;
      const lastActivityAt = ts
        ? new Date(ts > 1e12 ? ts : ts * 1000).toISOString().replace("T", " ").slice(0, 19)
        : null;
      upsert.run({
        session_id: session.id,
        wa_id: jid,
        name: meta.subject || "بدون نام",
        member_count: participants.length || meta.size || null,
        admin_count: adminCount,
        city: inferCityFromName(meta.subject || ""),
        last_activity_at: lastActivityAt,
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
    this.emit("groups-synced");
    return this.listGroups();
  }

  async fetchGroupAdmins(waId) {
    this.assertConnected();
    if (!isGroupJid(waId)) {
      const err = new Error("Destination is not a group");
      err.code = "not_group";
      throw err;
    }
    const meta = await this.sock.groupMetadata(waId);
    const participants = meta.participants || [];
    const admins = participants.filter((p) => p.admin === "admin" || p.admin === "superadmin");
    const ts = meta.conversationTimestamp ? Number(meta.conversationTimestamp) : 0;
    const lastActivityAt = ts
      ? new Date(ts > 1e12 ? ts : ts * 1000).toISOString().replace("T", " ").slice(0, 19)
      : null;
    return {
      subject: meta.subject || "",
      size: meta.size || participants.length,
      adminCount: admins.length,
      lastActivityAt,
      admins: admins.map((p) => ({
        jid: p.id,
        displayName: p.name || p.notify || "",
        role: p.admin
      }))
    };
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
    const session =
      this.row() || getDb().prepare("SELECT * FROM whatsapp_sessions WHERE session_key = 'default'").get();
    if (!session) return [];

    const decorate = (row) => ({
      ...row,
      last_activity_at: row.activity_at || row.last_activity_at || null
    });

    const run = (sql, params) => getDb().prepare(sql).all(...params).map(decorate);

    const extra = [];
    const extraParams = [];
    if (q) {
      extra.push(" AND (g.name LIKE ? OR IFNULL(g.city, '') LIKE ?)");
      extraParams.push(`%${q}%`, `%${q}%`);
    }
    if (favorite === true || favorite === "1") extra.push(" AND g.is_favorite = 1");
    if (admin === true || admin === "1") extra.push(" AND g.is_admin = 1");
    const extraSql = extra.join("");

    const select = `SELECT g.*,
         COALESCE(
           g.last_activity_at,
           (SELECT MAX(created_at) FROM inbox_messages im WHERE im.chat_id = g.wa_id)
         ) AS activity_at,
         COALESCE(gp.advertising_permission, g.advertising_permission, 'unknown') AS advertising_permission
       FROM groups g
       LEFT JOIN group_permissions gp ON gp.group_id = g.id`;
    const order = " ORDER BY activity_at DESC, g.is_favorite DESC, g.name COLLATE NOCASE ASC";

    try {
      return run(
        `${select} WHERE g.session_id = ? AND g.membership_status = 'member'${extraSql}${order}`,
        [session.id, ...extraParams]
      );
    } catch (err) {
      logger.warn({ err: err.message }, "group list query failed; using simple membership list");
      const rows = getDb()
        .prepare(
          `SELECT * FROM groups WHERE session_id = ? AND membership_status = 'member' ORDER BY name COLLATE NOCASE ASC`
        )
        .all(session.id);
      return rows.sort((a, b) => String(b.last_activity_at || "").localeCompare(String(a.last_activity_at || "")));
    }
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

  async collectInviteSourceTexts(group) {
    const texts = [];
    const inbox = getDb()
      .prepare("SELECT body FROM inbox_messages WHERE chat_id = ? ORDER BY id DESC LIMIT 80")
      .all(group.wa_id);
    for (const row of inbox) {
      if (row.body) texts.push(String(row.body));
    }
    if (this.isConnected() && this.sock?.groupMetadata) {
      try {
        const meta = await this.sock.groupMetadata(group.wa_id);
        if (meta.desc) texts.push(String(meta.desc));
        if (meta.subject) texts.push(String(meta.subject));
        if (meta.inviteCode) texts.push(`https://chat.whatsapp.com/${meta.inviteCode}`);
      } catch {
        /* description may be hidden */
      }
    }
    return texts;
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
  binders: [],
  onClient(fn) {
    this.binders.push(fn);
    for (const client of this.clients.values()) fn(client);
  },
  get(sessionKey = "default") {
    if (!this.clients.has(sessionKey)) {
      const client = new WhatsAppService(sessionKey);
      this.clients.set(sessionKey, client);
      for (const fn of this.binders) fn(client);
    }
    return this.clients.get(sessionKey);
  },
  byId(sessionId) {
    const row = getDb().prepare("SELECT * FROM whatsapp_sessions WHERE id = ?").get(Number(sessionId));
    if (!row) return null;
    return this.get(row.session_key);
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
