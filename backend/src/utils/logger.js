import fs from "node:fs";
import path from "node:path";
import pino from "pino";
import { config, ensureDirs } from "../../../config/index.js";
import { getDb } from "../../../database/index.js";

ensureDirs();

const dest = pino.destination({
  dest: path.join(config.paths.logs, "app.log"),
  mkdir: true,
  sync: false
});

export const logger = pino(
  {
    level: config.logLevel,
    redact: {
      paths: [
        "password",
        "token",
        "qr",
        "creds",
        "keys",
        "session",
        "authorization",
        "cookie",
        "*.password",
        "*.token",
        "*.qr",
        "*.creds"
      ],
      censor: "[redacted]"
    }
  },
  config.isDev
    ? pino.transport({
        targets: [
          { target: "pino-pretty", options: { colorize: true }, level: config.logLevel },
          { target: "pino/file", options: { destination: path.join(config.paths.logs, "app.log") } }
        ]
      })
    : dest
);

const SENSITIVE = /qr|cred|auth.?state|private.?key|session.?data|password|token|cookie/i;

export function systemLog(event, message, { userId = null, ip = null } = {}) {
  const safe = SENSITIVE.test(String(message)) ? "sensitive details omitted" : String(message).slice(0, 2000);
  try {
    getDb()
      .prepare("INSERT INTO system_logs (user_id, event, message, ip) VALUES (?, ?, ?, ?)")
      .run(userId, event, safe, ip);
  } catch {
    // db may not be ready during boot
  }
  logger.info({ event, userId }, safe);
}

export function auditLog(userId, action, details = "", ip = null) {
  const safe = SENSITIVE.test(String(details)) ? "sensitive details omitted" : String(details).slice(0, 2000);
  try {
    getDb()
      .prepare("INSERT INTO audit_logs (user_id, action, details, ip) VALUES (?, ?, ?, ?)")
      .run(userId, action, safe, ip);
  } catch {
    /* ignore */
  }
}

export function campaignLog(campaignId, event, message, level = "info") {
  getDb()
    .prepare("INSERT INTO campaign_logs (campaign_id, level, event, message) VALUES (?, ?, ?, ?)")
    .run(campaignId, level, event, String(message).slice(0, 2000));
}

export function rotateHint() {
  const logFile = path.join(config.paths.logs, "app.log");
  try {
    const st = fs.statSync(logFile);
    if (st.size > 20 * 1024 * 1024) {
      fs.renameSync(logFile, path.join(config.paths.logs, `app-${Date.now()}.log`));
    }
  } catch {
    /* ignore */
  }
}
