import { Router } from "express";
import { z } from "zod";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { campaignQueue } from "../../../queue/CampaignQueue.js";
import { notificationService } from "../../../services/notifications/NotificationService.js";
import { systemLog } from "../utils/logger.js";
import {
  accountsForUser,
  canUseAccount,
  clientFor,
  createAccount,
  renameAccount,
  resolveAccount,
  setActiveAccount
} from "../../../services/accounts/AccountService.js";

export const whatsappRouter = Router();
whatsappRouter.use(requireAuth);

function payload(req, client, account = resolveAccount(req)) {
  const live = client.publicStatus();
  return {
    ...live,
    qr: client.getQr(),
    account,
    accounts: accountsForUser(req.user)
  };
}

function clientOf(req, sessionId) {
  const account = sessionId ? accountsForUser(req.user).find((a) => a.id === Number(sessionId)) : resolveAccount(req);
  if (!account) throw new HttpError(404, "اکانت واتساپ پیدا نشد");
  if (!canUseAccount(req.user, account.id)) throw new HttpError(403, "این اکانت برای شما مجاز نیست");
  return { account, client: clientFor(account) };
}

whatsappRouter.get(
  "/status",
  asyncHandler(async (req, res) => {
    const { client } = clientOf(req, req.query.sessionId);
    res.json(payload(req, client));
  })
);

whatsappRouter.get(
  "/qr",
  asyncHandler(async (req, res) => {
    const { client } = clientOf(req, req.query.sessionId);
    res.json({ qr: client.getQr(), status: client.status, sessionKey: client.sessionKey });
  })
);

whatsappRouter.get(
  "/accounts",
  asyncHandler(async (req, res) => {
    res.json({ accounts: accountsForUser(req.user), active: resolveAccount(req) });
  })
);

whatsappRouter.post(
  "/accounts",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const parsed = z.object({ label: z.string().min(1).max(40) }).safeParse(req.body || {});
    if (!parsed.success) throw new HttpError(400, "نام اکانت لازم است");
    const account = createAccount(parsed.data.label);
    systemLog("whatsapp_account_create", account.label, { userId: req.user.id });
    res.status(201).json({ account, accounts: accountsForUser(req.user) });
  })
);

whatsappRouter.patch(
  "/accounts/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const parsed = z.object({ label: z.string().min(1).max(40) }).safeParse(req.body || {});
    if (!parsed.success) throw new HttpError(400, "نام اکانت نامعتبر است");
    res.json({ account: renameAccount(req.params.id, parsed.data.label) });
  })
);

whatsappRouter.post(
  "/active",
  asyncHandler(async (req, res) => {
    const parsed = z.object({ sessionId: z.coerce.number() }).safeParse(req.body || {});
    if (!parsed.success) throw new HttpError(400, "اکانت نامعتبر است");
    const account = setActiveAccount(req, parsed.data.sessionId);
    const client = clientFor(account);
    res.json(payload(req, client, account));
  })
);

whatsappRouter.post(
  "/connect",
  asyncHandler(async (req, res) => {
    const { account, client } = clientOf(req, req.body?.sessionId);
    const active = setActiveAccount(req, account.id);
    await client.start({ force: true });
    const qr = await client.waitForQr(15000);
    systemLog("whatsapp_connect", "Connect requested", {
      userId: req.user.id,
      ip: req.ip,
      sessionKey: account.sessionKey
    });
    res.json({ ...payload(req, client, active), qr: qr || client.getQr() });
  })
);

whatsappRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const { account, client } = clientOf(req, req.body?.sessionId);
    campaignQueue.pauseSession(account.id, "whatsapp_disconnected");
    await client.logout();
    notificationService.create({
      userId: req.user.id,
      type: "whatsapp_disconnected",
      title: "واتساپ قطع شد",
      body: `${account.label} خارج شد.`
    });
    res.json(payload(req, client, account));
  })
);

whatsappRouter.get(
  "/sessions",
  asyncHandler(async (req, res) => {
    res.json({ sessions: accountsForUser(req.user), active: resolveAccount(req) });
  })
);
