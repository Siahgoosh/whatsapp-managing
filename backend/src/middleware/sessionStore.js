import crypto from "node:crypto";
import { getDb } from "../../../database/index.js";
import { config } from "../../../config/index.js";

export class SqliteSessionStore {
  constructor() {
    this.db = getDb();
  }

  create(userId) {
    this.purge();
    const sid = crypto.randomBytes(32).toString("hex");
    const csrfSecret = crypto.randomBytes(24).toString("hex");
    const expiresAt = Date.now() + config.sessionMaxAgeMs;
    this.db
      .prepare(
        "INSERT INTO sessions (sid, user_id, csrf_secret, expires_at, data) VALUES (?, ?, ?, ?, '{}')"
      )
      .run(sid, userId, csrfSecret, expiresAt);
    return { sid, csrfSecret, expiresAt };
  }

  get(sid) {
    if (!sid) return null;
    const row = this.db.prepare("SELECT * FROM sessions WHERE sid = ?").get(sid);
    if (!row) return null;
    if (row.expires_at < Date.now()) {
      this.destroy(sid);
      return null;
    }
    return row;
  }

  touch(sid) {
    const expiresAt = Date.now() + config.sessionMaxAgeMs;
    this.db.prepare("UPDATE sessions SET expires_at = ? WHERE sid = ?").run(expiresAt, sid);
  }

  destroy(sid) {
    this.db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
  }

  purge() {
    this.db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
  }
}

export const sessionStore = {
  instance: null,
  get() {
    if (!this.instance) this.instance = new SqliteSessionStore();
    return this.instance;
  },
  reset() {
    this.instance = null;
  }
};
