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
  socket.emit("whatsapp:status", waManager.primary().publicStatus());
});

notificationService.attach(io);
campaignQueue.attach(io);
campaignQueue.ensureLoop();

const wa = waManager.primary();
wa.on("status", (status) => io.emit("whatsapp:status", status));
wa.on("qr", () => io.emit("whatsapp:qr", { hasQr: true }));
wa.on("disconnected", ({ reason }) => {
  if (reason === "authentication_failed" || reason === "reconnecting") {
    campaignQueue.pauseAll(reason === "authentication_failed" ? "session_expired" : "whatsapp_disconnected");
    notificationService.create({
      type: "whatsapp_disconnected",
      title: "واتساپ قطع شد",
      body: reason === "authentication_failed" ? "نشست منقضی شد." : "ارتباط واتساپ قطع شد."
    });
  }
});
wa.on("inbox", (payload) => {
  io.emit("inbox:message", payload);
  autoReplyService.handleIncoming({ sessionKey: "default", ...payload }).catch(() => {});
});

waManager.startAll().catch((err) => logger.warn({ err: err.message }, "restore sessions"));

cron.schedule("*/20 * * * * *", () => {
  campaignQueue.processScheduled();
});

server.listen(config.port, "0.0.0.0", () => {
  systemLog("server_start", `Listening on ${config.port}`);
  logger.info(`WhatsApp Campaign Manager on port ${config.port}`);
});
