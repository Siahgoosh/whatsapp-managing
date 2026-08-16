import assert from "node:assert/strict";
import { after, test } from "node:test";
import { setupApp, login, seedGroups, mockWhatsApp, campaignQueue, getDb, request } from "./helpers.js";
import { matchRule, pickRule } from "../../services/autoreply/matcher.js";
import { isAllowedUpload } from "../src/utils/files.js";
import { estimateDurationSeconds } from "../src/utils/persian.js";
import { campaignService } from "../../services/campaign/CampaignService.js";

after(() => campaignQueue.stopLoop());

test("health check", async () => {
  const { app } = setupApp();
  const res = await request(app).get("/health");
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.port, 9454);
  assert.ok(res.body.features.includes("outreach"));
  assert.ok(res.body.features.includes("discovery"));
});

test("login success, logout, and rejected bad password", async () => {
  const { app } = setupApp();
  const bad = await request(app).post("/api/auth/login").send({ username: "admin", password: "wrong" });
  assert.equal(bad.status, 401);
  const { agent, csrf, res } = await login(app);
  assert.equal(res.status, 200);
  assert.equal(res.body.user.role, "admin");
  assert.ok(csrf);
  const me = await agent.get("/api/auth/me");
  assert.equal(me.body.user.username, "admin");
  const out = await agent.post("/api/auth/logout").set("X-CSRF-Token", csrf).send({});
  assert.equal(out.status, 200);
});

test("protected APIs require authentication", async () => {
  const { app } = setupApp();
  const res = await request(app).get("/api/groups");
  assert.equal(res.status, 401);
});

test("CSRF is required for mutations", async () => {
  const { app } = setupApp();
  const { agent } = await login(app);
  const res = await agent.post("/api/whatsapp/connect").send({});
  assert.equal(res.status, 403);
});

test("dashboard stats endpoint", async () => {
  const { app } = setupApp();
  const { agent } = await login(app);
  const res = await agent.get("/api/dashboard");
  assert.equal(res.status, 200);
  assert.ok("stats" in res.body);
});

test("whatsapp status and empty QR when disconnected", async () => {
  const { app } = setupApp();
  const { agent } = await login(app);
  const st = await agent.get("/api/whatsapp/status");
  assert.equal(st.body.status, "disconnected");
  const qr = await agent.get("/api/whatsapp/qr");
  assert.equal(qr.body.qr, null);
});

test("QR payload is available in qr_required status without leaking session files", async () => {
  const { app } = setupApp();
  const { waManager } = await import("./helpers.js");
  const wa = waManager.primary();
  wa.status = "qr_required";
  wa.qrDataUrl = "data:image/png;base64,qq";
  const { agent } = await login(app);
  const qr = await agent.get("/api/whatsapp/qr");
  assert.equal(qr.body.qr, "data:image/png;base64,qq");
});

test("groups search/filter and membership-only list", async () => {
  const { app } = setupApp();
  seedGroups(2);
  getDb()
    .prepare("UPDATE groups SET membership_status = 'left' WHERE name LIKE '%2'")
    .run();
  const { agent } = await login(app);
  const res = await agent.get("/api/groups");
  assert.equal(res.status, 200);
  assert.equal(res.body.groups.length, 1);
});

test("campaign rejects delay below conservative minimum in production config", async () => {
  const { app } = setupApp();
  const { ids, sessionId } = seedGroups(1);
  const user = getDb().prepare("SELECT * FROM users WHERE username = 'admin'").get();
  assert.throws(() => {
    campaignService.create(
      { id: user.id, role: "admin" },
      {
        sessionId,
        name: "x",
        message: "hi",
        groupIds: ids,
        delayMin: -1,
        delayMax: 5,
        randomDelay: false
      }
    );
  });
});

test("cannot create campaign for groups the account left", async () => {
  const { app } = setupApp();
  const { ids, sessionId } = seedGroups(1);
  getDb().prepare("UPDATE groups SET membership_status = 'left' WHERE id = ?").run(ids[0]);
  const user = getDb().prepare("SELECT * FROM users WHERE username = 'admin'").get();
  assert.throws(() => {
    campaignService.create(
      { id: user.id, role: "admin" },
      { sessionId, name: "bad", message: "m", groupIds: ids, delayMin: 0, delayMax: 0, randomDelay: false }
    );
  });
});

