import fs from "node:fs";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { config, ensureDirs } from "../config/index.js";
import { SCHEMA_SQL } from "./schema.js";

let db;

export function getDb() {
  if (!db) throw new Error("Database not initialized");
  return db;
}

export function initDatabase() {
  ensureDirs();
  db = new Database(config.paths.sqlite);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  seedAdmin();
  seedDefaultSession();
  seedSettings();
  seedQuickReplies();
  return db;
}

function seedAdmin() {
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(config.adminUsername);
  const hash = bcrypt.hashSync(config.adminPassword, 12);
  if (!existing) {
    db.prepare(
      "INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, 'admin')"
    ).run(config.adminUsername, hash, "مدیر سیستم");
  } else if (config.nodeEnv !== "test") {
    db.prepare("UPDATE users SET password_hash = ? WHERE username = ?").run(hash, config.adminUsername);
  }
}

function seedDefaultSession() {
  const row = db.prepare("SELECT id FROM whatsapp_sessions WHERE session_key = 'default'").get();
  if (!row) {
    db.prepare(
      "INSERT INTO whatsapp_sessions (session_key, label, status) VALUES ('default', 'حساب اصلی', 'disconnected')"
    ).run();
  }
}

function seedSettings() {
  const defaults = {
    brand_name: "پنل کمپین واتساپ",
    consent_required: "true",
    auto_reply_private_only: "true",
    telegram_enabled: String(config.telegramEnabled),
    telegram_bot_token: config.telegramBotToken,
    telegram_chat_id: config.telegramChatId,
    ai_mode: "suggest",
    theme: "dark",
    finder_schedule_hours: "0"
  };
  const insert = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  for (const [key, value] of Object.entries(defaults)) {
    insert.run(key, value);
  }
}

function seedQuickReplies() {
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!admin) return;
  const count = db.prepare("SELECT COUNT(*) AS c FROM quick_replies").get().c;
  if (count > 0) return;
  const rows = [
    ["/price", "سلام، برای اطلاع از قیمت لطفاً نام فایل را ارسال کنید."],
    ["/location", "📍 دفتر املاک فرتاک، خیابان ۲۲ بهمن."],
    ["/contact", "جهت مشاوره با ما تماس بگیرید."]
  ];
  const stmt = db.prepare("INSERT INTO quick_replies (user_id, shortcut, message) VALUES (?, ?, ?)");
  for (const [shortcut, message] of rows) stmt.run(admin.id, shortcut, message);
}

export function getSetting(key, fallback = "") {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  getDb()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run(key, String(value));
}

export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

export function resetDatabaseForTests() {
  closeDatabase();
  for (let i = 0; i < 5; i++) {
    try {
      for (const suffix of ["", "-wal", "-shm"]) {
        const p = config.paths.sqlite + suffix;
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
      break;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
    }
  }
  initDatabase();
}
