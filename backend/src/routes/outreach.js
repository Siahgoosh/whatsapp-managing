import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { outreachService } from "../../../services/outreach/OutreachService.js";
import { withAccount } from "../../../services/accounts/AccountService.js";
import { auditLog } from "../utils/logger.js";

export const outreachRouter = Router();
outreachRouter.use(requireAuth);

const idsSchema = z.object({
  groupIds: z.array(z.coerce.number()).min(1).optional(),
  adminIds: z.array(z.coerce.number()).min(1).optional(),
  template: z.string().max(4000).optional(),
  officeName: z.string().max(80).optional(),
  messages: z.record(z.string()).optional(),
  confirm: z.boolean().optional(),
  confirmCount: z.coerce.number().optional(),
  force: z.boolean().optional()
});

outreachRouter.get(
  "/groups",
  asyncHandler(async (req, res) => {
    const { account } = withAccount(req);
    res.json({
      groups: outreachService.listTargetGroups({ q: req.query.q || "", sessionKey: account.sessionKey }),
      cities: outreachService.cities()
    });
  })
);

outreachRouter.get(
  "/admins",
  asyncHandler(async (req, res) => {
    const { account } = withAccount(req);
    res.json({
      admins: outreachService.listAdmins({
        q: req.query.q || "",
        group: req.query.group || "",
        city: req.query.city || "",
        permission: req.query.permission || "",
        status: req.query.status || "",
        dateFrom: req.query.dateFrom || "",
        dateTo: req.query.dateTo || "",
        sessionKey: account.sessionKey
      })
    });
  })
);

outreachRouter.get(
  "/template",
  asyncHandler(async (req, res) => {
    res.json({ template: outreachService.template(), officeName: outreachService.officeName() });
  })
);

outreachRouter.put(
  "/template",
  asyncHandler(async (req, res) => {
    const parsed = z
      .object({ template: z.string().max(4000).optional(), officeName: z.string().max(80).optional() })
      .safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "قالب نامعتبر است");
    res.json(outreachService.saveTemplate(parsed.data));
  })
);

outreachRouter.get(
  "/analytics",
  asyncHandler(async (req, res) => {
    const { account } = withAccount(req);
    res.json(outreachService.analytics(account.sessionKey));
  })
);

outreachRouter.get(
  "/inbox",
  asyncHandler(async (req, res) => {
    const { account } = withAccount(req);
    res.json({ conversations: outreachService.inbox(account.sessionKey) });
  })
);

outreachRouter.get(
  "/admins/:id",
  asyncHandler(async (req, res) => {
    res.json({ admin: outreachService.adminRow(req.params.id) });
  })
);

outreachRouter.get(
  "/admins/:id/history",
  asyncHandler(async (req, res) => {
    res.json({ history: outreachService.history(req.params.id) });
  })
);

outreachRouter.get(
  "/admins/:id/preview",
  asyncHandler(async (req, res) => {
    res.json(outreachService.preview(req.params.id, req.query.template));
  })
);

outreachRouter.post(
  "/detect",
  asyncHandler(async (req, res) => {
    const parsed = idsSchema.safeParse(req.body);
    if (!parsed.success || !parsed.data.groupIds?.length) throw new HttpError(400, "گروهی انتخاب نشده");
    const { wa } = withAccount(req);
    if (!wa.isConnected()) throw new HttpError(409, "واتساپ متصل نیست");
    const result = await outreachService.detectAdmins(parsed.data.groupIds, wa);
    auditLog(req.user.id, "outreach_detect", `groups=${parsed.data.groupIds.length}`, req.ip);
    res.json(result);
  })
);

outreachRouter.post(
  "/prepare",
  asyncHandler(async (req, res) => {
    const parsed = idsSchema.safeParse(req.body);
    if (!parsed.success || !parsed.data.adminIds?.length) throw new HttpError(400, "مدیری انتخاب نشده");
    res.json(outreachService.prepare(parsed.data.adminIds, parsed.data.template, req.user.id));
  })
);

outreachRouter.post(
  "/approve",
  asyncHandler(async (req, res) => {
    const parsed = idsSchema.safeParse(req.body);
    if (!parsed.success || !parsed.data.adminIds?.length) throw new HttpError(400, "مدیری انتخاب نشده");
    res.json(outreachService.approve(parsed.data.adminIds, parsed.data.messages || {}));
  })
);

outreachRouter.post(
  "/send",
  asyncHandler(async (req, res) => {
    const parsed = idsSchema.safeParse(req.body);
    if (!parsed.success || !parsed.data.adminIds?.length) throw new HttpError(400, "مدیری انتخاب نشده");
    const { wa } = withAccount(req);
    if (!wa.isConnected()) throw new HttpError(409, "واتساپ متصل نیست");
    const result = await outreachService.send({
      adminIds: parsed.data.adminIds,
      confirm: parsed.data.confirm,
      confirmCount: parsed.data.confirmCount,
      force: parsed.data.force,
      userId: req.user.id,
      wa
    });
    res.json(result);
  })
);

outreachRouter.post(
  "/notes",
  asyncHandler(async (req, res) => {
    const parsed = z
      .object({
        adminId: z.coerce.number().optional(),
        groupId: z.coerce.number().optional(),
        body: z.string().min(1).max(2000)
      })
      .safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "یادداشت نامعتبر است");
    res.json(outreachService.addNote({ ...parsed.data, userId: req.user.id }));
  })
);

outreachRouter.post(
  "/permission",
  asyncHandler(async (req, res) => {
    const parsed = z
      .object({
        groupId: z.coerce.number(),
        adminId: z.coerce.number().optional(),
        status: z.enum(["unknown", "requested", "approved", "declined", "blocked"]),
        marketing: z.boolean().optional()
      })
      .safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "وضعیت اجازه نامعتبر است");
    const result = parsed.data.marketing
      ? outreachService.markMarketingGroup(parsed.data.groupId, req.user.id)
      : outreachService.setPermission(parsed.data.groupId, parsed.data.status, parsed.data.adminId, req.user.id);
    res.json(result);
  })
);

outreachRouter.post(
  "/follow-ups",
  asyncHandler(async (req, res) => {
    res.json(outreachService.markFollowUps());
  })
);
