import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { config } from "../../../config/index.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { isAllowedUpload, saveBuffer } from "../utils/files.js";
import { campaignService } from "../../../services/campaign/CampaignService.js";
import { campaignQueue } from "../../../queue/CampaignQueue.js";
import { getDb } from "../../../database/index.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 }
});

export const campaignsRouter = Router();
campaignsRouter.use(requireAuth);

const createSchema = z.object({
  name: z.string().min(2).max(120),
  message: z.string().max(4000).optional().default(""),
  caption: z.string().max(1000).optional().default(""),
  sessionId: z.coerce.number().optional(),
  groupIds: z.array(z.coerce.number()).min(1),
  delayMin: z.coerce.number(),
  delayMax: z.coerce.number().optional(),
  randomDelay: z.coerce.boolean().optional().default(false),
  scheduledAt: z.string().optional().nullable()
});

campaignsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({ campaigns: campaignService.list(req.user.id, req.user.role) });
  })
);

campaignsRouter.post(
  "/",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    let payload;
    if (req.is("multipart/form-data") || req.file) {
      payload = {
        ...req.body,
        groupIds: JSON.parse(req.body.groupIds || "[]"),
        randomDelay: req.body.randomDelay === "true" || req.body.randomDelay === true
      };
    } else {
      payload = req.body;
    }
    const parsed = createSchema.safeParse(payload);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || "داده نامعتبر");
    let attachment = null;
    if (req.file) {
      if (!isAllowedUpload(req.file)) throw new HttpError(400, "فایل مجاز نیست یا حجم آن زیاد است");
      attachment = saveBuffer({
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        subdir: "campaigns"
      });
    }
    const session = getDb().prepare("SELECT id FROM whatsapp_sessions WHERE session_key = 'default'").get();
    const created = campaignService.create(req.user, {
      ...parsed.data,
      sessionId: parsed.data.sessionId || session.id,
      attachment
    });
    res.status(201).json(created);
  })
);

campaignsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(campaignService.get(Number(req.params.id), req.user.id, req.user.role));
  })
);

campaignsRouter.get(
  "/:id/summary",
  asyncHandler(async (req, res) => {
    res.json(campaignService.summary(Number(req.params.id), req.user));
  })
);

campaignsRouter.get(
  "/:id/logs",
  asyncHandler(async (req, res) => {
    const data = campaignService.get(Number(req.params.id), req.user.id, req.user.role);
    res.json({ logs: data.logs, groups: data.groups, campaign: data.campaign });
  })
);

campaignsRouter.get(
  "/:id/export",
  asyncHandler(async (req, res) => {
    const data = campaignService.get(Number(req.params.id), req.user.id, req.user.role);
    const header = "Group Name,Status,Time,Error,Retry Count\n";
    const lines = data.groups.map((g) =>
      [csv(g.group_name), g.status, g.sent_at || "", csv(g.error || ""), g.retry_count].join(",")
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="campaign-${data.campaign.id}.csv"`);
    res.send("\uFEFF" + header + lines.join("\n"));
  })
);

campaignsRouter.post(
  "/:id/duplicate",
  asyncHandler(async (req, res) => {
    res.status(201).json(campaignService.duplicate(Number(req.params.id), req.user));
  })
);

campaignsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    campaignService.remove(Number(req.params.id), req.user);
    res.json({ ok: true });
  })
);

campaignsRouter.post(
  "/:id/start",
  asyncHandler(async (req, res) => {
    res.json(await campaignQueue.start(Number(req.params.id), req.user));
  })
);

campaignsRouter.post(
  "/:id/pause",
  asyncHandler(async (req, res) => {
    res.json(campaignQueue.pause(Number(req.params.id), req.user));
  })
);

campaignsRouter.post(
  "/:id/resume",
  asyncHandler(async (req, res) => {
    res.json(campaignQueue.resume(Number(req.params.id), req.user));
  })
);

campaignsRouter.post(
  "/:id/stop",
  asyncHandler(async (req, res) => {
    res.json(campaignQueue.stop(Number(req.params.id), req.user));
  })
);

function csv(value) {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}
