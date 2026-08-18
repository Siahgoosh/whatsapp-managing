import { config } from "../../config/index.js";
import { getDb, getSetting, setSetting } from "../../database/index.js";
import { HttpError } from "../../backend/src/utils/errors.js";
import { auditLog, systemLog } from "../../backend/src/utils/logger.js";
import { nowSql } from "../../backend/src/utils/persian.js";
import { inferCityFromName, normalizeCityTag, CITY_TAGS } from "../finder/cities.js";
import { notificationService } from "../notifications/NotificationService.js";
import { DEFAULT_ADMIN_TEMPLATE, renderTemplate, templateVarsFromAdmin } from "./template.js";

export const MESSAGE_STATUSES = ["new", "prepared", "pending_approval", "sent", "failed"];
export const PIPELINE = [
  "discovered",
  "contact_pending",
  "message_approved",
  "contacted",
  "replied",
  "permission_granted",
  "marketing_group",
  "declined"
];
export const PERMISSIONS = ["unknown", "requested", "approved", "declined", "blocked"];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function jidKey(jid = "") {
  return String(jid).split(":")[0];
}

export class OutreachService {
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
    const row = getDb().prepare("SELECT * FROM whatsapp_sessions WHERE session_key = 'default'").get();
    if (!row) throw new HttpError(400, "نشست واتساپ پیدا نشد");
    return row;
  }

  template() {
    return getSetting("admin_outreach_template", DEFAULT_ADMIN_TEMPLATE);
  }

  officeName() {
    return getSetting("office_name", "املاک فرتاک");
  }

  saveTemplate({ template, officeName }) {
    if (template != null) setSetting("admin_outreach_template", String(template).slice(0, 4000));
    if (officeName != null) setSetting("office_name", String(officeName).slice(0, 80));
    return { template: this.template(), officeName: this.officeName() };
  }

  listTargetGroups({ q = "" } = {}) {
    const session = this.session();
    let sql = `
      SELECT g.*,
        COALESCE(
          g.last_activity_at,
          (SELECT MAX(created_at) FROM inbox_messages im WHERE im.chat_id = g.wa_id)
        ) AS last_activity_at,
        COALESCE(gp.advertising_permission, g.advertising_permission, 'unknown') AS advertising_permission
      FROM groups g
      LEFT JOIN group_permissions gp ON gp.group_id = g.id
      WHERE g.session_id = ? AND g.membership_status = 'member'
    `;
    const params = [session.id];
    if (q) {
      sql += " AND (g.name LIKE ? OR g.city LIKE ? OR g.wa_id LIKE ?)";
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    sql += " ORDER BY last_activity_at DESC, g.is_favorite DESC, g.name COLLATE NOCASE ASC";
    return getDb().prepare(sql).all(...params);
  }

  async detectAdmins(groupIds, wa) {
    const session = this.session();
    const ids = [...new Set((groupIds || []).map(Number).filter(Boolean))];
    if (!ids.length) throw new HttpError(400, "حداقل یک گروه انتخاب کنید");
    const groups = getDb()
      .prepare(
        `SELECT * FROM groups WHERE id IN (${ids.map(() => "?").join(",")}) AND session_id = ? AND membership_status = 'member'`
      )
      .all(...ids, session.id);
    if (groups.length !== ids.length) {
      throw new HttpError(400, "فقط گروه‌هایی که حساب در آن‌ها عضو است قابل انتخاب هستند");
    }
    if (!wa?.fetchGroupAdmins) throw new HttpError(409, "واتساپ متصل نیست");

    let stored = 0;
    let skippedMembers = 0;
    for (const group of groups) {
      const meta = await wa.fetchGroupAdmins(group.wa_id);
      const city = group.city && group.city !== "سایر" ? group.city : inferCityFromName(meta.subject || group.name);
      getDb()
        .prepare(
          `UPDATE groups SET
             name = COALESCE(NULLIF(?, ''), name),
             member_count = ?,
             admin_count = ?,
             city = ?,
             last_activity_at = COALESCE(?, last_activity_at),
             updated_at = datetime('now')
           WHERE id = ?`
        )
        .run(
          meta.subject || "",
          meta.size ?? group.member_count,
          meta.adminCount,
          city,
          meta.lastActivityAt || null,
          group.id
        );

      const seen = new Set();
      for (const admin of meta.admins || []) {
        const jid = jidKey(admin.jid);
        if (!jid) continue;
        seen.add(jid);
        getDb()
          .prepare(
            `INSERT INTO group_admins
               (session_id, group_id, wa_jid, display_name, admin_role, active, pipeline_status, message_status, updated_at)
             VALUES (?, ?, ?, ?, ?, 1, 'discovered', 'new', datetime('now'))
             ON CONFLICT(session_id, group_id, wa_jid) DO UPDATE SET
               display_name = CASE WHEN excluded.display_name != '' THEN excluded.display_name ELSE group_admins.display_name END,
               admin_role = excluded.admin_role,
               active = 1,
               updated_at = datetime('now')`
          )
          .run(session.id, group.id, jid, admin.displayName || "", admin.role || "admin");
        stored += 1;
      }
      skippedMembers += Math.max(0, (meta.size || 0) - (meta.admins || []).length);

      if (seen.size) {
        const placeholders = [...seen].map(() => "?").join(",");
        getDb()
          .prepare(
            `UPDATE group_admins SET active = 0, updated_at = datetime('now')
             WHERE group_id = ? AND wa_jid NOT IN (${placeholders})`
          )
          .run(group.id, ...seen);
      }

      this.ensureGroupPermission(group.id);
    }

    systemLog("outreach_detect_admins", `stored ${stored} admins from ${groups.length} groups`);
    this.emit("outreach:admins", { stored, groups: groups.length });
    return { stored, groups: groups.length, skippedRegularMembers: skippedMembers, admins: this.listAdmins() };
  }

  ensureGroupPermission(groupId) {
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO group_permissions (group_id, advertising_permission) VALUES (?, 'unknown')`
      )
      .run(groupId);
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO admin_permissions (group_id, status) VALUES (?, 'unknown')`
      )
      .run(groupId);
  }

  adminRow(id) {
    const row = getDb()
      .prepare(
        `SELECT a.*, g.name AS group_name, g.wa_id AS group_wa_id, g.city, g.picture_path,
                g.advertising_permission, g.membership_status
         FROM group_admins a
         JOIN groups g ON g.id = a.group_id
         WHERE a.id = ?`
      )
      .get(Number(id));
    if (!row) throw new HttpError(404, "مدیر پیدا نشد");
    return this.decorateAdmin(row);
  }

  decorateAdmin(row) {
    const last = getDb()
      .prepare(
        `SELECT date, status, response FROM admin_contact_history
         WHERE admin_id = ? ORDER BY id DESC LIMIT 1`
      )
      .get(row.id);
    const already = Boolean(row.last_contacted_at);
    return {
      ...row,
      already_contacted: already,
      last_contact: row.last_contacted_at || last?.date || null,
      last_response: last?.response || "",
      preview: renderTemplate(row.prepared_message || this.template(), templateVarsFromAdmin(row, { officeName: this.officeName() }))
    };
  }

  listAdmins(filters = {}) {
    const session = this.session();
    let sql = `
      SELECT a.*, g.name AS group_name, g.wa_id AS group_wa_id, g.city, g.picture_path,
             COALESCE(gp.advertising_permission, g.advertising_permission, 'unknown') AS advertising_permission,
             g.membership_status
      FROM group_admins a
      JOIN groups g ON g.id = a.group_id
      LEFT JOIN group_permissions gp ON gp.group_id = g.id
      WHERE a.session_id = ? AND a.active = 1
    `;
    const params = [session.id];
    if (filters.q) {
      sql += " AND (a.display_name LIKE ? OR g.name LIKE ? OR a.wa_jid LIKE ?)";
      params.push(`%${filters.q}%`, `%${filters.q}%`, `%${filters.q}%`);
    }
    if (filters.group) {
      sql += " AND (g.name LIKE ? OR a.group_id = ?)";
      params.push(`%${filters.group}%`, Number(filters.group) || 0);
    }
    if (filters.city) {
      sql += " AND g.city = ?";
      params.push(normalizeCityTag(filters.city));
    }
    if (filters.permission) {
      sql += " AND COALESCE(gp.advertising_permission, g.advertising_permission, 'unknown') = ?";
      params.push(filters.permission);
    }
    if (filters.status) {
      sql += " AND (a.message_status = ? OR a.pipeline_status = ?)";
      params.push(filters.status, filters.status);
    }
    if (filters.dateFrom) {
      sql += " AND COALESCE(a.last_contacted_at, a.created_at) >= ?";
      params.push(filters.dateFrom);
    }
    if (filters.dateTo) {
      sql += " AND COALESCE(a.last_contacted_at, a.created_at) <= ?";
      params.push(filters.dateTo);
    }
    sql += " ORDER BY a.id DESC";
    return getDb().prepare(sql).all(...params).map((r) => this.decorateAdmin(r));
  }

  prepare(adminIds, templateOverride, userId) {
    const tpl = templateOverride || this.template();
    const office = this.officeName();
    const rows = [];
    for (const id of adminIds) {
      const admin = this.adminRow(id);
      const message = renderTemplate(tpl, templateVarsFromAdmin(admin, { officeName: office }));
      getDb()
        .prepare(
          `UPDATE group_admins SET prepared_message = ?, message_status = 'prepared',
             pipeline_status = CASE WHEN pipeline_status = 'discovered' THEN 'contact_pending' ELSE pipeline_status END,
             updated_at = datetime('now') WHERE id = ?`
        )
        .run(message, admin.id);
      if (userId) {
        getDb()
          .prepare(
            `INSERT INTO admin_contacts (admin_id, user_id, prepared_message, status) VALUES (?, ?, ?, 'prepared')`
          )
          .run(admin.id, userId, message);
      }
      rows.push(this.adminRow(admin.id));
    }
    return { admins: rows };
  }

  preview(adminId, templateOverride) {
    const admin = this.adminRow(adminId);
    const office = this.officeName();
    const tpl = templateOverride || admin.prepared_message || this.template();
    const message = renderTemplate(tpl, templateVarsFromAdmin(admin, { officeName: office }));
    return {
      to: `مدیر گروه ${admin.group_name}`,
      admin,
      message,
      alreadyContacted: admin.already_contacted,
      lastContact: admin.last_contact
    };
  }

  approve(adminIds, messageById = {}) {
    const out = [];
    for (const id of adminIds) {
      const admin = this.adminRow(id);
      const message = messageById[id] || admin.prepared_message || this.preview(id).message;
      getDb()
        .prepare(
          `UPDATE group_admins SET prepared_message = ?, message_status = 'pending_approval',
             pipeline_status = 'message_approved', updated_at = datetime('now') WHERE id = ?`
        )
        .run(message, admin.id);
      getDb()
        .prepare(
          `UPDATE admin_contacts SET prepared_message = ?, approved = 1, approved_at = datetime('now'), status = 'pending_approval'
           WHERE id = (SELECT id FROM admin_contacts WHERE admin_id = ? ORDER BY id DESC LIMIT 1)`
        )
        .run(message, admin.id);
      out.push(this.adminRow(admin.id));
    }
    return { admins: out };
  }

  async send({ adminIds, confirm, confirmCount, force = false, userId, wa }) {
    if (!confirm) {
      throw new HttpError(400, "ارسال بدون تأیید صریح کاربر مجاز نیست", "confirm_required");
    }
    const ids = [...new Set((adminIds || []).map(Number).filter(Boolean))];
    if (!ids.length) throw new HttpError(400, "مدیری انتخاب نشده است");
    if (ids.length > config.maxOutreachBatch) {
      throw new HttpError(400, `حداکثر ${config.maxOutreachBatch} پیام در هر دسته`);
    }
    if (Number(confirmCount) !== ids.length) {
      throw new HttpError(400, "تعداد تأیید با فهرست انتخاب‌شده یکی نیست", "confirm_mismatch");
    }

    const results = [];
    for (const id of ids) {
      const admin = this.adminRow(id);
      if (admin.membership_status !== "member") {
        results.push({ id, status: "failed", error: "حساب عضو این گروه نیست" });
        continue;
      }
      if (admin.already_contacted && !force) {
        results.push({
          id,
          status: "skipped",
          error: "Already Contacted",
          lastContact: admin.last_contact
        });
        continue;
      }
      const message = admin.prepared_message || this.preview(id).message;
      if (!admin.prepared_message) {
        getDb().prepare("UPDATE group_admins SET prepared_message = ? WHERE id = ?").run(message, admin.id);
      }
      try {
        if (!wa?.sendChat) throw new HttpError(409, "واتساپ متصل نیست");
        await wa.sendChat({ chatId: admin.wa_jid, text: message });
        const ts = nowSql();
        getDb()
          .prepare(
            `UPDATE group_admins SET message_status = 'sent', pipeline_status = 'contacted',
               last_contacted_at = ?, follow_up_available = 0, updated_at = datetime('now') WHERE id = ?`
          )
          .run(ts, admin.id);
        const contact = userId
          ? getDb()
              .prepare(
                `INSERT INTO admin_contacts (admin_id, user_id, prepared_message, approved, approved_at, sent_at, status)
                 VALUES (?, ?, ?, 1, ?, ?, 'sent')`
              )
              .run(admin.id, userId, message, ts, ts)
          : { lastInsertRowid: null };
        getDb()
          .prepare(
            `INSERT INTO admin_contact_history (admin_id, group_id, contact_id, date, message, status)
             VALUES (?, ?, ?, ?, ?, 'sent')`
          )
          .run(admin.id, admin.group_id, Number(contact.lastInsertRowid), ts, message);
        this.setPermission(admin.group_id, "requested", admin.id, userId);
        if (config.outreachMinDelaySeconds > 0) {
          await sleep(config.outreachMinDelaySeconds * 1000);
        }
        results.push({ id, status: "sent" });
      } catch (err) {
        getDb()
          .prepare(
            `UPDATE group_admins SET message_status = 'failed', updated_at = datetime('now') WHERE id = ?`
          )
          .run(admin.id);
        getDb()
          .prepare(
            `INSERT INTO admin_contact_history (admin_id, group_id, date, message, status, notes)
             VALUES (?, ?, ?, ?, 'failed', ?)`
          )
          .run(admin.id, admin.group_id, nowSql(), message, String(err.message || err).slice(0, 400));
        results.push({ id, status: "failed", error: err.message || "send failed" });
      }
    }

    auditLog(userId, "outreach_send", `contacted ${results.filter((r) => r.status === "sent").length} admins`);
    this.emit("outreach:sent", { results });
    return { results };
  }

  history(adminId) {
    this.adminRow(adminId);
    return getDb()
      .prepare("SELECT * FROM admin_contact_history WHERE admin_id = ? ORDER BY id DESC")
      .all(Number(adminId));
  }

  addNote({ adminId, groupId, userId, body }) {
    const text = String(body || "").trim().slice(0, 2000);
    if (!text) throw new HttpError(400, "یادداشت خالی است");
    if (adminId) {
      getDb().prepare("UPDATE group_admins SET notes = ?, updated_at = datetime('now') WHERE id = ?").run(text, adminId);
      getDb()
        .prepare("INSERT INTO group_notes (admin_id, group_id, user_id, body) VALUES (?, ?, ?, ?)")
        .run(adminId, groupId || this.adminRow(adminId).group_id, userId || null, text);
    } else if (groupId) {
      getDb().prepare("UPDATE groups SET notes = ?, updated_at = datetime('now') WHERE id = ?").run(text, groupId);
      getDb()
        .prepare("INSERT INTO group_notes (group_id, user_id, body) VALUES (?, ?, ?)")
        .run(groupId, userId || null, text);
    } else {
      throw new HttpError(400, "هدف یادداشت مشخص نیست");
    }
    return { ok: true };
  }

  setPermission(groupId, status, adminId = null, userId = null) {
    if (!PERMISSIONS.includes(status)) throw new HttpError(400, "وضعیت اجازه نامعتبر است");
    const group = getDb().prepare("SELECT * FROM groups WHERE id = ?").get(Number(groupId));
    if (!group) throw new HttpError(404, "گروه پیدا نشد");
    this.ensureGroupPermission(group.id);
    getDb()
      .prepare("UPDATE groups SET advertising_permission = ?, updated_at = datetime('now') WHERE id = ?")
      .run(status, group.id);
    getDb()
      .prepare(
        `UPDATE group_permissions SET advertising_permission = ?, updated_at = datetime('now'), updated_by = ? WHERE group_id = ?`
      )
      .run(status, userId, group.id);
    getDb()
      .prepare(
        `UPDATE admin_permissions SET status = ?, admin_id = COALESCE(?, admin_id), updated_at = datetime('now') WHERE group_id = ?`
      )
      .run(status, adminId, group.id);

    if (adminId) {
      const pipeline =
        status === "approved" ? "permission_granted" : status === "declined" || status === "blocked" ? "declined" : null;
      if (pipeline) {
        getDb()
          .prepare("UPDATE group_admins SET pipeline_status = ?, updated_at = datetime('now') WHERE id = ?")
          .run(pipeline, adminId);
      }
    } else if (status === "approved" || status === "declined" || status === "blocked") {
      const pipeline = status === "approved" ? "permission_granted" : "declined";
      getDb()
        .prepare("UPDATE group_admins SET pipeline_status = ?, updated_at = datetime('now') WHERE group_id = ? AND active = 1")
        .run(pipeline, group.id);
    }
    return { groupId: group.id, status };
  }

  markMarketingGroup(groupId, userId) {
    this.setPermission(groupId, "approved", null, userId);
    getDb()
      .prepare(
        `UPDATE group_admins SET pipeline_status = 'marketing_group', updated_at = datetime('now')
         WHERE group_id = ? AND active = 1 AND pipeline_status IN ('permission_granted', 'replied', 'contacted')`
      )
      .run(groupId);
    return { ok: true };
  }

  setCity(groupId, city) {
    const tag = normalizeCityTag(city);
    getDb().prepare("UPDATE groups SET city = ?, updated_at = datetime('now') WHERE id = ?").run(tag, groupId);
    return { city: tag };
  }

  handleIncoming({ chatId, chatName, body }) {
    if (!chatId || String(chatId).endsWith("@g.us")) return null;
    const jid = jidKey(chatId);
    const admins = getDb()
      .prepare(
        `SELECT a.* FROM group_admins a
         WHERE a.active = 1 AND (a.wa_jid = ? OR a.wa_jid LIKE ?)`
      )
      .all(jid, `${String(jid).split("@")[0]}@%`);
    if (!admins.length) return null;
    const text = String(body || "").slice(0, 4000);
    for (const admin of admins) {
      if (admin.pipeline_status === "declined" || admin.pipeline_status === "blocked") continue;
      getDb()
        .prepare(
          `UPDATE group_admins SET pipeline_status = 'replied', follow_up_available = 0, updated_at = datetime('now')
           WHERE id = ? AND pipeline_status IN ('contacted', 'message_approved', 'contact_pending', 'replied')`
        )
        .run(admin.id);
      getDb()
        .prepare(
          `INSERT INTO admin_contact_history (admin_id, group_id, date, message, status, response)
           VALUES (?, ?, ?, '', 'replied', ?)`
        )
        .run(admin.id, admin.group_id, nowSql(), text);
    }
    notificationService.create({
      type: "admin_replied",
      title: "Admin replied",
      body: `${chatName || "مدیر"}: ${text.slice(0, 180)}`
    });
    this.emit("outreach:reply", { chatId, chatName, body: text, adminIds: admins.map((a) => a.id) });
    return { admins: admins.length };
  }

  inbox() {
    const session = this.session();
    const adminJids = getDb()
      .prepare("SELECT DISTINCT wa_jid FROM group_admins WHERE session_id = ? AND active = 1")
      .all(session.id)
      .map((r) => r.wa_jid);
    if (!adminJids.length) return [];
    const placeholders = adminJids.map(() => "?").join(",");
    const convos = getDb()
      .prepare(
        `SELECT chat_id, chat_name, chat_type,
                MAX(id) AS last_id,
                SUM(CASE WHEN unread = 1 AND direction = 'in' THEN 1 ELSE 0 END) AS unread
         FROM inbox_messages
         WHERE session_id = ? AND chat_type = 'contact' AND chat_id IN (${placeholders})
         GROUP BY chat_id
         ORDER BY last_id DESC`
      )
      .all(session.id, ...adminJids);
    return convos.map((c) => {
      const last = getDb().prepare("SELECT * FROM inbox_messages WHERE id = ?").get(c.last_id);
      const admin = getDb()
        .prepare(
          `SELECT a.id, a.display_name, g.name AS group_name FROM group_admins a
           JOIN groups g ON g.id = a.group_id
           WHERE a.wa_jid = ? AND a.active = 1 LIMIT 1`
        )
        .get(c.chat_id);
      return { ...c, lastMessage: last, admin };
    });
  }

  markFollowUps() {
    const hours = Number(getSetting("outreach_follow_up_hours", String(config.outreachFollowUpHours))) || 24;
    const updated = getDb()
      .prepare(
        `UPDATE group_admins SET follow_up_available = 1, updated_at = datetime('now')
         WHERE active = 1
           AND message_status = 'sent'
           AND pipeline_status = 'contacted'
           AND follow_up_available = 0
           AND last_contacted_at IS NOT NULL
           AND datetime(last_contacted_at) <= datetime('now', ?)`
      )
      .run(`-${hours} hours`);
    return { marked: updated.changes, hours };
  }

  analytics() {
    const db = getDb();
    const session = this.session();
    const n = (sql, ...p) => db.prepare(sql).get(...p).c;
    return {
      adminsFound: n("SELECT COUNT(*) AS c FROM group_admins WHERE session_id = ? AND active = 1", session.id),
      pendingApproval: n(
        "SELECT COUNT(*) AS c FROM group_admins WHERE session_id = ? AND active = 1 AND message_status = 'pending_approval'",
        session.id
      ),
      adminsContacted: n(
        "SELECT COUNT(*) AS c FROM group_admins WHERE session_id = ? AND active = 1 AND message_status = 'sent'",
        session.id
      ),
      adminsReplied: n(
        "SELECT COUNT(*) AS c FROM group_admins WHERE session_id = ? AND active = 1 AND pipeline_status = 'replied'",
        session.id
      ),
      permissionsGranted: n(
        "SELECT COUNT(*) AS c FROM groups WHERE session_id = ? AND advertising_permission = 'approved'",
        session.id
      ),
      permissionsDeclined: n(
        "SELECT COUNT(*) AS c FROM groups WHERE session_id = ? AND advertising_permission IN ('declined', 'blocked')",
        session.id
      ),
      followUps: n(
        "SELECT COUNT(*) AS c FROM group_admins WHERE session_id = ? AND active = 1 AND follow_up_available = 1",
        session.id
      ),
      marketingGroupsApproved: n(
        "SELECT COUNT(*) AS c FROM groups WHERE session_id = ? AND membership_status = 'member' AND advertising_permission = 'approved'",
        session.id
      )
    };
  }

  cities() {
    return CITY_TAGS;
  }
}

export const outreachService = new OutreachService();
