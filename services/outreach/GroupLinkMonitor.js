import { getDb } from "../../database/index.js";
import { inferCityFromName } from "../finder/cities.js";
import { extractInviteLinks } from "../finder/links.js";
import { validateInvite } from "../finder/validate.js";
import { notificationService } from "../notifications/NotificationService.js";
import { nowSql } from "../../backend/src/utils/persian.js";

function normName(s) {
  return String(s || "")
    .toLocaleLowerCase("fa")
    .replace(/\s+/g, " ")
    .trim();
}

function memberNames() {
  return getDb()
    .prepare("SELECT id, name, wa_id FROM groups WHERE membership_status = 'member'")
    .all();
}

function joinedStatusFor(groupName) {
  const n = normName(groupName);
  if (!n || n === "گروه واتساپ") return "unknown";
  const hit = memberNames().some((m) => {
    const mn = normName(m.name);
    return mn && (mn === n || mn.includes(n) || n.includes(mn));
  });
  return hit ? "joined" : "not_joined";
}

export class GroupLinkMonitor {
  constructor() {
    this.io = null;
  }

  attach(io) {
    this.io = io;
  }

  emit(event, payload) {
    if (this.io) this.io.emit(event, payload);
  }

  session() {
    return getDb().prepare("SELECT * FROM whatsapp_sessions WHERE session_key = 'default'").get();
  }

  async handleGroupMessage({ chatId, chatName, body, senderJid, senderName }) {
    if (!chatId || !String(chatId).endsWith("@g.us")) return [];
    const session = this.session();
    if (!session) return [];
    const source = getDb()
      .prepare("SELECT * FROM groups WHERE session_id = ? AND wa_id = ? AND membership_status = 'member'")
      .get(session.id, chatId);
    if (!source) return [];
    const links = extractInviteLinks(body);
    const results = [];
    for (const url of links) {
      results.push(await this.ingest({
        url,
        sessionId: session.id,
        sourceGroupId: source.id,
        sourceGroupName: source.name || chatName || "",
        senderJid: senderJid || null,
        senderName: senderName || "",
        foundBy: "message_link_discovery"
      }));
    }
    return results;
  }

