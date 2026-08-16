import { sessionStore } from "./sessionStore.js";
import { config } from "../../../config/index.js";
import { getDb } from "../../../database/index.js";
import { HttpError } from "../utils/errors.js";

export function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = decodeURIComponent(part.slice(idx + 1).trim());
    out[k] = v;
  }
  return out;
}

export function attachSession(req, res, next) {
  const cookies = parseCookies(req.headers.cookie || "");
  req.sessionId = cookies[config.sessionCookieName] || null;
  req.sessionRow = req.sessionId ? sessionStore.get().get(req.sessionId) : null;
  req.user = null;
  if (req.sessionRow?.user_id) {
    req.user = getDb()
      .prepare("SELECT id, username, display_name, role, active FROM users WHERE id = ?")
      .get(req.sessionRow.user_id);
    if (req.user && !req.user.active) req.user = null;
    if (req.user) sessionStore.get().touch(req.sessionId);
  }
  req.csrfToken = req.sessionRow?.csrf_secret || null;
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return next(new HttpError(401, "ورود لازم است", "unauthenticated"));
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(new HttpError(401, "ورود لازم است", "unauthenticated"));
    if (!roles.includes(req.user.role)) return next(new HttpError(403, "دسترسی کافی نیست", "forbidden"));
    next();
  };
}

export function setSessionCookie(res, sid, expiresAt) {
  const parts = [
    `${config.sessionCookieName}=${sid}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor((expiresAt - Date.now()) / 1000)}`
  ];
  if (!config.isDev && !config.isTest) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(res) {
  res.append(
    "Set-Cookie",
    `${config.sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}