test("campaign create, queue, delay, pause, resume, stop", async () => {
  const { app } = setupApp();
  mockWhatsApp({ delayMs: 250 });
  const { ids } = seedGroups(3);
  const { agent, csrf } = await login(app);
  const created = await agent
    .post("/api/campaigns")
    .set("X-CSRF-Token", csrf)
    .send({ name: "کمپین تست", message: "سلام", groupIds: ids, delayMin: 0, delayMax: 0, randomDelay: false });
  assert.equal(created.status, 201);
  const id = created.body.campaign.id;

  const started = await agent.post(`/api/campaigns/${id}/start`).set("X-CSRF-Token", csrf).send({});
  assert.equal(started.status, 200);
  await waitFor(() => getDb().prepare("SELECT status FROM campaigns WHERE id = ?").get(id).status === "sending" || getDb().prepare("SELECT sent_count FROM campaigns WHERE id = ?").get(id).sent_count > 0);

  const paused = await agent.post(`/api/campaigns/${id}/pause`).set("X-CSRF-Token", csrf).send({});
  assert.equal(paused.body.status, "paused");

  const resumed = await agent.post(`/api/campaigns/${id}/resume`).set("X-CSRF-Token", csrf).send({});
  assert.ok(["queued", "sending", "completed"].includes(resumed.body.status));

  await agent.post(`/api/campaigns/${id}/stop`).set("X-CSRF-Token", csrf).send({});
  const stopped = getDb().prepare("SELECT status FROM campaigns WHERE id = ?").get(id);
  assert.equal(stopped.status, "stopped");
  const pending = getDb().prepare("SELECT COUNT(*) AS c FROM campaign_groups WHERE campaign_id = ? AND status = 'pending'").get(id).c;
  assert.equal(pending, 0);
});

test("retry once then fail, then continue", async () => {
  const { app } = setupApp();
  mockWhatsApp({ failTimes: 2 });
  const { ids } = seedGroups(1);
  const { agent, csrf } = await login(app);
  const created = await agent
    .post("/api/campaigns")
    .set("X-CSRF-Token", csrf)
    .send({ name: "retry", message: "x", groupIds: ids, delayMin: 0, delayMax: 0, randomDelay: false });
  await agent.post(`/api/campaigns/${created.body.campaign.id}/start`).set("X-CSRF-Token", csrf).send({});
  await waitFor(() => {
    const row = getDb().prepare("SELECT status FROM campaign_groups WHERE campaign_id = ?").get(created.body.campaign.id);
    return row.status === "failed";
  }, 8000);
  const g = getDb().prepare("SELECT * FROM campaign_groups WHERE campaign_id = ?").get(created.body.campaign.id);
  assert.equal(g.status, "failed");
  assert.ok(g.retry_count >= 1);
});

test("rate-limit pauses whole campaign", async () => {
  const { app } = setupApp();
  mockWhatsApp({ rateLimit: true });
  const { ids } = seedGroups(2);
  const { agent, csrf } = await login(app);
  const created = await agent
    .post("/api/campaigns")
    .set("X-CSRF-Token", csrf)
    .send({ name: "rl", message: "x", groupIds: ids, delayMin: 0, delayMax: 0, randomDelay: false });
  await agent.post(`/api/campaigns/${created.body.campaign.id}/start`).set("X-CSRF-Token", csrf).send({});
  await waitFor(() => getDb().prepare("SELECT status FROM campaigns WHERE id = ?").get(created.body.campaign.id).status === "paused");
  const c = getDb().prepare("SELECT pause_reason FROM campaigns WHERE id = ?").get(created.body.campaign.id);
  assert.equal(c.pause_reason, "rate_limit");
});

test("disconnect pauses campaigns", async () => {
  const { app } = setupApp();
  mockWhatsApp();
  const { ids } = seedGroups(2);
  const { agent, csrf } = await login(app);
  const created = await agent
    .post("/api/campaigns")
    .set("X-CSRF-Token", csrf)
    .send({ name: "disc", message: "x", groupIds: ids, delayMin: 0, delayMax: 0, randomDelay: false });
  const id = created.body.campaign.id;
  await agent.post(`/api/campaigns/${id}/start`).set("X-CSRF-Token", csrf).send({});
  getDb().prepare("UPDATE campaigns SET status = 'sending' WHERE id = ?").run(id);
  campaignQueue.pauseAll("whatsapp_disconnected");
  const c = getDb().prepare("SELECT status, pause_reason FROM campaigns WHERE id = ?").get(id);
  assert.equal(c.status, "paused");
  assert.equal(c.pause_reason, "whatsapp_disconnected");
});

