import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { getDb, getSetting, setSetting } from "../../../database/index.js";
import { config } from "../../../config/index.js";
import { aiService } from "../../../services/ai/AiService.js";
import { auditLog } from "../utils/logger.js";

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

settingsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const rows = getDb().prepare("SELECT key, value FROM settings").all();
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    if (req.user.role !== "admin") {
      delete map.telegram_bot_token;
    } else if (map.telegram_bot_token) {
      map.telegram_bot_token = mask(map.telegram_bot_token);
    }
    res.json({
      settings: map,
      limits: {
        minDelaySeconds: config.minDelaySeconds,
        maxDelaySeconds: config.maxDelaySeconds,
        defaultDelaySeconds: config.defaultDelaySeconds,
        maxUploadMb: config.maxUploadBytes / (1024 * 1024),
        maxRetryAttempts: config.maxRetryAttempts,
        maxConsecutiveFailures: config.maxConsecutiveFailures
      },
      ai: { enabled: aiService.enabled(), mode: aiService.mode() }
    });
  })
);

const schema = z.object({
  brand_name: z.string().max(80).optional(),
  telegram_enabled: z.enum(["true", "false"]).optional(),
  telegram_bot_token: z.string().max(200).optional(),
  telegram_chat_id: z.string().max(80).optional(),
  ai_mode: z.enum(["suggest", "rules"]).optional(),
  theme: z.enum(["dark", "light"]).optional()
});

settingsRouter.put(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "تنظیمات نامعتبر است");
    for (const [k, v] of Object.entries(parsed.data)) {
      if (k === "telegram_bot_token" && (!v || v.includes("•"))) continue;
      setSetting(k, v);
    }
    auditLog(req.user.id, "settings_update", "settings changed", req.ip);
    res.json({ ok: true });
  })
);

settingsRouter.get(
  "/users",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const users = getDb()
      .prepare("SELECT id, username, display_name, role, active, created_at, last_login_at FROM users")
      .all();
    res.json({ users });
  })
);

const userSchema = z.object({
  username: z.string().min(3).max(32),
  password: z.string().min(8).max(128),
  displayName: z.string().max(80).optional(),
  role: z.enum(["admin", "operator"])
});

settingsRouter.post(
  "/users",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const parsed = userSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "کاربر نامعتبر است");
    const hash = bcrypt.hashSync(parsed.data.password, 12);
    try {
      const info = getDb()
        .prepare("INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)")
        .run(parsed.data.username, hash, parsed.data.displayName || parsed.data.username, parsed.data.role);
      auditLog(req.user.id, "user_create", parsed.data.username, req.ip);
      res.status(201).json({ id: Number(info.lastInsertRowid) });
    } catch {
      throw new HttpError(409, "نام کاربری تکراری است");
    }
  })
);

settingsRouter.get(
  "/audit",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const logs = getDb().prepare("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200").all();
    const system = getDb().prepare("SELECT * FROM system_logs ORDER BY id DESC LIMIT 200").all();
    res.json({ audit: logs, system });
  })
);

settingsRouter.get(
  "/backup",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const tables = [
      "users",
      "groups",
      "campaigns",
      "campaign_groups",
      "message_templates",
      "auto_reply_rules",
      "quick_replies",
      "settings"
    ];
    const dump = {};
    for (const t of tables) dump[t] = getDb().prepare(`SELECT * FROM ${t}`).all();
    dump.users = dump.users.map((u) => {
      const { password_hash, ...rest } = u;
      return rest;
    });
    res.json({ createdAt: new Date().toISOString(), dump });
  })
);

function mask(value) {
  if (!value || value.length < 8) return "••••";
  return `${value.slice(0, 4)}••••${value.slice(-3)}`;
}
