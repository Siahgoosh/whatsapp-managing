import "./env.js";
import request from "supertest";
import { initDatabase, resetDatabaseForTests, getDb } from "../../database/index.js";
import { sessionStore } from "../src/middleware/sessionStore.js";
import { campaignQueue } from "../../queue/CampaignQueue.js";
import { waManager } from "../../services/whatsapp/WhatsAppService.js";
import { createApp } from "../src/app.js";

export function setupApp() {
  resetDatabaseForTests();
  sessionStore.reset();
  campaignQueue.stopLoop();
  campaignQueue.running.clear();
  waManager.clients.clear();
  const app = createApp();
  return { app, db: getDb() };
}

export async function login(app, username = "admin", password = "testpass123") {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ username, password });
  return { agent, csrf: res.body.csrfToken, user: res.body.user, res };
}

export function seedGroups(count = 3) {
  const session = getDb().prepare("SELECT id FROM whatsapp_sessions WHERE session_key = 'default'").get();
  const stmt = getDb().prepare(
    `INSERT INTO groups (session_id, wa_id, name, member_count, membership_status, is_admin)
     VALUES (?, ?, ?, 12, 'member', 0)`
  );
  const ids = [];
  for (let i = 1; i <= count; i++) {
    const info = stmt.run(session.id, `1203630${i}@g.us`, `گروه تست ${i}`);
    ids.push(Number(info.lastInsertRowid));
  }
  return { sessionId: session.id, ids };
}

export function mockWhatsApp({ failTimes = 0, rateLimit = false, delayMs = 0 } = {}) {
  const wa = waManager.primary();
  wa.status = "connected";
  wa.sock = { user: { id: "98912@s.whatsapp.net", name: "Test" } };
  let fails = 0;
  wa.isConnected = () => true;
  wa.assertConnected = () => {};
  wa.sendToGroup = async () => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (rateLimit) {
      const err = new Error("too many requests 429");
      throw err;
    }
    if (fails < failTimes) {
      fails += 1;
      throw new Error("temporary send failure");
    }
    return { key: { id: "mock" } };
  };
  wa.sendChat = async () => ({ ok: true });
  return wa;
}

export { request, getDb, initDatabase, campaignQueue, waManager };