test("auto-reply matcher exact/contains/case", () => {
  const contains = { enabled: 1, keyword: "قیمت", match_type: "contains", case_insensitive: 1 };
  const exact = { enabled: 1, keyword: "مشاور", match_type: "exact", case_insensitive: 1 };
  assert.equal(matchRule(contains, "لطفا قیمت بدهید"), true);
  assert.equal(matchRule(exact, "مشاور"), true);
  assert.equal(matchRule(exact, "مشاور املاک"), false);
  const rule = pickRule(
    [{ ...contains, apply_to: "private", enabled: 1 }],
    "قیمت",
    "group"
  );
  assert.equal(rule, null);
});

test("file validation rejects unsafe types and oversized names", () => {
  assert.equal(isAllowedUpload({ originalname: "a.exe", mimetype: "application/x-msdownload", size: 10 }), false);
  assert.equal(isAllowedUpload({ originalname: "pic.jpg", mimetype: "image/jpeg", size: 1000 }), true);
  assert.equal(isAllowedUpload({ originalname: "pic.jpg", mimetype: "image/jpeg", size: 80 * 1024 * 1024 }), false);
});

test("image campaign attachment is stored", async () => {
  const { app } = setupApp();
  const { ids } = seedGroups(1);
  const { agent, csrf } = await login(app);
  const buf = Buffer.from("\xFF\xD8\xFF\xD9");
  const res = await agent
    .post("/api/campaigns")
    .set("X-CSRF-Token", csrf)
    .field("name", "img")
    .field("message", "عکس")
    .field("groupIds", JSON.stringify(ids))
    .field("delayMin", "0")
    .field("delayMax", "0")
    .field("randomDelay", "false")
    .attach("file", buf, { filename: "a.jpg", contentType: "image/jpeg" });
  assert.equal(res.status, 201);
  assert.ok(res.body.attachment);
});

test("templates, auto-replies, quick replies, scheduler list, logs", async () => {
  const { app } = setupApp();
  const { agent, csrf } = await login(app);
  const t = await agent.post("/api/templates").set("X-CSRF-Token", csrf).field("title", "فروش زمین").field("message", "زمین").field("tags", "زمین");
  assert.equal(t.status, 201);
  const r = await agent.post("/api/auto-replies").set("X-CSRF-Token", csrf).send({
    keyword: "قیمت",
    response: "سلام، برای دریافت قیمت لطفاً نام فایل موردنظر را ارسال کنید.",
    matchType: "contains"
  });
  assert.equal(r.status, 201);
  const q = await agent.post("/api/quick-replies").set("X-CSRF-Token", csrf).send({ shortcut: "/hello", message: "سلام" });
  assert.equal(q.status, 201);
  const sch = await agent.get("/api/scheduler");
  assert.equal(sch.status, 200);
  const { ids } = seedGroups(1);
  const c = await agent.post("/api/campaigns").set("X-CSRF-Token", csrf).send({
    name: "sched",
    message: "x",
    groupIds: ids,
    delayMin: 0,
    delayMax: 0,
    scheduledAt: "2099-01-01 18:30:00"
  });
  assert.equal(c.body.campaign.status, "scheduled");
  const logs = await agent.get(`/api/campaigns/${c.body.campaign.id}/logs`);
  assert.ok(logs.body.logs.length >= 1);
});

test("inbox reply requires connection", async () => {
  const { app } = setupApp();
  const { agent, csrf } = await login(app);
  const res = await agent.post("/api/inbox/reply").set("X-CSRF-Token", csrf).send({ chatId: "x@s.whatsapp.net", text: "hi" });
  assert.equal(res.status, 409);
});

test("estimated duration helper", () => {
  assert.equal(estimateDurationSeconds(5, 3, 3, false), 12);
});

test("security headers present", async () => {
  const { app } = setupApp();
  const res = await request(app).get("/health");
  assert.ok(res.headers["x-content-type-options"]);
  const csp = String(res.headers["content-security-policy"] || "");
  assert.equal(csp.includes("upgrade-insecure-requests"), false);
  assert.equal(Boolean(res.headers["strict-transport-security"]), false);
});

async function waitFor(fn, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (fn()) return;
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error("timeout");
}
