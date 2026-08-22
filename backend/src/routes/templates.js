import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { config } from "../../../config/index.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { getDb } from "../../../database/index.js";
import { isAllowedUpload, saveBuffer } from "../utils/files.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1 } });
export const templatesRouter = Router();
templatesRouter.use(requireAuth);

templatesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const templates = getDb().prepare("SELECT * FROM message_templates WHERE user_id = ? ORDER BY id DESC").all(req.user.id);
    const withFiles = templates.map((t) => ({
      ...t,
      attachment: getDb().prepare("SELECT * FROM message_attachments WHERE template_id = ?").get(t.id) || null
    }));
    res.json({ templates: withFiles });
  })
);

const schema = z.object({
  title: z.string().min(2).max(80),
  message: z.string().max(4000),
  caption: z.string().max(1000).optional().default(""),
  tags: z.string().max(200).optional().default("")
});

templatesRouter.post(
  "/",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "داده قالب نامعتبر است");
    const info = getDb()
      .prepare("INSERT INTO message_templates (user_id, title, message, caption, tags) VALUES (?, ?, ?, ?, ?)")
      .run(req.user.id, parsed.data.title, parsed.data.message, parsed.data.caption, parsed.data.tags);
    if (req.file) {
      if (!isAllowedUpload(req.file)) throw new HttpError(400, "فایل مجاز نیست");
      const saved = saveBuffer({
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        subdir: "templates"
      });
      getDb()
        .prepare(
          `INSERT INTO message_attachments (template_id, stored_name, original_name, mime_type, size, rel_path)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(info.lastInsertRowid, saved.storedName, saved.originalName, saved.mimeType, saved.size, saved.relPath);
    }
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  })
);

templatesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    getDb().prepare("DELETE FROM message_templates WHERE id = ? AND user_id = ?").run(Number(req.params.id), req.user.id);
    res.json({ ok: true });
  })
);
