import express from "express";
import cors from "cors";
import path from "node:path";
import cookieParser from "cookie-parser";
import { config } from "../../config/index.js";
import { securityHeaders, apiLimiter } from "./middleware/security.js";
import { attachSession } from "./middleware/auth.js";
import { csrfProtect, originCheck } from "./middleware/csrf.js";
import { authRouter } from "./routes/auth.js";
import { whatsappRouter } from "./routes/whatsapp.js";
import { groupsRouter } from "./routes/groups.js";
import { campaignsRouter } from "./routes/campaigns.js";
import { inboxRouter } from "./routes/inbox.js";
import { templatesRouter } from "./routes/templates.js";
import { autoRepliesRouter } from "./routes/autoReplies.js";
import { quickRepliesRouter } from "./routes/quickReplies.js";
import { settingsRouter } from "./routes/settings.js";
import { dashboardRouter, notificationsRouter } from "./routes/dashboard.js";
import { filesRouter } from "./routes/files.js";
import { logger } from "./utils/logger.js";
import { getDb } from "../../database/index.js";
import { waManager } from "../../services/whatsapp/WhatsAppService.js";
import { requireAuth } from "./middleware/auth.js";
import { asyncHandler } from "./utils/errors.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(securityHeaders());
  app.use(
    cors({
      origin: config.corsOrigin,
      credentials: true
    })
  );
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(attachSession);
  app.use(originCheck);
  app.use(csrfProtect);
  app.use("/api", apiLimiter());

  app.get("/health", (req, res) => {
    const wa = waManager.primary().publicStatus();
    res.json({
      ok: true,
      port: config.port,
      uptime: process.uptime(),
      database: Boolean(getDb()),
      whatsapp: wa.status
    });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/whatsapp", whatsappRouter);
  app.use("/api/groups", groupsRouter);
  app.use("/api/campaigns", campaignsRouter);
  app.use("/api/inbox", inboxRouter);
  app.use("/api/templates", templatesRouter);
  app.use("/api/auto-replies", autoRepliesRouter);
  app.use("/api/quick-replies", quickRepliesRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/files", filesRouter);

  app.get(
    "/api/scheduler",
    requireAuth,
    asyncHandler(async (req, res) => {
      const items = getDb()
        .prepare(
          `SELECT sc.*, c.name, c.status AS campaign_status
           FROM scheduled_campaigns sc JOIN campaigns c ON c.id = sc.campaign_id
           ORDER BY sc.run_at DESC`
        )
        .all();
      res.json({ items });
    })
  );

  app.get(
    "/api/reports",
    requireAuth,
    asyncHandler(async (req, res) => {
      const byDay = getDb()
        .prepare(
          `SELECT date(created_at) AS day, COUNT(*) AS campaigns
           FROM campaigns GROUP BY date(created_at) ORDER BY day DESC LIMIT 14`
        )
        .all();
      const totals = getDb()
        .prepare(
          `SELECT
             SUM(sent_count) AS sent,
             SUM(failed_count) AS failed,
             SUM(skipped_count) AS skipped,
             COUNT(*) AS campaigns
           FROM campaigns`
        )
        .get();
      res.json({ byDay, totals });
    })
  );

  if (!config.isDev && !config.isTest) {
    app.use(express.static(config.paths.frontendDist));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api") || req.path === "/health" || req.path.startsWith("/socket.io")) {
        return next();
      }
      res.sendFile(path.join(config.paths.frontendDist, "index.html"));
    });
  }

  app.use((req, res) => {
    res.status(404).json({ error: "مسیر پیدا نشد" });
  });

  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) logger.error({ err: err.message, path: req.path }, "unhandled");
    res.status(status).json({ error: err.message || "خطای داخلی", code: err.code || "error" });
  });

  return app;
}
