import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { waManager } from "../../../services/whatsapp/WhatsAppService.js";
import { getDb } from "../../../database/index.js";

export const groupsRouter = Router();
groupsRouter.use(requireAuth);

groupsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const groups = waManager.primary().listGroups({
      q: req.query.q || "",
      favorite: req.query.favorite,
      admin: req.query.admin
    });
    res.json({ groups });
  })
);

groupsRouter.post(
  "/sync",
  asyncHandler(async (req, res) => {
    if (!waManager.primary().isConnected()) throw new HttpError(409, "واتساپ متصل نیست");
    const groups = await waManager.primary().syncGroups();
    res.json({ groups });
  })
);

const patchSchema = z.object({
  isFavorite: z.boolean().optional(),
  tags: z.string().max(200).optional()
});

groupsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "داده نامعتبر");
    const group = getDb().prepare("SELECT * FROM groups WHERE id = ?").get(Number(req.params.id));
    if (!group) throw new HttpError(404, "گروه پیدا نشد");
    if (parsed.data.isFavorite !== undefined) {
      getDb().prepare("UPDATE groups SET is_favorite = ? WHERE id = ?").run(parsed.data.isFavorite ? 1 : 0, group.id);
    }
    if (parsed.data.tags !== undefined) {
      getDb().prepare("UPDATE groups SET tags = ? WHERE id = ?").run(parsed.data.tags, group.id);
    }
    res.json({ group: getDb().prepare("SELECT * FROM groups WHERE id = ?").get(group.id) });
  })
);
