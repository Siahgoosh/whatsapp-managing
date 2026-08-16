import { getDb } from "../../database/index.js";
import { telegramService } from "../telegram/TelegramService.js";
import { logger } from "../../backend/src/utils/logger.js";

export class NotificationService {
  constructor() {
    this.io = null;
  }

  attach(io) {
    this.io = io;
  }

  create({ userId = null, type, title, body = "" }) {
    const info = getDb()
      .prepare("INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)")
      .run(userId, type, title, body);
    const row = getDb().prepare("SELECT * FROM notifications WHERE id = ?").get(info.lastInsertRowid);
    if (this.io) this.io.emit("notification:new", row);
    telegramService.send(`🔔 ${title}\n${body}`).catch(() => {});
    logger.info({ type }, title);
    return row;
  }

  list(userId, { unreadOnly = false } = {}) {
    if (unreadOnly) {
      return getDb()
        .prepare("SELECT * FROM notifications WHERE (user_id IS NULL OR user_id = ?) AND read = 0 ORDER BY id DESC LIMIT 100")
        .all(userId);
    }
    return getDb()
      .prepare("SELECT * FROM notifications WHERE user_id IS NULL OR user_id = ? ORDER BY id DESC LIMIT 100")
      .all(userId);
  }

  markRead(id, userId) {
    getDb()
      .prepare("UPDATE notifications SET read = 1 WHERE id = ? AND (user_id IS NULL OR user_id = ?)")
      .run(id, userId);
  }

  markAllRead(userId) {
    getDb()
      .prepare("UPDATE notifications SET read = 1 WHERE user_id IS NULL OR user_id = ?")
      .run(userId);
  }
}

export const notificationService = new NotificationService();
