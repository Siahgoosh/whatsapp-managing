import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { waManager } from "../../../services/whatsapp/WhatsAppService.js";
import { getDb } from "../../../database/index.js";
import { outreachService } from "../../../services/outreach/OutreachService.js";

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
  tags: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  city: z.string().max(40).optional(),
  advertisingPermission: z.enum(["unknown", "requested", "approved", "declined", "blocked"]).optional()
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
    if (parsed.data.notes !== undefined) {
      getDb().prepare("UPDATE groups SET notes = ? WHERE id = ?").run(parsed.data.notes, group.id);
    }
    if (parsed.data.city !== undefined) {
      outreachService.setCity(group.id, parsed.data.city);
    }
    if (parsed.data.advertisingPermission !== undefined) {
      outreachService.setPermission(group.id, parsed.data.advertisingPermission, null, req.user.id);
    }
    res.json({ group: getDb().prepare("SELECT * FROM groups WHERE id = ?").get(group.id) });
  })
);