  async ingest({ url, sessionId, sourceGroupId, sourceGroupName, senderJid, senderName, foundBy }) {
    const existing = getDb().prepare("SELECT * FROM discovered_group_links WHERE normalized_url = ?").get(url);
    if (existing) {
      getDb()
        .prepare(
          `UPDATE discovered_group_links SET updated_at = datetime('now'),
             source_group_name = COALESCE(NULLIF(source_group_name, ''), ?)
           WHERE id = ?`
        )
        .run(sourceGroupName || "", existing.id);
      return { ...existing, duplicate: true, discovery: "already_discovered" };
    }

    const validation = await validateInvite(url);
    const groupName = validation.meta?.groupName || "";
    const city = inferCityFromName(`${groupName} ${sourceGroupName || ""}`);
    const joinStatus = joinedStatusFor(groupName);
    const info = getDb()
      .prepare(
        `INSERT INTO discovered_group_links
           (session_id, invite_url, normalized_url, source_group_id, source_group_name,
            sender_jid, sender_name, found_at, found_by, validation_status, http_status,
            group_name, description, join_status, city)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        sessionId,
        url,
        url,
        sourceGroupId || null,
        sourceGroupName || "",
        senderJid || null,
        senderName || "",
        nowSql(),
        foundBy || "message_link_discovery",
        validation.status,
        validation.httpStatus,
        groupName,
        validation.meta?.description || "",
        joinStatus,
        city
      );
    const row = getDb().prepare("SELECT * FROM discovered_group_links WHERE id = ?").get(Number(info.lastInsertRowid));
    getDb()
      .prepare("INSERT INTO group_join_queue (discovered_id, status) VALUES (?, 'pending_review')")
      .run(row.id);
    notificationService.create({
      type: "group_discovered",
      title: "New Group Discovered",
      body: `${groupName || url} از ${sourceGroupName || "گروه عضو"}`
    });
    this.emit("discovery:new", row);
    return { ...row, duplicate: false, discovery: "new_group_discovered" };
  }

  list({ q = "", status = "", joinStatus = "" } = {}) {
    let sql = "SELECT * FROM discovered_group_links WHERE 1=1";
    const params = [];
    if (q) {
      sql += " AND (group_name LIKE ? OR source_group_name LIKE ? OR normalized_url LIKE ? OR sender_name LIKE ?)";
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (status) {
      sql += " AND validation_status = ?";
      params.push(status);
    }
    if (joinStatus) {
      sql += " AND join_status = ?";
      params.push(joinStatus);
    }
    sql += " ORDER BY id DESC";
    return getDb().prepare(sql).all(...params).map((row) => this.decorate(row));
  }

  decorate(row) {
    const queue = getDb()
      .prepare("SELECT * FROM group_join_queue WHERE discovered_id = ? ORDER BY id DESC LIMIT 1")
      .get(row.id);
    return {
      ...row,
      duplicate: false,
      discovery: "stored",
      queueStatus: queue?.status || "pending_review",
      openedAt: queue?.opened_at || null
    };
  }

  get(id) {
    const row = getDb().prepare("SELECT * FROM discovered_group_links WHERE id = ?").get(Number(id));
    if (!row) return null;
    return this.decorate(row);
  }

  async revalidate(id) {
    const row = this.get(id);
    if (!row) return null;
    const validation = await validateInvite(row.normalized_url);
    getDb()
      .prepare(
        `UPDATE discovered_group_links SET
           validation_status = ?, http_status = ?,
           group_name = CASE WHEN ? != '' THEN ? ELSE group_name END,
           description = COALESCE(?, description),
           join_status = ?,
           updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(
        validation.status,
        validation.httpStatus,
        validation.meta?.groupName || "",
        validation.meta?.groupName || "",
        validation.meta?.description || null,
        joinedStatusFor(validation.meta?.groupName || row.group_name),
        row.id
      );
    return this.get(id);
  }

  markOpened(id, userId) {
    const row = this.get(id);
    if (!row) return null;
    const ts = nowSql();
    getDb()
      .prepare(
        `UPDATE group_join_queue SET status = 'opened', opened_at = ?, user_id = COALESCE(?, user_id)
         WHERE id = (SELECT id FROM group_join_queue WHERE discovered_id = ? ORDER BY id DESC LIMIT 1)`
      )
      .run(ts, userId || null, row.id);
    const q = getDb().prepare("SELECT id FROM group_join_queue WHERE discovered_id = ?").get(row.id);
    if (!q) {
      getDb()
        .prepare("INSERT INTO group_join_queue (discovered_id, user_id, status, opened_at) VALUES (?, ?, 'opened', ?)")
        .run(row.id, userId || null, ts);
    }
    return { ...this.get(id), openUrl: row.normalized_url };
  }

  refreshJoined() {
    const rows = getDb().prepare("SELECT id, group_name FROM discovered_group_links").all();
    const upd = getDb().prepare(
      "UPDATE discovered_group_links SET join_status = ?, updated_at = datetime('now') WHERE id = ?"
    );
    for (const row of rows) {
      upd.run(joinedStatusFor(row.group_name), row.id);
    }
    return this.list();
  }

  confirmJoined(id, userId) {
    const row = this.get(id);
    if (!row) return null;
    this.refreshJoined();
    const latest = this.get(id);
    if (latest.join_status === "joined") {
      getDb()
        .prepare(
          `UPDATE group_join_queue SET status = 'joined', joined_at = datetime('now'), user_id = COALESCE(?, user_id)
           WHERE discovered_id = ?`
        )
        .run(userId || null, row.id);
    }
    return this.get(id);
  }

  addToManager(id, userId) {
    const row = this.get(id);
    if (!row) return null;
    this.refreshJoined();
    const latest = this.get(id);
    if (latest.join_status !== "joined") {
      const err = new Error("ابتدا باید در واتساپ عضو گروه شوید");
      err.status = 409;
      err.code = "not_joined";
      throw err;
    }
    const members = memberNames();
    const n = normName(latest.group_name);
    const match = members.find((m) => {
      const mn = normName(m.name);
      return mn && n && (mn === n || mn.includes(n) || n.includes(mn));
    });
    if (!match) {
      const err = new Error("گروه پس از همگام‌سازی در فهرست عضویت پیدا نشد");
      err.status = 409;
      err.code = "not_in_manager";
      throw err;
    }
    getDb()
      .prepare(
        `UPDATE groups SET
           source = 'message_link_discovery',
           found_by = ?,
           found_at = ?,
           source_group_name = ?,
           city = CASE WHEN city = 'سایر' THEN ? ELSE city END,
           updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(
        latest.found_by,
        latest.found_at,
        latest.source_group_name,
        latest.city,
        match.id
      );
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO group_permissions (group_id, advertising_permission) VALUES (?, 'unknown')`
      )
      .run(match.id);
    getDb()
      .prepare("UPDATE discovered_group_links SET added_to_manager = 1, updated_at = datetime('now') WHERE id = ?")
      .run(latest.id);
    getDb()
      .prepare(
        `UPDATE group_join_queue SET status = 'added_to_manager', user_id = COALESCE(?, user_id) WHERE discovered_id = ?`
      )
      .run(userId || null, latest.id);
    const group = getDb().prepare("SELECT * FROM groups WHERE id = ?").get(match.id);
    return { group, discovered: this.get(id) };
  }

  analytics() {
    const db = getDb();
    const n = (sql) => db.prepare(sql).get().c;
    return {
      linksFound: n("SELECT COUNT(*) AS c FROM discovered_group_links"),
      newGroups: n("SELECT COUNT(*) AS c FROM discovered_group_links WHERE join_status != 'joined'"),
      alreadyJoined: n("SELECT COUNT(*) AS c FROM discovered_group_links WHERE join_status = 'joined'"),
      pendingReview: n(
        "SELECT COUNT(*) AS c FROM group_join_queue WHERE status IN ('pending_review', 'opened')"
      ),
      valid: n("SELECT COUNT(*) AS c FROM discovered_group_links WHERE validation_status = 'valid'"),
      invalid: n("SELECT COUNT(*) AS c FROM discovered_group_links WHERE validation_status = 'invalid'"),
      approvedGroups: n(
        "SELECT COUNT(*) AS c FROM groups WHERE membership_status = 'member' AND advertising_permission = 'approved'"
      )
    };
  }
}

export const groupLinkMonitor = new GroupLinkMonitor();
