import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { getDb } from "../../../database/index.js";
import { aiService } from "../../../services/ai/AiService.js";
import { clientFor, resolveAccount } from "../../../services/accounts/AccountService.js";

export const inboxRouter = Router();
inboxRouter.use(requireAuth);

inboxRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const account = resolveAccount(req);
    if (!account) throw new HttpError(400, "اکانت واتساپ پیدا نشد");
    const convos = getDb()
      .prepare(
        `SELECT chat_id, chat_name, chat_type,
                MAX(id) AS last_id,
                SUM(CASE WHEN unread = 1 AND direction = 'in' THEN 1 ELSE 0 END) AS unread
         FROM inbox_messages WHERE session_id = ?
         GROUP BY chat_id
         ORDER BY last_id DESC`
      )
      .all(account.id);
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
    const account = resolveAccount(req);
    if (!account) throw new HttpError(400, "اکانت واتساپ پیدا نشد");
    const messages = getDb()
      .prepare("SELECT * FROM inbox_messages WHERE session_id = ? AND chat_id = ? ORDER BY id ASC LIMIT 400")
      .all(account.id, req.params.chatId);
    getDb()
      .prepare("UPDATE inbox_messages SET unread = 0 WHERE session_id = ? AND chat_id = ? AND direction = 'in'")
      .run(account.id, req.params.chatId);
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
    const account = resolveAccount(req);
    const wa = clientFor(account);
    if (!wa.isConnected()) throw new HttpError(409, "واتساپ متصل نیست");
    await wa.sendChat({ chatId: parsed.data.chatId, text: parsed.data.text });
    const last = getDb()
      .prepare("SELECT chat_name, chat_type FROM inbox_messages WHERE chat_id = ? ORDER BY id DESC LIMIT 1")
      .get(parsed.data.chatId);
    getDb()
      .prepare(
        `INSERT INTO inbox_messages (session_id, chat_id, chat_name, chat_type, direction, body, unread)
         VALUES (?, ?, ?, ?, 'out', ?, 0)`
      )
      .run(
        account.id,
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
