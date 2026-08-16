import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "../../../config/index.js";

export function securityHeaders() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "img-src": ["'self'", "data:", "blob:"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "script-src": ["'self'"],
        "connect-src": ["'self'", "ws:", "wss:"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "frame-ancestors": ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false
  });
}

export function apiLimiter() {
  if (config.isTest) return (_req, _res, next) => next();
  return rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "تعداد درخواست‌ها بیش از حد مجاز است" }
  });
}

export function loginLimiter() {
  if (config.isTest) return (_req, _res, next) => next();
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: config.loginRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "تلاش ورود بیش از حد. کمی بعد دوباره تلاش کنید." }
  });
}
