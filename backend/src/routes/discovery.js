import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { getDb } from "../../../database/index.js";
import { groupLinkMonitor } from "../../../services/outreach/GroupLinkMonitor.js";
import { waManager } from "../../../services/whatsapp/WhatsAppService.js";

export const discoveryRouter = Router();
discoveryRouter.use(requireAuth);

discoveryRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({
      groups: groupLinkMonitor.list({
        q: req.query.q || "",
        status: req.query.status || "",
        joinStatus: req.query.join || ""
      }),
      analytics: groupLinkMonitor.analytics()
    });
  })
);

discoveryRouter.get(
  "/analytics",
  asyncHandler(async (req, res) => {
    res.json(groupLinkMonitor.analytics());
  })
);

discoveryRouter.post(
  "/refresh-joined",
  asyncHandler(async (req, res) => {
    res.json({ groups: groupLinkMonitor.refreshJoined() });
  })
);

discoveryRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const row = groupLinkMonitor.get(req.params.id);
    if (!row) throw new HttpError(404, "لینک پیدا نشد");
    res.json({ group: row });
  })
);

discoveryRouter.post(
  "/:id/validate",
  asyncHandler(async (req, res) => {
    const row = await groupLinkMonitor.revalidate(req.params.id);
    if (!row) throw new HttpError(404, "لینک پیدا نشد");
    res.json({ group: row });
  })
);

discoveryRouter.post(
  "/:id/open",
  asyncHandler(async (req, res) => {
    const row = groupLinkMonitor.markOpened(req.params.id, req.user.id);
    if (!row) throw new HttpError(404, "لینک پیدا نشد");
    if (row.validation_status === "invalid") throw new HttpError(400, "لینک نامعتبر است");
    res.json({ group: row, openUrl: row.openUrl });
  })
);

discoveryRouter.post(
  "/:id/confirm-join",
  asyncHandler(async (req, res) => {
    if (waManager.primary().isConnected()) {
      try {
        await waManager.primary().syncGroups();
      } catch {
        /* membership check still runs on stored groups */
      }
    }
    groupLinkMonitor.refreshJoined();
    const row = groupLinkMonitor.confirmJoined(req.params.id, req.user.id);
    if (!row) throw new HttpError(404, "لینک پیدا نشد");
    res.json({ group: row });
  })
);

discoveryRouter.post(
  "/:id/add-to-manager",
  asyncHandler(async (req, res) => {
    try {
      const result = groupLinkMonitor.addToManager(req.params.id, req.user.id);
      res.json(result);
    } catch (err) {
      throw new HttpError(err.status || 400, err.message, err.code);
    }
  })
);

discoveryRouter.post(
  "/:id/notes",
  asyncHandler(async (req, res) => {
    const parsed = z.object({ body: z.string().min(1).max(2000) }).safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "یادداشت نامعتبر است");
    const row = groupLinkMonitor.get(req.params.id);
    if (!row) throw new HttpError(404, "لینک پیدا نشد");
    getDb()
      .prepare("UPDATE discovered_group_links SET notes = ?, updated_at = datetime('now') WHERE id = ?")
      .run(parsed.data.body, row.id);
    res.json({ group: groupLinkMonitor.get(row.id) });
  })
);
