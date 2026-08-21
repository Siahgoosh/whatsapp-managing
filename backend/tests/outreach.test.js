import "./env.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp, login, seedGroups, mockWhatsApp, getDb } from "./helpers.js";
import { renderTemplate } from "../../services/outreach/template.js";
import { inferCityFromName } from "../../services/finder/cities.js";
import { outreachService } from "../../services/outreach/OutreachService.js";
import { groupLinkMonitor } from "../../services/outreach/GroupLinkMonitor.js";
import { extractInviteLinks } from "../../services/finder/links.js";
import { formatShareLinks, phoneToWhatsAppJid, chunkShareRows } from "../../services/outreach/phone.js";

function mockAdmins(wa, extraRegularIgnored = true) {
  wa.fetchGroupAdmins = async (waId) => {
    const g = getDb().prepare("SELECT * FROM groups WHERE wa_id = ?").get(waId);
    assert.equal(extraRegularIgnored, true);
    return {
      subject: g?.name || "گروه",
      size: 40,
      adminCount: 2,
      lastActivityAt: "2026-08-16 10:00:00",
      admins: [
        { jid: "989111111111@s.whatsapp.net", displayName: "علی", role: "superadmin" },
        { jid: "989222222222@s.whatsapp.net", displayName: "سارا", role: "admin" }
      ]
    };
  };
  return wa;
}

test("template personalization replaces supported variables only", () => {
  const out = renderTemplate("سلام {{admin_name}} در {{group_name}} / {{city}} / {{office_name}} {{secret}}", {
    admin_name: "علی",
    group_name: "املاک لامرد",
    city: "لامرد",
    office_name: "فرتاک"
  });
  assert.match(out, /علی/);
  assert.match(out, /املاک لامرد/);
  assert.match(out, /فرتاک/);
  assert.match(out, /\{\{secret\}\}/);
});

test("city tag is inferred from group name", () => {
  assert.equal(inferCityFromName("خرید و فروش ملک لامرد"), "لامرد");
  assert.equal(inferCityFromName("گروه گله دار"), "گله‌دار");
  assert.equal(inferCityFromName("unknown"), "سایر");
});

test("detect stores only group admins and never regular members", async () => {
  const { app } = setupApp();
  const { ids } = seedGroups(1);
  getDb().prepare("UPDATE groups SET name = 'خرید و فروش ملک لامرد' WHERE id = ?").run(ids[0]);
  const wa = mockAdmins(mockWhatsApp());
  const { agent, csrf } = await login(app);
  const res = await agent.post("/api/outreach/detect").set("X-CSRF-Token", csrf).send({ groupIds: ids });
  assert.equal(res.status, 200);
  assert.equal(res.body.stored, 2);
  assert.equal(res.body.skippedRegularMembers, 38);
  const rows = getDb().prepare("SELECT * FROM group_admins").all();
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.wa_jid.includes("@s.whatsapp.net")));
  assert.ok(!rows.some((r) => r.display_name === "" && r.admin_role === "member"));
  const group = getDb().prepare("SELECT * FROM groups WHERE id = ?").get(ids[0]);
  assert.equal(group.city, "لامرد");
  assert.equal(group.admin_count, 2);
  assert.ok(typeof wa.fetchGroupAdmins === "function");
});

test("send requires explicit confirmation and matching count", async () => {
  const { app } = setupApp();
  const { ids } = seedGroups(1);
  mockAdmins(mockWhatsApp());
  const { agent, csrf } = await login(app);
  await agent.post("/api/outreach/detect").set("X-CSRF-Token", csrf).send({ groupIds: ids });
  const admins = getDb().prepare("SELECT id FROM group_admins").all().map((r) => r.id);
  const noConfirm = await agent.post("/api/outreach/send").set("X-CSRF-Token", csrf).send({
    adminIds: admins,
    confirm: false,
    confirmCount: admins.length
  });
  assert.equal(noConfirm.status, 400);
  assert.equal(noConfirm.body.code, "confirm_required");
  const mismatch = await agent.post("/api/outreach/send").set("X-CSRF-Token", csrf).send({
    adminIds: admins,
    confirm: true,
    confirmCount: 99
  });
  assert.equal(mismatch.status, 400);
});

