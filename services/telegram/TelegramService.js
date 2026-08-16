import { getDb } from "../../database/index.js";
import { logger } from "../../backend/src/utils/logger.js";
import { getSetting } from "../../database/index.js";

export class TelegramService {
  constructor() {
    this.lastError = null;
  }

  enabled() {
    const token = getSetting("telegram_bot_token", process.env.TELEGRAM_BOT_TOKEN || "");
    const chat = getSetting("telegram_chat_id", process.env.TELEGRAM_CHAT_ID || "");
    const on = getSetting("telegram_enabled", "false") === "true";
    return on && Boolean(token && chat);
  }

  async send(text) {
    if (!this.enabled()) return false;
    const token = getSetting("telegram_bot_token");
    const chatId = getSetting("telegram_chat_id");
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" })
      });
      if (!res.ok) {
        this.lastError = `telegram ${res.status}`;
        logger.warn({ status: res.status }, "telegram send failed");
        return false;
      }
      return true;
    } catch (err) {
      this.lastError = err.message;
      logger.warn({ err: err.message }, "telegram send error");
      return false;
    }
  }
}

export const telegramService = new TelegramService();
