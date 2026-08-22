import "./env.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import Database from "better-sqlite3";
import { test } from "node:test";
import { config } from "../../config/index.js";
import { closeDatabase, getDb, initDatabase } from "../../database/index.js";

function wipeSqlite() {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = config.paths.sqlite + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

test("existing groups table without advertising_permission is migrated", () => {
  wipeSqlite();
  const raw = new Database(config.paths.sqlite);
  raw.exec(`
    CREATE TABLE whatsapp_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_key TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL DEFAULT 'اصلی',
      status TEXT NOT NULL DEFAULT 'disconnected',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      wa_id TEXT NOT NULL,
      name TEXT NOT NULL,
      picture_path TEXT,
      member_count INTEGER,
      membership_status TEXT NOT NULL DEFAULT 'member',
      is_admin INTEGER NOT NULL DEFAULT 0,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '',
      last_campaign_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(session_id, wa_id)
    );
    INSERT INTO whatsapp_sessions (session_key, label) VALUES ('default', 'حساب اصلی');
    INSERT INTO groups (session_id, wa_id, name) VALUES (1, '12036301@g.us', 'گروه قدیمی');
  `);
  raw.close();

  initDatabase();
  const cols = getDb()
    .prepare("PRAGMA table_info(groups)")
    .all()
    .map((c) => c.name);
  assert.ok(cols.includes("advertising_permission"));
  assert.ok(cols.includes("city"));
  const row = getDb().prepare("SELECT name, advertising_permission, city FROM groups WHERE wa_id = ?").get("12036301@g.us");
  assert.equal(row.name, "گروه قدیمی");
  assert.equal(row.advertising_permission, "unknown");
  assert.equal(row.city, "سایر");
});
