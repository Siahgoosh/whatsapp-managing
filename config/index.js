import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(rootDir, ".env") });

function env(name, fallback = "") {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function envInt(name, fallback) {
  const n = Number.parseInt(env(name, String(fallback)), 10);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name, fallback = false) {
  const raw = env(name, "").toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes";
}

const isTestEnv = env("NODE_ENV", "production") === "test";
const minDelay = isTestEnv ? envInt("MIN_DELAY_SECONDS", 0) : Math.max(3, envInt("MIN_DELAY_SECONDS", 3));
const maxDelay = Math.max(minDelay || 1, envInt("MAX_DELAY_SECONDS", 30));

export const config = {
  rootDir,
  nodeEnv: env("NODE_ENV", "production"),
  isDev: env("NODE_ENV", "production") === "development",
  isTest: env("NODE_ENV", "production") === "test",
  port: envInt("PORT", 9454),
  appName: env("APP_NAME", "WhatsApp Campaign Manager"),
  appUrl: env("APP_URL", "http://localhost:9454"),
  isHttps: env("APP_URL", "http://localhost:9454").startsWith("https://"),
  tz: env("TZ", "Asia/Tehran"),
  adminUsername: env("ADMIN_USERNAME", "admin"),
  adminPassword: env("ADMIN_PASSWORD", "ChangeMe_9454!"),
  sessionSecret: env("SESSION_SECRET", "dev-only-change-me"),
  sessionCookieName: env("SESSION_COOKIE_NAME", "wcm.sid"),
  sessionMaxAgeMs: envInt("SESSION_MAX_AGE_HOURS", 24) * 60 * 60 * 1000,
  corsOrigin: env("CORS_ORIGIN", env("APP_URL", "http://localhost:9454")),
  rateLimitWindowMs: envInt("RATE_LIMIT_WINDOW_MS", 60_000),
  rateLimitMax: envInt("RATE_LIMIT_MAX", 120),
  loginRateLimitMax: envInt("LOGIN_RATE_LIMIT_MAX", 8),
  maxUploadBytes: envInt("MAX_UPLOAD_MB", 16) * 1024 * 1024,
  minDelaySeconds: minDelay,
  maxDelaySeconds: maxDelay,
  defaultDelaySeconds: Math.min(maxDelay, Math.max(minDelay, envInt("DEFAULT_DELAY_SECONDS", 5))),
  maxRetryAttempts: Math.max(0, envInt("MAX_RETRY_ATTEMPTS", 1)),
  retryWaitSeconds: envInt("RETRY_WAIT_SECONDS", 12),
  maxConsecutiveFailures: envInt("MAX_CONSECUTIVE_FAILURES", 5),
  aiEnabled: envBool("AI_ENABLED", false),
  aiApiKey: env("AI_API_KEY", ""),
  aiBaseUrl: env("AI_BASE_URL", "https://api.openai.com/v1").replace(/\/$/, ""),
  aiModel: env("AI_MODEL", "gpt-4o-mini"),
  telegramEnabled: envBool("TELEGRAM_ENABLED", false),
  telegramBotToken: env("TELEGRAM_BOT_TOKEN", ""),
  telegramChatId: env("TELEGRAM_CHAT_ID", ""),
  logLevel: env("LOG_LEVEL", "info"),
  finder: {
    googleKey: env("GOOGLE_CSE_API_KEY", ""),
    googleCx: env("GOOGLE_CSE_CX", ""),
    bingKey: env("BING_SEARCH_API_KEY", ""),
    customUrl: env("SEARCH_CUSTOM_URL", ""),
    customHeader: env("SEARCH_CUSTOM_HEADER", ""),
    crawlDelayMs: envInt("FINDER_CRAWL_DELAY_MS", 2000),
    maxPagesPerScan: envInt("FINDER_MAX_PAGES_PER_SCAN", 20),
    maxResultsPerQuery: envInt("FINDER_MAX_RESULTS_PER_QUERY", 8),
    requestTimeoutMs: envInt("FINDER_TIMEOUT_MS", 8000)
  },
  paths: {
    data: path.join(rootDir, "database"),
    sqlite: path.join(rootDir, "database", "app.sqlite"),
    uploads: path.join(rootDir, "uploads"),
    logs: path.join(rootDir, env("LOG_DIR", "logs")),
    sessions: path.join(rootDir, "sessions"),
    frontendDist: path.join(rootDir, "frontend", "dist")
  },
  allowedMime: new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "video/mp4",
    "application/pdf",
    "audio/mpeg",
    "audio/ogg",
    "audio/opus",
    "image/gif"
  ]),
  allowedExt: new Set([
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".mp4",
    ".pdf",
    ".mp3",
    ".ogg",
    ".opus",
    ".gif"
  ])
};

export function ensureDirs() {
  for (const dir of [
    config.paths.data,
    config.paths.uploads,
    config.paths.logs,
    config.paths.sessions,
    path.join(config.paths.uploads, "campaigns"),
    path.join(config.paths.uploads, "templates"),
    path.join(config.paths.uploads, "inbox")
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
