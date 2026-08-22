import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { autoReplyService } from "../../../services/autoreply/AutoReplyService.js";

export const autoRepliesRouter = Router();
autoRepliesRouter.use(requireAuth);

const schema = z.object({
  keyword: z.string().min(1).max(80),
  response: z.string().min(1).max(2000),
  matchType: z.enum(["exact", "contains"]).optional(),
  caseInsensitive: z.boolean().optional(),
  enabled: z.boolean().optional(),
  applyTo: z.enum(["private", "groups", "all"]).optional()
});

autoRepliesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({ rules: autoReplyService.list(req.user.id) });
  })
);

autoRepliesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "قانون نامعتبر است");
    res.status(201).json({ rule: autoReplyService.create(req.user.id, parsed.data) });
  })
);

autoRepliesRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "قانون نامعتبر است");
    res.json({ rule: autoReplyService.update(Number(req.params.id), req.user.id, parsed.data) });
  })
);

autoRepliesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    autoReplyService.remove(Number(req.params.id), req.user.id);
    res.json({ ok: true });
  })
);