test("prepare preview approve send history and skip already contacted", async () => {
  const { app } = setupApp();
  const { ids } = seedGroups(1);
  getDb().prepare("UPDATE groups SET name = 'املاک مهر' WHERE id = ?").run(ids[0]);
  const sent = [];
  const wa = mockAdmins(mockWhatsApp());
  wa.sendChat = async ({ chatId, text }) => {
    sent.push({ chatId, text });
    return { ok: true };
  };
  const { agent, csrf } = await login(app);
  await agent.post("/api/outreach/detect").set("X-CSRF-Token", csrf).send({ groupIds: ids });
  const admins = (await agent.get("/api/outreach/admins")).body.admins;
  assert.equal(admins.length, 2);
  const prep = await agent.post("/api/outreach/prepare").set("X-CSRF-Token", csrf).send({
    adminIds: [admins[0].id],
    template: "سلام {{admin_name}} گروه {{group_name}} شهر {{city}}"
  });
  assert.equal(prep.status, 200);
  assert.match(prep.body.admins[0].prepared_message, /علی|سارا/);
  assert.match(prep.body.admins[0].prepared_message, /املاک مهر/);
  const preview = await agent.get(`/api/outreach/admins/${admins[0].id}/preview`);
  assert.match(preview.body.to, /املاک مهر/);
  await agent.post("/api/outreach/approve").set("X-CSRF-Token", csrf).send({ adminIds: [admins[0].id] });
  const first = await agent.post("/api/outreach/send").set("X-CSRF-Token", csrf).send({
    adminIds: [admins[0].id],
    confirm: true,
    confirmCount: 1
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.results[0].status, "sent");
  assert.equal(sent.length, 1);
  const again = await agent.post("/api/outreach/send").set("X-CSRF-Token", csrf).send({
    adminIds: [admins[0].id],
    confirm: true,
    confirmCount: 1
  });
  assert.equal(again.body.results[0].status, "skipped");
  assert.equal(again.body.results[0].error, "Already Contacted");
  assert.equal(sent.length, 1);
  const hist = await agent.get(`/api/outreach/admins/${admins[0].id}/history`);
  assert.equal(hist.body.history[0].status, "sent");
});

test("admin reply updates pipeline and inbox without auto follow-up send", async () => {
  const { app } = setupApp();
  const { ids } = seedGroups(1);
  mockAdmins(mockWhatsApp());
  const { agent, csrf } = await login(app);
  await agent.post("/api/outreach/detect").set("X-CSRF-Token", csrf).send({ groupIds: ids });
  const admin = getDb().prepare("SELECT * FROM group_admins LIMIT 1").get();
  getDb()
    .prepare("UPDATE group_admins SET message_status = 'sent', pipeline_status = 'contacted', last_contacted_at = datetime('now') WHERE id = ?")
    .run(admin.id);
  outreachService.handleIncoming({
    chatId: admin.wa_jid,
    chatName: admin.display_name,
    body: "بله، مشکلی نیست، فقط تبلیغات زیاد نباشه."
  });
  const row = getDb().prepare("SELECT * FROM group_admins WHERE id = ?").get(admin.id);
  assert.equal(row.pipeline_status, "replied");
  const inbox = await agent.get("/api/outreach/inbox");
  assert.ok(Array.isArray(inbox.body.conversations));
  const follow = outreachService.markFollowUps();
  assert.equal(typeof follow.marked, "number");
  const still = getDb().prepare("SELECT pipeline_status FROM group_admins WHERE id = ?").get(admin.id);
  assert.equal(still.pipeline_status, "replied");
});

test("permission granted is stored and dashboard widgets include outreach", async () => {
  const { app } = setupApp();
  const { ids } = seedGroups(1);
  mockAdmins(mockWhatsApp());
  const { agent, csrf } = await login(app);
  await agent.post("/api/outreach/detect").set("X-CSRF-Token", csrf).send({ groupIds: ids });
  const admin = getDb().prepare("SELECT * FROM group_admins LIMIT 1").get();
  const perm = await agent.post("/api/outreach/permission").set("X-CSRF-Token", csrf).send({
    groupId: admin.group_id,
    adminId: admin.id,
    status: "approved"
  });
  assert.equal(perm.status, 200);
  const g = getDb().prepare("SELECT advertising_permission FROM groups WHERE id = ?").get(admin.group_id);
  assert.equal(g.advertising_permission, "approved");
  const list = await agent.get("/api/groups");
  assert.equal(list.body.groups[0].advertising_permission, "approved");
  const dash = await agent.get("/api/dashboard");
  assert.equal(dash.body.stats.outreach.permissionsGranted, 1);
  assert.ok("discovery" in dash.body.stats);
});

test("group link monitor extracts validates and deduplicates invite links", async () => {
  const { app } = setupApp();
  const { sessionId, ids } = seedGroups(1);
  getDb().prepare("UPDATE groups SET name = 'خرید و فروش ملک لامرد' WHERE id = ?").run(ids[0]);
  await login(app);
  const text = "لینک: https://chat.whatsapp.com/AbCdEfGhIjKlMnOp و تکرار https://chat.whatsapp.com/AbCdEfGhIjKlMnOp";
  assert.equal(extractInviteLinks(text).length, 1);
  const first = await groupLinkMonitor.handleGroupMessage({
    chatId: `12036301@g.us`,
    chatName: "خرید و فروش ملک لامرد",
    body: text,
    senderJid: "989000@s.whatsapp.net",
    senderName: "عضو"
  });
  assert.equal(first.length, 1);
  assert.equal(first[0].duplicate, false);
  assert.equal(first[0].discovery, "new_group_discovered");
  assert.equal(first[0].validation_status, "valid");
  assert.equal(first[0].source_group_name, "خرید و فروش ملک لامرد");
  const second = await groupLinkMonitor.handleGroupMessage({
    chatId: `12036301@g.us`,
    chatName: "خرید و فروش ملک لامرد",
    body: text,
    senderJid: "989000@s.whatsapp.net",
    senderName: "عضو"
  });
  assert.equal(second[0].duplicate, true);
  assert.equal(second[0].discovery, "already_discovered");
  assert.equal(getDb().prepare("SELECT COUNT(*) AS c FROM discovered_group_links").get().c, 1);
  const bad = await groupLinkMonitor.ingest({
    url: "https://example.com/not-wa",
    sessionId,
    sourceGroupName: "x"
  });
  assert.equal(bad.validation_status, "invalid");
});

test("discovered groups stay in review queue and do not auto-join", async () => {
  const { app } = setupApp();
  const { ids } = seedGroups(1);
  getDb().prepare("UPDATE groups SET name = 'گروه تست 1' WHERE id = ?").run(ids[0]);
  const { agent, csrf } = await login(app);
  const created = await groupLinkMonitor.handleGroupMessage({
    chatId: "12036301@g.us",
    chatName: "گروه تست 1",
    body: "https://chat.whatsapp.com/AbCdEfGhIjKlMnOp",
    senderName: "x"
  });
  const list = await agent.get("/api/discovery");
  assert.equal(list.body.groups.length, 1);
  const open = await agent.post(`/api/discovery/${created[0].id}/open`).set("X-CSRF-Token", csrf).send({});
  assert.equal(open.status, 200);
  assert.match(open.body.openUrl, /chat\.whatsapp\.com/);
  const addEarly = await agent.post(`/api/discovery/${created[0].id}/add-to-manager`).set("X-CSRF-Token", csrf).send({});
  assert.ok(addEarly.status >= 400);
  getDb()
    .prepare("UPDATE discovered_group_links SET group_name = 'گروه تست 1' WHERE id = ?")
    .run(created[0].id);
  await agent.post(`/api/discovery/${created[0].id}/confirm-join`).set("X-CSRF-Token", csrf).send({});
  const add = await agent.post(`/api/discovery/${created[0].id}/add-to-manager`).set("X-CSRF-Token", csrf).send({});
  assert.equal(add.status, 200);
  assert.equal(add.body.group.source, "message_link_discovery");
  assert.equal(add.body.group.source_group_name, "گروه تست 1");
  const wa = (await import("../../services/whatsapp/WhatsAppService.js")).waManager.primary();
  assert.equal(typeof wa.groupAcceptInvite, "undefined");
  assert.equal(typeof wa.joinGroup, "undefined");
});

test("search filters admins by city permission and status", async () => {
  const { app } = setupApp();
  const { ids } = seedGroups(2);
  getDb().prepare("UPDATE groups SET name = 'لامرد یک', city = 'لامرد' WHERE id = ?").run(ids[0]);
  getDb().prepare("UPDATE groups SET name = 'مهر دو', city = 'مهر' WHERE id = ?").run(ids[1]);
  mockAdmins(mockWhatsApp());
  const { agent, csrf } = await login(app);
  await agent.post("/api/outreach/detect").set("X-CSRF-Token", csrf).send({ groupIds: ids });
  const lamerd = await agent.get("/api/outreach/admins?city=لامرد");
  assert.ok(lamerd.body.admins.every((a) => a.city === "لامرد"));
  const notes = await agent.post("/api/outreach/notes").set("X-CSRF-Token", csrf).send({
    adminId: lamerd.body.admins[0].id,
    body: "قبل از ارسال فایل با مدیر هماهنگ شود."
  });
  assert.equal(notes.status, 200);
});

test("phone helper normalizes Iranian numbers for a single WhatsApp contact", () => {
  assert.equal(phoneToWhatsAppJid("09121234567"), "989121234567@s.whatsapp.net");
  assert.equal(phoneToWhatsAppJid("+98 912 123 4567"), "989121234567@s.whatsapp.net");
  assert.equal(phoneToWhatsAppJid("12"), null);
  const text = formatShareLinks([{ group_name: "املاک مهر", normalized_url: "https://chat.whatsapp.com/AbCdEfGhIjKlMnOp" }]);
  assert.match(text, /املاک مهر/);
  assert.match(text, /chat\.whatsapp\.com\/AbCdEfGhIjKlMnOp/);
});

test("share chunks keep all 57 links instead of capping at 40", () => {
  const rows = Array.from({ length: 57 }, (_, i) => ({
    group_name: `گروه ${i + 1}`,
    normalized_url: `https://chat.whatsapp.com/Link${String(i + 1).padStart(3, "0")}ABCDEF`
  }));
  const one = formatShareLinks(rows);
  assert.match(one, /گروه 57/);
  assert.match(one, /Link057ABCDEF/);
  const chunks = chunkShareRows(rows, 800);
  assert.ok(chunks.length >= 2);
  const combined = chunks.map((c) => c.text).join("\n");
  assert.match(combined, /گروه 1/);
  assert.match(combined, /گروه 57/);
  assert.equal(
    chunks.reduce((n, c) => n + c.rows.length, 0),
    57
  );
});

test("scan member groups finds inbox invite links and copy/share stay consented", async () => {
  const { app } = setupApp();
  const { sessionId, ids } = seedGroups(2);
  getDb().prepare("UPDATE groups SET name = 'گروه منبع' WHERE id = ?").run(ids[0]);
  getDb()
    .prepare(
      `INSERT INTO inbox_messages (session_id, chat_id, chat_name, chat_type, direction, body, unread)
       VALUES (?, '12036301@g.us', 'گروه منبع', 'group', 'in', ?, 0)`
    )
    .run(sessionId, "لینک عمومی: https://chat.whatsapp.com/JoinableGroupLink99");
  const sent = [];
  const wa = mockWhatsApp();
  wa.sendChat = async ({ chatId, text }) => {
    sent.push({ chatId, text });
    return { ok: true };
  };
  const { agent, csrf } = await login(app);
  const scan = await agent.post("/api/discovery/scan").set("X-CSRF-Token", csrf).send({});
  assert.equal(scan.status, 200);
  assert.equal(scan.body.groupsScanned, 2);
  assert.equal(scan.body.newLinks, 1);
  assert.equal(scan.body.validJoinable, 1);
  const suggested = await agent.get("/api/discovery?suggested=1");
  assert.equal(suggested.body.groups.length, 1);
  assert.equal(suggested.body.groups[0].found_by, "member_group_scan");
  assert.match(suggested.body.groups[0].normalized_url, /JoinableGroupLink99/);
  const copyAll = await agent.post("/api/discovery/copy-text").set("X-CSRF-Token", csrf).send({});
  assert.equal(copyAll.status, 200);
  assert.match(copyAll.body.text, /JoinableGroupLink99/);
  const emptyCopy = await agent.post("/api/discovery/copy-text").set("X-CSRF-Token", csrf).send({ ids: [] });
  assert.equal(emptyCopy.status, 400);
  const id = suggested.body.groups[0].id;
  const noConfirm = await agent.post("/api/discovery/share").set("X-CSRF-Token", csrf).send({
    ids: [id],
    to: "09121234567",
    confirm: false,
    confirmCount: 1
  });
  assert.equal(noConfirm.status, 400);
  assert.equal(noConfirm.body.code, "confirm_required");
  const mismatch = await agent.post("/api/discovery/share").set("X-CSRF-Token", csrf).send({
    ids: [id],
    to: "09121234567",
    confirm: true,
    confirmCount: 99
  });
  assert.equal(mismatch.status, 400);
  assert.equal(mismatch.body.code, "confirm_mismatch");
  const ok = await agent.post("/api/discovery/share").set("X-CSRF-Token", csrf).send({
    ids: [id],
    to: "09121234567",
    confirm: true,
    confirmCount: 1
  });
  assert.equal(ok.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatId, "989121234567@s.whatsapp.net");
  assert.match(sent[0].text, /JoinableGroupLink99/);
  assert.equal(typeof wa.groupAcceptInvite, "undefined");
});

test("share sends all 57 links to one contact instead of stopping at 40", async () => {
  const { app } = setupApp();
  const { sessionId, ids } = seedGroups(1);
  const insert = getDb().prepare(
    `INSERT INTO discovered_group_links
       (session_id, invite_url, normalized_url, source_group_id, source_group_name,
        found_at, found_by, validation_status, http_status, group_name, join_status, city)
     VALUES (?, ?, ?, ?, 'گروه منبع', datetime('now'), 'member_group_scan', 'valid', 200, ?, 'not_joined', 'سایر')`
  );
  const linkIds = [];
  for (let i = 1; i <= 57; i++) {
    const url = `https://chat.whatsapp.com/ShareAll${String(i).padStart(3, "0")}XXXXXX`;
    const info = insert.run(sessionId, url, url, ids[0], `گروه ${i}`);
    linkIds.push(Number(info.lastInsertRowid));
  }
  const sent = [];
  const wa = mockWhatsApp();
  wa.sendChat = async ({ chatId, text }) => {
    sent.push({ chatId, text });
    return { ok: true };
  };
  const { agent, csrf } = await login(app);
  const copy = await agent.post("/api/discovery/copy-text").set("X-CSRF-Token", csrf).send({ ids: linkIds });
  assert.equal(copy.status, 200);
  assert.equal(copy.body.count, 57);
  assert.match(copy.body.text, /گروه 57/);
  const share = await agent.post("/api/discovery/share").set("X-CSRF-Token", csrf).send({
    ids: linkIds,
    to: "09121234567",
    confirm: true,
    confirmCount: 57
  });
  assert.equal(share.status, 200);
  assert.equal(share.body.count, 57);
  assert.ok(share.body.messages >= 1);
  const urls = sent.flatMap((m) => m.text.match(/https:\/\/chat\.whatsapp\.com\/ShareAll\d+XXXXXX/g) || []);
  assert.equal(urls.length, 57);
  assert.equal(new Set(sent.map((m) => m.chatId)).size, 1);
});

test("HTTP 403 invite links are still listed as joinable", async () => {
  const { app } = setupApp();
  const { sessionId, ids } = seedGroups(1);
  const { agent, csrf } = await login(app);
  getDb()
    .prepare(
      `INSERT INTO discovered_group_links
         (session_id, invite_url, normalized_url, source_group_id, source_group_name,
          found_at, found_by, validation_status, http_status, group_name, join_status, city)
       VALUES (?, ?, ?, ?, 'گروه منبع', datetime('now'), 'member_group_scan', 'invalid', 403, 'گروه عمومی', 'not_joined', 'سایر')`
    )
    .run(
      sessionId,
      "https://chat.whatsapp.com/BlockedByBotAAAA",
      "https://chat.whatsapp.com/BlockedByBotAAAA",
      ids[0]
    );
  const hidden = await agent.get("/api/discovery?suggested=1");
  assert.equal(hidden.body.groups.length, 1);
  assert.equal(hidden.body.groups[0].validation_status, "unavailable");
  assert.equal(hidden.body.groups[0].openable, true);
  assert.equal(hidden.body.analytics.valid, 1);
  assert.equal(hidden.body.analytics.linksFound, 1);
  const all = await agent.get("/api/discovery");
  assert.equal(all.body.groups.length, 1);
  const copy = await agent.post("/api/discovery/copy-text").set("X-CSRF-Token", csrf).send({
    ids: [all.body.groups[0].id]
  });
  assert.equal(copy.status, 200);
  assert.match(copy.body.text, /BlockedByBotAAAA/);
  const open = await agent.post(`/api/discovery/${all.body.groups[0].id}/open`).set("X-CSRF-Token", csrf).send({});
  assert.equal(open.status, 200);
  assert.match(open.body.openUrl, /BlockedByBotAAAA/);
});

test("left groups cannot be used for admin detection", async () => {
  const { app } = setupApp();
  const { ids } = seedGroups(1);
  getDb().prepare("UPDATE groups SET membership_status = 'left' WHERE id = ?").run(ids[0]);
  mockAdmins(mockWhatsApp());
  const { agent, csrf } = await login(app);
  const res = await agent.post("/api/outreach/detect").set("X-CSRF-Token", csrf).send({ groupIds: ids });
  assert.equal(res.status, 400);
});
