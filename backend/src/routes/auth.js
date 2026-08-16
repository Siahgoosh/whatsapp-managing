import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getDb } from "../../../database/index.js";
import { sessionStore } from "../middleware/sessionStore.js";
import { setSessionCookie, clearSessionCookie, requireAuth } from "../middleware/auth.js";
import { loginLimiter } from "../middleware/security.js";
import { asyncHandler } from "../utils/errors.js";
import { auditLog, systemLog } from "../utils/logger.js";
import { HttpError } from "../utils/errors.js";

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128)
});

authRouter.post(
  "/login",
  loginLimiter(),
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "اطلاعات ورود نامعتبر است");
    const user = getDb().prepare("SELECT * FROM users WHERE username = ? AND active = 1").get(parsed.data.username);
    if (!user || !bcrypt.compareSync(parsed.data.password, user.password_hash)) {
      systemLog("login_failed", "Failed login attempt", { ip: req.ip });
      throw new HttpError(401, "نام کاربری یا رمز عبور اشتباه است");
    }
    const sess = sessionStore.get().create(user.id);
    getDb().prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
    setSessionCookie(res, sess.sid, sess.expiresAt);
    systemLog("login", "User logged in", { userId: user.id, ip: req.ip });
    auditLog(user.id, "login", "successful login", req.ip);
    res.json({
      user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role },
      csrfToken: sess.csrfSecret
    });
  })
);

authRouter.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    sessionStore.get().destroy(req.sessionId);
    clearSessionCookie(res);
    systemLog("logout", "User logged out", { userId: req.user.id, ip: req.ip });
    res.json({ ok: true });
  })
);

authRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    if (!req.user) return res.json({ user: null, csrfToken: null });
    res.json({
      user: {
        id: req.user.id,
        username: req.user.username,
        displayName: req.user.display_name,
        role: req.user.role
      },
      csrfToken: req.csrfToken
    });
  })
);
