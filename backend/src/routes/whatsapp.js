import { Router } from "express";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { waManager } from "../../../services/whatsapp/WhatsAppService.js";
import { requireAuth } from "../middleware/auth.js";
import { campaignQueue } from "../../../queue/CampaignQueue.js";
import { notificationService } from "../../../services/notifications/NotificationService.js";
import { systemLog } from "../utils/logger.js";

export const whatsappRouter = Router();
whatsappRouter.use(requireAuth);

whatsappRouter.get(
  "/status",
  asyncHandler(async (req, res) => {
    res.json(waManager.primary().publicStatus());
  })
);

whatsappRouter.get(
  "/qr",
  asyncHandler(async (req, res) => {
    const qr = waManager.primary().getQr();
    res.json({ qr: qr || null, status: waManager.primary().status });
  })
);

whatsappRouter.post(
  "/connect",
  asyncHandler(async (req, res) => {
    await waManager.primary().start();
    systemLog("whatsapp_connect", "Connect requested", { userId: req.user.id, ip: req.ip });
    res.json(waManager.primary().publicStatus());
  })
);

whatsappRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    campaignQueue.pauseAll("whatsapp_disconnected");
    await waManager.primary().logout();
    notificationService.create({
      userId: req.user.id,
      type: "whatsapp_disconnected",
      title: "واتساپ قطع شد",
      body: "نشست واتساپ خارج شد."
    });
    res.json(waManager.primary().publicStatus());
  })
);

whatsappRouter.get(
  "/sessions",
  asyncHandler(async (req, res) => {
    if (req.user.role !== "admin") throw new HttpError(403, "فقط مدیر");
    const { getDb } = await import("../../../database/index.js");
    const rows = getDb().prepare("SELECT id, session_key, label, phone, account_name, status, last_connected_at FROM whatsapp_sessions").all();
    res.json({ sessions: rows });
  })
);
