import { getDb } from "../../database/index.js";
import { pickRule } from "./matcher.js";
import { waManager } from "../whatsapp/WhatsAppService.js";
import { aiService } from "../ai/AiService.js";
import { logger, systemLog } from "../../backend/src/utils/logger.js";

export class AutoReplyService {
  list(userId) {
    return getDb()
      .prepare("SELECT * FROM auto_reply_rules WHERE user_id = ? ORDER BY id DESC")
      .all(userId);
  }

  create(userId, data) {
    const info = getDb()
      .prepare(
        `INSERT INTO auto_reply_rules (user_id, keyword, response, match_type, case_insensitive, enabled, apply_to)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        data.keyword.trim(),
        data.response.trim(),
        data.matchType === "exact" ? "exact" : "contains",
        data.caseInsensitive === false ? 0 : 1,
        data.enabled === false ? 0 : 1,
        data.applyTo === "groups" || data.applyTo === "all" ? data.applyTo : "private"
      );
    return getDb().prepare("SELECT * FROM auto_reply_rules WHERE id = ?").get(info.lastInsertRowid);
  }

  update(id, userId, data) {
    getDb()
      .prepare(
        `UPDATE auto_reply_rules
         SET keyword = ?, response = ?, match_type = ?, case_insensitive = ?, enabled = ?, apply_to = ?
         WHERE id = ? AND user_id = ?`
      )
      .run(
        data.keyword.trim(),
        data.response.trim(),
        data.matchType === "exact" ? "exact" : "contains",
        data.caseInsensitive === false ? 0 : 1,
        data.enabled === false ? 0 : 1,
        data.applyTo || "private",
        id,
        userId
      );
    return getDb().prepare("SELECT * FROM auto_reply_rules WHERE id = ?").get(id);
  }

  remove(id, userId) {
    getDb().prepare("DELETE FROM auto_reply_rules WHERE id = ? AND user_id = ?").run(id, userId);
  }

  async handleIncoming({ sessionKey, chatId, chatType, body, chatName }) {
    const admin = getDb().prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
    const rules = this.list(admin?.id || 1).filter((r) => r.enabled);
    const rule = pickRule(rules, body, chatType);
    const suggestion = await aiService.suggest({ incoming: body, contactName: chatName });
    if (suggestion) {
      getDb()
        .prepare(
          `UPDATE inbox_messages SET ai_suggestion = ?
           WHERE id = (SELECT id FROM inbox_messages WHERE chat_id = ? ORDER BY id DESC LIMIT 1)`
        )
        .run(suggestion, chatId);
    }
    if (rule && chatType === "private") {
      try {
        await waManager.get(sessionKey).sendChat({ chatId, text: rule.response });
        getDb()
          .prepare(
            `INSERT INTO inbox_messages (session_id, chat_id, chat_name, chat_type, direction, body, unread)
             SELECT session_id, chat_id, chat_name, chat_type, 'out', ?, 0 FROM inbox_messages
             WHERE chat_id = ? ORDER BY id DESC LIMIT 1`
          )
          .run(rule.response, chatId);
        systemLog("auto_reply_sent", `Auto-reply matched keyword`);
      } catch (err) {
        logger.warn({ err: err.message }, "auto-reply send failed");
      }
    }
    return { rule, suggestion };
  }
}

export const autoReplyService = new AutoReplyService();
