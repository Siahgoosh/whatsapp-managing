import assert from "node:assert/strict";
import { after, test } from "node:test";
import bcrypt from "bcryptjs";
import { setupApp, login, seedGroups, mockWhatsApp, campaignQueue, getDb, request } from "./helpers.js";
import { createAccount, assignUserAccount } from "../../services/accounts/AccountService.js";

after(() => campaignQueue.stopLoop());

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

test("auth me and login return WhatsApp accounts", async () => {
  const { app } = setupApp();
  const { agent, res } = await login(app);
  assert.equal(res.body.accounts.length, 1);
  assert.equal(res.body.account.sessionKey, "default");
  const me = await agent.get("/api/auth/me");
  assert.equal(me.body.accounts.length, 1);
  assert.ok(me.body.account.id);
});

test("admin can create a second WhatsApp account and switch to it", async () => {
  const { app } = setupApp();
  const { agent, csrf } = await login(app);
  const created = await agent.post("/api/whatsapp/accounts").set("X-CSRF-Token", csrf).send({ label: "فروش" });
  assert.equal(created.status, 201);
  assert.equal(created.body.accounts.length, 2);
  const id = created.body.account.id;
  const active = await agent.post("/api/whatsapp/active").set("X-CSRF-Token", csrf).send({ sessionId: id });
  assert.equal(active.status, 200);
  assert.equal(active.body.account.id, id);
  const groups = await agent.get("/api/groups");
  assert.equal(groups.body.account.id, id);
  assert.equal(groups.body.groups.length, 0);
});

test("operator only sees the assigned WhatsApp account and its groups", async () => {
  const { app } = setupApp();
  seedGroups(2);
  const second = createAccount("اپراتور ۱");
  seedGroups(3, second.id);
  const hash = bcrypt.hashSync("oppass123", 12);
  const info = getDb()
    .prepare("INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, 'operator')")
    .run("op1", hash, "اپراتور");
  assignUserAccount(Number(info.lastInsertRowid), second.id);

  const { agent, csrf } = await login(app, "op1", "oppass123");
  const accounts = await agent.get("/api/whatsapp/accounts");
  assert.equal(accounts.body.accounts.length, 1);
  assert.equal(accounts.body.accounts[0].id, second.id);
  const groups = await agent.get("/api/groups");
  assert.equal(groups.body.groups.length, 3);
  const denied = await agent.post("/api/whatsapp/accounts").set("X-CSRF-Token", csrf).send({ label: "x" });
  assert.equal(denied.status, 403);
  const switchDenied = await agent
    .post("/api/whatsapp/active")
    .set("X-CSRF-Token", csrf)
    .send({ sessionId: getDb().prepare("SELECT id FROM whatsapp_sessions WHERE session_key = 'default'").get().id });
  assert.equal(switchDenied.status, 403);
});

test("two campaigns on different WhatsApp accounts can send in parallel", async () => {
  const { app } = setupApp();
  mockWhatsApp({ delayMs: 80 });
  const a = seedGroups(1);
  const second = createAccount("دوم");
  mockWhatsApp({ delayMs: 80, sessionKey: second.sessionKey });
  const b = seedGroups(1, second.id);
  const { agent, csrf } = await login(app);

  const first = await agent
    .post("/api/campaigns")
    .set("X-CSRF-Token", csrf)
    .send({ name: "c1", message: "a", groupIds: a.ids, delayMin: 0, delayMax: 0, randomDelay: false, sessionId: a.sessionId });
  await agent.post("/api/whatsapp/active").set("X-CSRF-Token", csrf).send({ sessionId: second.id });
  const secondCamp = await agent
    .post("/api/campaigns")
    .set("X-CSRF-Token", csrf)
    .send({ name: "c2", message: "b", groupIds: b.ids, delayMin: 0, delayMax: 0, randomDelay: false, sessionId: second.id });

  assert.equal(first.status, 201);
  assert.equal(secondCamp.status, 201);
  await agent.post(`/api/campaigns/${first.body.campaign.id}/start`).set("X-CSRF-Token", csrf).send({});
  await agent.post(`/api/campaigns/${secondCamp.body.campaign.id}/start`).set("X-CSRF-Token", csrf).send({});

  await waitFor(() => {
    const one = getDb().prepare("SELECT sent_count FROM campaigns WHERE id = ?").get(first.body.campaign.id);
    const two = getDb().prepare("SELECT sent_count FROM campaigns WHERE id = ?").get(secondCamp.body.campaign.id);
    return one.sent_count > 0 && two.sent_count > 0;
  }, 8000);
});

