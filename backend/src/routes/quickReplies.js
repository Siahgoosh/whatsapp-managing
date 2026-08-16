import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { getDb } from "../../../database/index.js";

export const quickRepliesRouter = Router();
quickRepliesRouter.use(requireAuth);

quickRepliesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({
      items: getDb().prepare("SELECT * FROM quick_replies WHERE user_id = ? ORDER BY shortcut").all(req.user.id)
    });
  })
);

const schema = z.object({
  shortcut: z.string().min(2).max(40),
  message: z.string().min(1).max(2000)
});

quickRepliesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "پاسخ سریع نامعتبر است");
    const shortcut = parsed.data.shortcut.startsWith("/") ? parsed.data.shortcut : `/${parsed.data.shortcut}`;
    try {
      const info = getDb()
        .prepare("INSERT INTO quick_replies (user_id, shortcut, message) VALUES (?, ?, ?)")
        .run(req.user.id, shortcut, parsed.data.message);
      res.status(201).json({ id: Number(info.lastInsertRowid) });
    } catch {
      throw new HttpError(409, "این میانبر تکراری است");
    }
  })
);

quickRepliesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    getDb().prepare("DELETE FROM quick_replies WHERE id = ? AND user_id = ?").run(Number(req.params.id), req.user.id);
    res.json({ ok: true });
  })
);
