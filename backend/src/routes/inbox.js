import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { getDb } from "../../../database/index.js";
import { waManager } from "../../../services/whatsapp/WhatsAppService.js";
import { aiService } from "../../../services/ai/AiService.js";

export const inboxRouter = Router();
inboxRouter.use(requireAuth);

inboxRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const session = getDb().prepare("SELECT id FROM whatsapp_sessions WHERE session_key = 'default'").get();
    const convos = getDb()
      .prepare(
        `SELECT chat_id, chat_name, chat_type,
                MAX(id) AS last_id,
                SUM(CASE WHEN unread = 1 AND direction = 'in' THEN 1 ELSE 0 END) AS unread
         FROM inbox_messages WHERE session_id = ?
         GROUP BY chat_id
         ORDER BY last_id DESC`
      )
      .all(session.id);
    const withLast = convos.map((c) => {
      const last = getDb().prepare("SELECT * FROM inbox_messages WHERE id = ?").get(c.last_id);
      return { ...c, lastMessage: last };
    });
    res.json({ conversations: withLast });
  })
);

inboxRouter.get(
  "/:chatId",
  asyncHandler(async (req, res) => {
    const messages = getDb()
      .prepare("SELECT * FROM inbox_messages WHERE chat_id = ? ORDER BY id ASC LIMIT 400")
      .all(req.params.chatId);
    getDb()
      .prepare("UPDATE inbox_messages SET unread = 0 WHERE chat_id = ? AND direction = 'in'")
      .run(req.params.chatId);
    res.json({ messages });
  })
);

const replySchema = z.object({
  chatId: z.string().min(3),
  text: z.string().min(1).max(4000)
});

inboxRouter.post(
  "/reply",
  asyncHandler(async (req, res) => {
    const parsed = replySchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "پیام نامعتبر است");
    if (!waManager.primary().isConnected()) throw new HttpError(409, "واتساپ متصل نیست");
    await waManager.primary().sendChat({ chatId: parsed.data.chatId, text: parsed.data.text });
    const session = getDb().prepare("SELECT id FROM whatsapp_sessions WHERE session_key = 'default'").get();
    const last = getDb()
      .prepare("SELECT chat_name, chat_type FROM inbox_messages WHERE chat_id = ? ORDER BY id DESC LIMIT 1")
      .get(parsed.data.chatId);
    getDb()
      .prepare(
        `INSERT INTO inbox_messages (session_id, chat_id, chat_name, chat_type, direction, body, unread)
         VALUES (?, ?, ?, ?, 'out', ?, 0)`
      )
      .run(
        session.id,
        parsed.data.chatId,
        last?.chat_name || parsed.data.chatId,
        last?.chat_type || "contact",
        parsed.data.text
      );
    res.json({ ok: true });
  })
);

inboxRouter.post(
  "/suggest",
  asyncHandler(async (req, res) => {
    const chatId = req.body.chatId;
    const messages = getDb()
      .prepare("SELECT direction, body FROM inbox_messages WHERE chat_id = ? ORDER BY id DESC LIMIT 8")
      .all(chatId)
      .reverse();
    const lastIn = [...messages].reverse().find((m) => m.direction === "in");
    const suggestion = await aiService.suggest({
      history: messages,
      incoming: lastIn?.body || "",
      contactName: req.body.chatName || ""
    });
    res.json({ suggestion, enabled: aiService.enabled() });
  })
);
