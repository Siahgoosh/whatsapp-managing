import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { getDb } from "../../../database/index.js";
import { CITIES, CATEGORIES, generateQueries } from "../../../services/finder/cities.js";
import { publicGroupScanner } from "../../../services/finder/Scanner.js";
import { listPublicGroups, finderStats, upsertPublicGroup } from "../../../services/finder/store.js";
import { normalizeInviteUrl } from "../../../services/finder/links.js";
import { validateInvite } from "../../../services/finder/validate.js";
import { refreshJoinedStatus } from "../../../services/finder/joined.js";
import { getEnabledProviders } from "../../../services/finder/providers.js";
import { config } from "../../../config/index.js";
import { campaignService } from "../../../services/campaign/CampaignService.js";
import { getSetting, setSetting } from "../../../database/index.js";
import { systemLog } from "../utils/logger.js";

export const finderRouter = Router();
finderRouter.use(requireAuth);

finderRouter.get(
  "/meta",
  asyncHandler(async (req, res) => {
    const providers = getEnabledProviders(config).map((p) => p.name);
    res.json({
      cities: CITIES,
      categories: CATEGORIES,
      providers,
      configured: providers.length > 0,
      scheduleHours: Number(getSetting("finder_schedule_hours", "0")) || 0
    });
  })
);

finderRouter.get(
  "/queries",
  asyncHandler(async (req, res) => {
    const city = CITIES.find((c) => c.id === req.query.city);
    res.json({ queries: city ? generateQueries(city) : [] });
  })
);

finderRouter.get(
  "/groups",
  asyncHandler(async (req, res) => {
    refreshJoinedStatus();
    res.json({
      groups: listPublicGroups({
        q: req.query.q || "",
        city: req.query.city || "",
        status: req.query.status || "",
        category: req.query.category || "",
        sort: req.query.sort || "id"
      })
    });
  })
);

finderRouter.get(
  "/stats",
  asyncHandler(async (req, res) => {
    refreshJoinedStatus();
    res.json({ stats: finderStats() });
  })
);

finderRouter.get(
  "/scans",
  asyncHandler(async (req, res) => {
    res.json({
      scans: getDb().prepare("SELECT * FROM public_group_scans ORDER BY id DESC LIMIT 50").all(),
      current: publicGroupScanner.running ? publicGroupScanner.snapshot() : null
    });
  })
);

const scanSchema = z.object({
  cities: z.array(z.string()).min(1)
});

finderRouter.post(
  "/scan",
  asyncHandler(async (req, res) => {
    const parsed = scanSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "شهرها را انتخاب کنید");
    const snap = await publicGroupScanner.start({ cities: parsed.data.cities, userId: req.user.id });
    systemLog("finder_scan_started", "Public group scan started", { userId: req.user.id });
    res.status(202).json({ scan: snap });
  })
);

finderRouter.post(
  "/crawl",
  asyncHandler(async (req, res) => {
    const urls = Array.isArray(req.body.urls) ? req.body.urls : String(req.body.urlsText || "").split(/\s+/);
    const city = req.body.city || "لامرد";
    const result = await publicGroupScanner.crawlSeeds({ urls, city, userId: req.user.id });
    systemLog("finder_seed_crawl", "Crawled public seed URLs", { userId: req.user.id });
    res.json(result);
  })
);

const addSchema = z.object({
  groupName: z.string().min(1).max(120),
  city: z.string().min(1).max(40),
  url: z.string().min(8).max(400),
  category: z.string().max(40).optional(),
  notes: z.string().max(500).optional()
});

finderRouter.post(
  "/groups",
  asyncHandler(async (req, res) => {
    const parsed = addSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "داده گروه نامعتبر است");
    const normalized = normalizeInviteUrl(parsed.data.url);
    if (!normalized) throw new HttpError(400, "فقط لینک عمومی chat.whatsapp.com پذیرفته می‌شود");
    const saved = upsertPublicGroup({
      url: normalized,
      city: parsed.data.city,
      title: parsed.data.groupName,
      sourceType: "user_added",
      sourceWebsite: "manual",
      sourceUrl: normalized
    });
    if (saved.duplicate) throw new HttpError(409, "این لینک قبلاً ثبت شده");
    const checked = await validateInvite(normalized);
    getDb()
      .prepare(
        "UPDATE public_whatsapp_groups SET status = ?, http_status = ?, category = ?, notes = ?, last_checked_at = datetime('now') WHERE id = ?"
      )
      .run(
        checked.status,
        checked.httpStatus,
        parsed.data.category || "سایر",
        parsed.data.notes || "",
        saved.group.id
      );
    res.status(201).json({ group: getDb().prepare("SELECT * FROM public_whatsapp_groups WHERE id = ?").get(saved.group.id) });
  })
);

