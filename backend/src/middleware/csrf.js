import { HttpError } from "../utils/errors.js";
import { config } from "../../../config/index.js";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export function csrfProtect(req, res, next) {
  if (SAFE.has(req.method)) return next();
  if (req.path === "/api/auth/login") return next();
  if (!req.user) return next();
  const token = req.headers["x-csrf-token"];
  if (!token || token !== req.csrfToken) {
    return next(new HttpError(403, "توکن امنیتی نامعتبر است", "csrf"));
  }
  next();
}

export function isAllowedOrigin(origin) {
  if (!origin) return true;
  const normalized = String(origin).replace(/\/$/, "");
  const allowed = [config.corsOrigin, config.appUrl, `http://127.0.0.1:${config.port}`, `http://localhost:${config.port}`]
    .filter(Boolean)
    .map((o) => String(o).replace(/\/$/, ""));
  if (allowed.includes(normalized)) return true;
  try {
    const u = new URL(origin);
    return String(u.port || (u.protocol === "https:" ? "443" : "80")) === String(config.port);
  } catch {
    return false;
  }
}

export function originCheck(req, res, next) {
  if (SAFE.has(req.method)) return next();
  if (config.isDev || config.isTest) return next();
  if (!isAllowedOrigin(req.headers.origin)) {
    return next(new HttpError(403, "Origin مجاز نیست", "origin"));
  }
  next();
}
