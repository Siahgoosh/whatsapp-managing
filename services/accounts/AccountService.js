import crypto from "node:crypto";
import { getDb } from "../../database/index.js";
import { config } from "../../config/index.js";
import { HttpError } from "../../backend/src/utils/errors.js";
import { waManager } from "../whatsapp/WhatsAppService.js";

function parseData(raw) {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

function sessionRow(idOrKey) {
  if (idOrKey == null || idOrKey === "") return null;
  if (typeof idOrKey === "number" || /^\d+$/.test(String(idOrKey))) {
    return getDb().prepare("SELECT * FROM whatsapp_sessions WHERE id = ?").get(Number(idOrKey));
  }
  return getDb().prepare("SELECT * FROM whatsapp_sessions WHERE session_key = ?").get(String(idOrKey));
}

export function defaultSession() {
  return (
    getDb().prepare("SELECT * FROM whatsapp_sessions WHERE session_key = 'default'").get() ||
    getDb().prepare("SELECT * FROM whatsapp_sessions ORDER BY id ASC LIMIT 1").get()
  );
}

export function summarize(row) {
  if (!row) return null;
  const live = waManager.get(row.session_key).publicStatus();
  return {
    id: row.id,
    sessionKey: row.session_key,
    label: row.label,
    phone: live.phone || row.phone,
    accountName: live.accountName || row.account_name,
    status: live.status || row.status,
    lastConnectedAt: live.lastConnectedAt || row.last_connected_at,
    hasQr: live.hasQr
  };
}

export function listAccounts() {
  return getDb()
    .prepare(
      "SELECT id, session_key, label, phone, account_name, status, last_connected_at FROM whatsapp_sessions ORDER BY id ASC"
    )
    .all()
    .map(summarize);
}

export function accountsForUser(user) {
  const all = listAccounts();
  if (!user) return [];
  if (user.role === "admin") return all;
  const assigned = Number(user.whatsapp_session_id) || defaultSession()?.id;
  return all.filter((a) => a.id === assigned);
}

export function canUseAccount(user, sessionId) {
  return accountsForUser(user).some((a) => a.id === Number(sessionId));
}

export function resolveAccount(req) {
  const allowed = accountsForUser(req.user);
  if (!allowed.length) {
    const def = defaultSession();
    return def ? summarize(def) : null;
  }
  const data = parseData(req.sessionRow?.data);
  const wanted = Number(data.activeSessionId) || Number(req.user.whatsapp_session_id) || allowed[0].id;
  return allowed.find((a) => a.id === wanted) || allowed[0];
}

export function setActiveAccount(req, sessionId) {
  if (!canUseAccount(req.user, sessionId)) throw new HttpError(403, "این اکانت واتساپ برای شما مجاز نیست");
  const data = { ...parseData(req.sessionRow?.data), activeSessionId: Number(sessionId) };
  getDb().prepare("UPDATE sessions SET data = ? WHERE sid = ?").run(JSON.stringify(data), req.sessionId);
  if (req.user.role !== "admin") {
    getDb().prepare("UPDATE users SET whatsapp_session_id = ? WHERE id = ?").run(Number(sessionId), req.user.id);
  }
  return resolveAccount({ ...req, sessionRow: { ...req.sessionRow, data: JSON.stringify(data) } });
}

export function createAccount(label) {
  const count = getDb().prepare("SELECT COUNT(*) AS c FROM whatsapp_sessions").get().c;
  if (count >= config.maxWhatsAppAccounts) {
    throw new HttpError(400, `حداکثر ${config.maxWhatsAppAccounts} اکانت واتساپ`);
  }
  const name = String(label || "").trim().slice(0, 40) || `اکانت ${count + 1}`;
  const key = `wa_${crypto.randomBytes(4).toString("hex")}`;
  const info = getDb()
    .prepare("INSERT INTO whatsapp_sessions (session_key, label, status) VALUES (?, ?, 'disconnected')")
    .run(key, name);
  const row = getDb().prepare("SELECT * FROM whatsapp_sessions WHERE id = ?").get(Number(info.lastInsertRowid));
  waManager.get(row.session_key);
  return summarize(row);
}

export function renameAccount(id, label) {
  const row = sessionRow(id);
  if (!row) throw new HttpError(404, "اکانت پیدا نشد");
  const name = String(label || "").trim().slice(0, 40);
  if (!name) throw new HttpError(400, "نام اکانت لازم است");
  getDb().prepare("UPDATE whatsapp_sessions SET label = ?, updated_at = datetime('now') WHERE id = ?").run(name, row.id);
  return summarize(sessionRow(row.id));
}

export function assignUserAccount(userId, sessionId) {
  const user = getDb().prepare("SELECT * FROM users WHERE id = ?").get(Number(userId));
  if (!user) throw new HttpError(404, "کاربر پیدا نشد");
  const row = sessionRow(sessionId);
  if (!row) throw new HttpError(404, "اکانت واتساپ پیدا نشد");
  getDb().prepare("UPDATE users SET whatsapp_session_id = ? WHERE id = ?").run(row.id, user.id);
  return { userId: user.id, whatsappSessionId: row.id };
}

export function clientFor(account) {
  if (!account?.sessionKey && !account?.session_key) return waManager.primary();
  return waManager.get(account.sessionKey || account.session_key);
}

export function withAccount(req) {
  const account = resolveAccount(req);
  if (!account) throw new HttpError(400, "اکانت واتساپ پیدا نشد");
  return { account, wa: clientFor(account) };
}

export function accountState(req) {
  if (!req?.user) return { account: null, accounts: [] };
  return { account: resolveAccount(req), accounts: accountsForUser(req.user) };
}

export { sessionRow };