finderRouter.patch(
  "/groups/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const row = getDb().prepare("SELECT * FROM public_whatsapp_groups WHERE id = ?").get(id);
    if (!row) throw new HttpError(404, "گروه پیدا نشد");
    const category = req.body.category;
    const notes = req.body.notes;
    if (category && !CATEGORIES.includes(category)) throw new HttpError(400, "دسته نامعتبر");
    getDb()
      .prepare("UPDATE public_whatsapp_groups SET category = COALESCE(?, category), notes = COALESCE(?, notes), updated_at = datetime('now') WHERE id = ?")
      .run(category || null, notes ?? null, id);
    res.json({ group: getDb().prepare("SELECT * FROM public_whatsapp_groups WHERE id = ?").get(id) });
  })
);

finderRouter.post(
  "/groups/:id/recheck",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const row = getDb().prepare("SELECT * FROM public_whatsapp_groups WHERE id = ?").get(id);
    if (!row) throw new HttpError(404, "گروه پیدا نشد");
    const checked = await validateInvite(row.normalized_url);
    getDb()
      .prepare(
        "UPDATE public_whatsapp_groups SET status = ?, http_status = ?, last_checked_at = datetime('now') WHERE id = ?"
      )
      .run(checked.status, checked.httpStatus, id);
    res.json({ status: checked.status });
  })
);

finderRouter.post(
  "/import",
  asyncHandler(async (req, res) => {
    const csv = String(req.body.csv || "");
    const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) throw new HttpError(400, "CSV خالی است");
    const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const ci = header.indexOf("city");
    const ni = header.indexOf("group_name");
    const ui = header.indexOf("url");
    if (ci < 0 || ui < 0) throw new HttpError(400, "ستون‌های city و url لازم است");
    let imported = 0;
    let dups = 0;
    let invalid = 0;
    for (const line of lines.slice(1)) {
      const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      const url = cols[ui];
      const city = cols[ci];
      const name = ni >= 0 ? cols[ni] : "";
      const normalized = normalizeInviteUrl(url);
      if (!normalized) {
        invalid += 1;
        continue;
      }
      const saved = upsertPublicGroup({
        url: normalized,
        city,
        title: name || "گروه واردشده",
        sourceType: "user_added",
        sourceWebsite: "csv"
      });
      if (saved.duplicate) dups += 1;
      else if (saved.invalid) invalid += 1;
      else imported += 1;
    }
    res.json({ imported, duplicates: dups, invalid });
  })
);

const campaignSchema = z.object({
  ids: z.array(z.number()).min(1),
  name: z.string().min(2).max(120).optional()
});

finderRouter.post(
  "/add-to-campaign",
  asyncHandler(async (req, res) => {
    const parsed = campaignSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "انتخاب نامعتبر");
    refreshJoinedStatus();
    const placeholders = parsed.data.ids.map(() => "?").join(",");
    const found = getDb()
      .prepare(`SELECT * FROM public_whatsapp_groups WHERE id IN (${placeholders})`)
      .all(...parsed.data.ids);
    const members = getDb().prepare("SELECT * FROM groups WHERE membership_status = 'member'").all();
    const matched = [];
    const unmatched = [];
    for (const g of found) {
      const n = String(g.group_name || "").toLocaleLowerCase("fa");
      const hit = members.find(
        (m) =>
          String(m.name).toLocaleLowerCase("fa") === n ||
          String(m.name).toLocaleLowerCase("fa").includes(n) ||
          n.includes(String(m.name).toLocaleLowerCase("fa"))
      );
      if (hit && n && n !== "گروه واتساپ") matched.push(hit);
      else unmatched.push(g);
    }
    if (!matched.length) {
      throw new HttpError(
        400,
        "هیچ‌کدام از گروه‌های انتخاب‌شده در حساب واتساپ عضو نیستند. ابتدا Join را خودتان تأیید کنید، سپس همگام‌سازی گروه‌ها را بزنید."
      );
    }
    const session = getDb().prepare("SELECT id FROM whatsapp_sessions WHERE session_key = 'default'").get();
    const created = campaignService.create(req.user, {
      sessionId: session.id,
      name: parsed.data.name || "کمپین از گروه‌های عمومی",
      message: "",
      delayMin: config.defaultDelaySeconds,
      delayMax: config.defaultDelaySeconds,
      randomDelay: false,
      groupIds: [...new Set(matched.map((m) => m.id))]
    });
    res.status(201).json({ campaign: created.campaign, matched: matched.length, unmatched: unmatched.length });
  })
);

finderRouter.put(
  "/schedule",
  asyncHandler(async (req, res) => {
    const hours = Number(req.body.hours || 0);
    if (![0, 24, 48].includes(hours)) throw new HttpError(400, "فقط 0 (خاموش)، 24 یا 48 ساعت");
    setSetting("finder_schedule_hours", String(hours));
    res.json({ hours });
  })
);
