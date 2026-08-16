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

export function originCheck(req, res, next) {
  if (SAFE.has(req.method)) return next();
  if (config.isDev || config.isTest) return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  const allowed = [config.corsOrigin, config.appUrl, `http://127.0.0.1:${config.port}`].filter(Boolean);
  if (allowed.length && origin && !allowed.some((o) => origin.startsWith(String(o).replace(/\/$/, "")))) {
    return next(new HttpError(403, "Origin مجاز نیست", "origin"));
  }
  next();
}