test("two campaigns on the same WhatsApp account stay serial", async () => {
  const { app } = setupApp();
  mockWhatsApp({ delayMs: 250 });
  const { ids, sessionId } = seedGroups(2);
  const { agent, csrf } = await login(app);
  const one = await agent
    .post("/api/campaigns")
    .set("X-CSRF-Token", csrf)
    .send({ name: "s1", message: "a", groupIds: [ids[0]], delayMin: 0, delayMax: 0, randomDelay: false, sessionId });
  const two = await agent
    .post("/api/campaigns")
    .set("X-CSRF-Token", csrf)
    .send({ name: "s2", message: "b", groupIds: [ids[1]], delayMin: 0, delayMax: 0, randomDelay: false, sessionId });
  await agent.post(`/api/campaigns/${one.body.campaign.id}/start`).set("X-CSRF-Token", csrf).send({});
  await agent.post(`/api/campaigns/${two.body.campaign.id}/start`).set("X-CSRF-Token", csrf).send({});
  await new Promise((r) => setTimeout(r, 120));
  const rows = getDb()
    .prepare("SELECT status FROM campaigns WHERE id IN (?, ?)")
    .all(one.body.campaign.id, two.body.campaign.id);
  const sending = rows.filter((r) => r.status === "sending").length;
  assert.ok(sending <= 1);
});

test("logging out one account does not pause the other account campaign", async () => {
  const { app } = setupApp();
  mockWhatsApp({ delayMs: 200 });
  const a = seedGroups(2);
  const second = createAccount("دوم");
  mockWhatsApp({ delayMs: 200, sessionKey: second.sessionKey });
  const b = seedGroups(2, second.id);
  const { agent, csrf } = await login(app);
  const first = await agent
    .post("/api/campaigns")
    .set("X-CSRF-Token", csrf)
    .send({ name: "keep", message: "a", groupIds: a.ids, delayMin: 0, delayMax: 0, randomDelay: false, sessionId: a.sessionId });
  await agent.post("/api/whatsapp/active").set("X-CSRF-Token", csrf).send({ sessionId: second.id });
  const other = await agent
    .post("/api/campaigns")
    .set("X-CSRF-Token", csrf)
    .send({ name: "drop", message: "b", groupIds: b.ids, delayMin: 0, delayMax: 0, randomDelay: false, sessionId: second.id });
  await agent.post(`/api/campaigns/${first.body.campaign.id}/start`).set("X-CSRF-Token", csrf).send({});
  await agent.post(`/api/campaigns/${other.body.campaign.id}/start`).set("X-CSRF-Token", csrf).send({});
  getDb().prepare("UPDATE campaigns SET status = 'sending' WHERE id IN (?, ?)").run(first.body.campaign.id, other.body.campaign.id);
  await agent.post("/api/whatsapp/logout").set("X-CSRF-Token", csrf).send({ sessionId: second.id });
  const kept = getDb().prepare("SELECT status FROM campaigns WHERE id = ?").get(first.body.campaign.id);
  const dropped = getDb().prepare("SELECT status, pause_reason FROM campaigns WHERE id = ?").get(other.body.campaign.id);
  assert.notEqual(kept.status, "paused");
  assert.equal(dropped.status, "paused");
  assert.equal(dropped.pause_reason, "whatsapp_disconnected");
});
