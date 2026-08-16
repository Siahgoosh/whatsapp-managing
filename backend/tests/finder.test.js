import "./env.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp, login, seedGroups, getDb } from "./helpers.js";
import { CITIES, generateQueries } from "../../services/finder/cities.js";
import { extractInviteLinks, normalizeInviteUrl } from "../../services/finder/links.js";
import { assertPublicHttpUrl } from "../../services/finder/ssrf.js";
import { _pathAllowedForTests } from "../../services/finder/robots.js";
import { upsertPublicGroup, listPublicGroups } from "../../services/finder/store.js";
import { PublicGroupScanner } from "../../services/finder/Scanner.js";
import { refreshJoinedStatus } from "../../services/finder/joined.js";

test("query generator covers target cities and chat.whatsapp.com queries", () => {
  const lamerd = CITIES.find((c) => c.id === "lamerd");
  const qs = generateQueries(lamerd);
  assert.ok(qs.some((q) => q.includes("واتساپ لامرد")));
  assert.ok(qs.some((q) => q.includes("chat.whatsapp.com")));
  assert.equal(CITIES.length, 7);
});

test("invite link normalize and extract", () => {
  assert.equal(
    normalizeInviteUrl("http://chat.whatsapp.com/AbCdEfGhIjKlMnOp/?x=1"),
    "https://chat.whatsapp.com/AbCdEfGhIjKlMnOp"
  );
  assert.equal(normalizeInviteUrl("https://evil.example/chat.whatsapp.com/abc"), null);
  const found = extractInviteLinks("see https://chat.whatsapp.com/AbCdEfGhIjKlMnOp and again https://chat.whatsapp.com/AbCdEfGhIjKlMnOp");
  assert.equal(found.length, 1);
});

test("SSRF blocks localhost, private IPs, and non-http", async () => {
  await assert.rejects(() => assertPublicHttpUrl("file:///etc/passwd"));
  await assert.rejects(() => assertPublicHttpUrl("http://127.0.0.1/secret"));
  await assert.rejects(() => assertPublicHttpUrl("http://localhost/admin"));
  await assert.rejects(() => assertPublicHttpUrl("http://192.168.1.8/x"));
});

test("robots.txt disallow root is skipped", () => {
  assert.equal(_pathAllowedForTests("/any", "User-agent: *\nDisallow: /\n"), false);
  assert.equal(_pathAllowedForTests("/public", "User-agent: *\nDisallow: /private\n"), true);
});

test("duplicate public groups keep extra sources", () => {
  setupApp();
  const a = upsertPublicGroup({
    url: "https://chat.whatsapp.com/AbCdEfGhIjKlMnOp",
    city: "لامرد",
    title: "املاک لامرد",
    sourceType: "search_engine",
    sourceWebsite: "google"
  });
  const b = upsertPublicGroup({
    url: "https://chat.whatsapp.com/AbCdEfGhIjKlMnOp",
    city: "لامرد",
    title: "املاک لامرد",
    sourceType: "website",
    sourceWebsite: "example.com"
  });
  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, true);
  const sources = getDb().prepare("SELECT * FROM group_sources").all();
  assert.equal(sources.length, 2);
  assert.equal(listPublicGroups({ city: "لامرد" }).length, 1);
});

test("finder API: unconfigured scan, csv import, invalid url, campaign requires membership", async () => {
  const { app } = setupApp();
  const { agent, csrf } = await login(app);
  const meta = await agent.get("/api/finder/meta");
  assert.equal(meta.body.configured, false);
  const scan = await agent.post("/api/finder/scan").set("X-CSRF-Token", csrf).send({ cities: ["lamerd"] });
  assert.equal(scan.status, 400);

  const bad = await agent.post("/api/finder/groups").set("X-CSRF-Token", csrf).send({
    groupName: "x",
    city: "لامرد",
    url: "https://example.com/not-wa"
  });
  assert.equal(bad.status, 400);

  const csv = await agent.post("/api/finder/import").set("X-CSRF-Token", csrf).send({
    csv: "city,group_name,url\nLamerd,گروه املاک لامرد,https://chat.whatsapp.com/AbCdEfGhIjKlMnOp\nLamerd,dup,https://chat.whatsapp.com/AbCdEfGhIjKlMnOp\nMehr,bad,https://example.com/no"
  });
  assert.equal(csv.status, 200);
  assert.equal(csv.body.imported, 1);
  assert.equal(csv.body.duplicates, 1);
  assert.equal(csv.body.invalid, 1);

  const dash = await agent.get("/api/dashboard");
  assert.ok("finder" in dash.body.stats);

  const toCamp = await agent.post("/api/finder/add-to-campaign").set("X-CSRF-Token", csrf).send({
    ids: [getDb().prepare("SELECT id FROM public_whatsapp_groups").get().id],
    name: "از یابنده"
  });
  assert.equal(toCamp.status, 400);
});

test("fake search scan extracts public invite without joining", async () => {
  const { app } = setupApp();
  const fake = {
    name: "fake",
    enabled: () => true,
    search: async () => [
      {
        url: "https://example.com/public-dir",
        title: "گروه لامرد",
        snippet: "لینک https://chat.whatsapp.com/ZzYyXxWwVvUuTtSsRr",
        sourceWebsite: "example.com",
        sourceType: "search_engine"
      }
    ]
  };
  const scanner = new PublicGroupScanner({ providers: [fake] });
  await scanner.start({ cities: ["lamerd"] });
  const start = Date.now();
  while (scanner.running && Date.now() - start < 5000) {
    await new Promise((r) => setTimeout(r, 20));
  }
  const groups = getDb().prepare("SELECT * FROM public_whatsapp_groups").all();
  assert.equal(groups.length, 1);
  assert.equal(groups[0].normalized_url, "https://chat.whatsapp.com/ZzYyXxWwVvUuTtSsRr");
  const { agent } = await login(app);
  const list = await agent.get("/api/finder/groups");
  assert.equal(list.status, 200);
});

test("already joined detection by public group name", () => {
  setupApp();
  seedGroups(1);
  getDb().prepare("UPDATE groups SET name = ? WHERE id = 1").run("خرید و فروش ملک لامرد");
  upsertPublicGroup({
    url: "https://chat.whatsapp.com/JoinMatchCode99",
    city: "لامرد",
    title: "خرید و فروش ملک لامرد",
    sourceType: "user_added"
  });
  refreshJoinedStatus();
  const row = getDb().prepare("SELECT joined_status FROM public_whatsapp_groups").get();
  assert.equal(row.joined_status, "joined");
});
