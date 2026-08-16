import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/errors.js";
import { getDb } from "../../../database/index.js";
import { waManager } from "../../../services/whatsapp/WhatsAppService.js";
import { notificationService } from "../../../services/notifications/NotificationService.js";
import { outreachService } from "../../../services/outreach/OutreachService.js";
import { groupLinkMonitor } from "../../../services/outreach/GroupLinkMonitor.js";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const groups = getDb().prepare("SELECT COUNT(*) AS c FROM groups WHERE membership_status = 'member'").get().c;
    const campaigns = getDb().prepare("SELECT COUNT(*) AS c FROM campaigns").get().c;
    const sent = getDb().prepare("SELECT COUNT(*) AS c FROM campaign_groups WHERE status = 'sent'").get().c;
    const failed = getDb().prepare("SELECT COUNT(*) AS c FROM campaign_groups WHERE status = 'failed'").get().c;
    const active = getDb()
      .prepare("SELECT COUNT(*) AS c FROM campaigns WHERE status IN ('sending', 'queued', 'paused')")
      .get().c;
    const activity = getDb().prepare("SELECT * FROM system_logs ORDER BY id DESC LIMIT 30").all();
    const recent = getDb().prepare("SELECT * FROM campaigns ORDER BY id DESC LIMIT 5").all();
    const finder = {
      citiesScanned: getDb().prepare("SELECT COUNT(DISTINCT city) AS c FROM public_whatsapp_groups").get().c,
      groupsFound: getDb().prepare("SELECT COUNT(*) AS c FROM public_whatsapp_groups").get().c,
      validLinks: getDb().prepare("SELECT COUNT(*) AS c FROM public_whatsapp_groups WHERE status = 'valid'").get().c,
      invalidLinks: getDb().prepare("SELECT COUNT(*) AS c FROM public_whatsapp_groups WHERE status = 'invalid'").get().c,
      duplicates: Math.max(
        0,
        getDb().prepare("SELECT COUNT(*) AS c FROM group_sources").get().c -
          getDb().prepare("SELECT COUNT(*) AS c FROM public_whatsapp_groups").get().c
      ),
      alreadyJoined: getDb().prepare("SELECT COUNT(*) AS c FROM public_whatsapp_groups WHERE joined_status = 'joined'").get().c,
      notJoined: getDb().prepare("SELECT COUNT(*) AS c FROM public_whatsapp_groups WHERE joined_status = 'not_joined'").get().c
    };
    res.json({
      whatsapp: waManager.primary().publicStatus(),
      stats: {
        groups,
        campaigns,
        sent,
        failed,
        active,
        finder,
        outreach: outreachService.analytics(),
        discovery: groupLinkMonitor.analytics()
      },
      activity,
      recent
    });
  })
);

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({ notifications: notificationService.list(req.user.id) });
  })
);

notificationsRouter.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    notificationService.markAllRead(req.user.id);
    res.json({ ok: true });
  })
);

notificationsRouter.post(
  "/:id/read",
  asyncHandler(async (req, res) => {
    notificationService.markRead(Number(req.params.id), req.user.id);
    res.json({ ok: true });
  })
);
