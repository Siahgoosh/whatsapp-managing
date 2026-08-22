import http from "node:http";
import { Server } from "socket.io";
import cron from "node-cron";
import { config, ensureDirs } from "../../config/index.js";
import { initDatabase } from "../../database/index.js";
import { createApp } from "./app.js";
import { logger, systemLog } from "./utils/logger.js";
import { waManager } from "../../services/whatsapp/WhatsAppService.js";
import { campaignQueue } from "../../queue/CampaignQueue.js";
import { notificationService } from "../../services/notifications/NotificationService.js";
import { autoReplyService } from "../../services/autoreply/AutoReplyService.js";
import { sessionStore } from "./middleware/sessionStore.js";
import { parseCookies } from "./middleware/auth.js";
import { isAllowedOrigin } from "./middleware/csrf.js";
import { publicGroupScanner } from "../../services/finder/Scanner.js";
import { getSetting, getDb } from "../../database/index.js";
import { CITIES } from "../../services/finder/cities.js";
import { groupLinkMonitor } from "../../services/outreach/GroupLinkMonitor.js";
import { outreachService } from "../../services/outreach/OutreachService.js";

ensureDirs();
initDatabase();

const app = createApp();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
    credentials: true
  }
});

io.use((socket, next) => {
  const cookies = parseCookies(socket.handshake.headers.cookie || "");
  const sid = cookies[config.sessionCookieName];
  const row = sessionStore.get().get(sid);
  if (!row?.user_id) return next(new Error("unauthorized"));
  socket.userId = row.user_id;
  next();
});

io.on("connection", (socket) => {
  for (const client of waManager.clients.values()) {
    socket.emit("whatsapp:status", client.publicStatus());
  }
});

notificationService.attach(io);
campaignQueue.attach(io);
publicGroupScanner.attach(io);
groupLinkMonitor.attach(io);
outreachService.attach(io);
campaignQueue.ensureLoop();

function bindWhatsAppClient(client) {
  client.on("status", (status) => io.emit("whatsapp:status", status));
  client.on("qr", (payload) => io.emit("whatsapp:qr", { hasQr: true, sessionKey: client.sessionKey, ...payload }));
  client.on("disconnected", ({ reason }) => {
    if (reason === "authentication_failed" || reason === "reconnecting") {
      const row = client.row();
      if (row) {
        campaignQueue.pauseSession(row.id, reason === "authentication_failed" ? "session_expired" : "whatsapp_disconnected");
      }
      notificationService.create({
        type: "whatsapp_disconnected",
        title: "واتساپ قطع شد",
        body: `${row?.label || client.sessionKey}: ${reason === "authentication_failed" ? "نشست منقضی شد." : "ارتباط واتساپ قطع شد."}`
      });
    }
  });
  client.on("inbox", (payload) => {
    io.emit("inbox:message", { sessionKey: client.sessionKey, ...payload });
    autoReplyService.handleIncoming({ sessionKey: client.sessionKey, ...payload }).catch(() => {});
  });
  client.on("group-message", (payload) => {
    groupLinkMonitor
      .handleGroupMessage({ sessionKey: client.sessionKey, ...payload })
      .catch((err) => logger.warn({ err: err.message }, "link monitor"));
  });
  client.on("private-message", (payload) => {
    outreachService.handleIncoming({ sessionKey: client.sessionKey, ...payload });
  });
  client.on("groups-synced", () => {
    groupLinkMonitor.refreshJoined();
    outreachService.markFollowUps();
  });
}

waManager.onClient(bindWhatsAppClient);

waManager.startAll().catch((err) => logger.warn({ err: err.message }, "restore sessions"));

cron.schedule("*/20 * * * * *", () => {
  campaignQueue.processScheduled();
});

cron.schedule("15 * * * *", () => {
  const hours = Number(getSetting("finder_schedule_hours", "0")) || 0;
  if (!hours || publicGroupScanner.running) return;
  const last = getDb().prepare("SELECT started_at FROM public_group_scans ORDER BY id DESC LIMIT 1").get();
  if (last) {
    const then = new Date(String(last.started_at).replace(" ", "T") + "Z").getTime();
    if (Date.now() - then < hours * 3600 * 1000 - 60000) return;
  }
  publicGroupScanner
    .start({ cities: CITIES.map((c) => c.id), userId: null })
    .catch((err) => logger.warn({ err: err.message }, "scheduled finder scan skipped"));
});

cron.schedule("20 * * * *", () => {
  outreachService.markFollowUps();
});

process.on("uncaughtException", (err) => {
  logger.error({ err: err.message, stack: err.stack }, "uncaughtException");
});
process.on("unhandledRejection", (err) => {
  logger.error({ err: err?.message || String(err) }, "unhandledRejection");
});

server.on("error", (err) => {
  logger.error({ err: err.message }, "http server error");
  if (err.code === "EADDRINUSE") {
    logger.error(`Port ${config.port} is already in use. Stop the other process or Docker container.`);
    process.exit(1);
  }
});

server.listen(config.port, "0.0.0.0", () => {
  systemLog("server_start", `Listening on ${config.port}`);
  logger.info(`WhatsApp Campaign Manager on port ${config.port}`);
});
