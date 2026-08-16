import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { absUpload } from "../utils/files.js";
import { getDb } from "../../../database/index.js";

export const filesRouter = Router();
filesRouter.use(requireAuth);

filesRouter.get(
  "/group/:groupId",
  asyncHandler(async (req, res) => {
    const group = getDb().prepare("SELECT picture_path FROM groups WHERE id = ?").get(Number(req.params.groupId));
    if (!group?.picture_path) throw new HttpError(404, "بدون تصویر");
    const abs = absUpload(group.picture_path);
    if (!fs.existsSync(abs)) throw new HttpError(404, "بدون تصویر");
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("X-Content-Type-Options", "nosniff");
    fs.createReadStream(abs).pipe(res);
  })
);

filesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const row = getDb().prepare("SELECT * FROM message_attachments WHERE id = ?").get(Number(req.params.id));
    if (!row) throw new HttpError(404, "فایل پیدا نشد");
    const abs = absUpload(row.rel_path);
    if (!fs.existsSync(abs)) throw new HttpError(404, "فایل روی دیسک نیست");
    res.setHeader("Content-Type", row.mime_type);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `inline; filename="${path.basename(row.original_name)}"`);
    fs.createReadStream(abs).pipe(res);
  })
);
