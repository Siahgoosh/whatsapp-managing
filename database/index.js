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
  migrateSchema(db);
  seedAdmin();
  seedDefaultSession();
  seedSettings();
  seedQuickReplies();
  return db;
}

function tableColumns(database, table) {
  return database.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function addColumn(database, table, column, definition) {
  const cols = tableColumns(database, table);
  if (!cols.includes(column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrateSchema(database) {
  addColumn(database, "groups", "last_activity_at", "TEXT");
  addColumn(database, "groups", "admin_count", "INTEGER");
  addColumn(database, "groups", "city", "TEXT NOT NULL DEFAULT 'سایر'");
  addColumn(database, "groups", "advertising_permission", "TEXT NOT NULL DEFAULT 'unknown'");
  addColumn(database, "groups", "notes", "TEXT NOT NULL DEFAULT ''");
  addColumn(database, "groups", "source", "TEXT NOT NULL DEFAULT 'whatsapp_sync'");
  addColumn(database, "groups", "found_by", "TEXT");
  addColumn(database, "groups", "found_at", "TEXT");
  addColumn(database, "groups", "source_group_name", "TEXT");
  addColumn(database, "users", "whatsapp_session_id", "INTEGER");
  const def = database.prepare("SELECT id FROM whatsapp_sessions WHERE session_key = 'default'").get();
  if (def) {
    database
      .prepare("UPDATE users SET whatsapp_session_id = COALESCE(whatsapp_session_id, ?) WHERE whatsapp_session_id IS NULL")
      .run(def.id);
  }
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_groups_permission ON groups(advertising_permission, membership_status)"
  );
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
    finder_schedule_hours: "0",
    office_name: "املاک فرتاک",
    outreach_follow_up_hours: "24",
    admin_outreach_template:
      "سلام {{admin_name}}، وقت بخیر. من از مجموعه {{office_name}} هستم. در زمینه فایل‌های ملکی منطقه {{city}} فعالیت داریم. در صورت اجازه شما، مایل هستیم بعضی فایل‌های مرتبط و محدود را در گروه {{group_name}} منتشر کنیم. اگر موافق باشید، ممنون می‌شوم اطلاع دهید."
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
