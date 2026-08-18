import { config } from "../../config/index.js";
import { getDb } from "../../database/index.js";
import { HttpError } from "../../backend/src/utils/errors.js";
import { campaignLog, systemLog } from "../../backend/src/utils/logger.js";
import { estimateDurationSeconds } from "../../backend/src/utils/persian.js";

const ACTIVE = new Set(["queued", "sending", "paused", "scheduled"]);

export class CampaignService {
  list(userId, role) {
    const sql =
      role === "admin"
        ? `SELECT c.*, u.username AS owner
           FROM campaigns c LEFT JOIN users u ON u.id = c.user_id
           ORDER BY c.id DESC`
        : `SELECT c.*, u.username AS owner
           FROM campaigns c LEFT JOIN users u ON u.id = c.user_id
           WHERE c.user_id = ? ORDER BY c.id DESC`;
    return role === "admin" ? getDb().prepare(sql).all() : getDb().prepare(sql).all(userId);
  }

  get(id, userId, role) {
    const campaign =
      role === "admin"
        ? getDb().prepare("SELECT * FROM campaigns WHERE id = ?").get(id)
        : getDb().prepare("SELECT * FROM campaigns WHERE id = ? AND user_id = ?").get(id, userId);
    if (!campaign) throw new HttpError(404, "کمپین پیدا نشد");
    const groups = getDb()
      .prepare(
        `SELECT cg.*, g.name AS group_name, g.wa_id
         FROM campaign_groups cg JOIN groups g ON g.id = cg.group_id
         WHERE cg.campaign_id = ? ORDER BY cg.position ASC`
      )
      .all(id);
    const attachment = getDb()
      .prepare("SELECT * FROM message_attachments WHERE campaign_id = ? LIMIT 1")
      .get(id);
    const logs = getDb()
      .prepare("SELECT * FROM campaign_logs WHERE campaign_id = ? ORDER BY id DESC LIMIT 200")
      .all(id);
    return { campaign, groups, attachment, logs };
  }

  create(user, payload) {
    this.validateDelay(payload);
    const session = getDb().prepare("SELECT * FROM whatsapp_sessions WHERE id = ?").get(payload.sessionId);
    if (!session) throw new HttpError(400, "نشست واتساپ نامعتبر است");
    const groupIds = [...new Set((payload.groupIds || []).map(Number))];
    if (!groupIds.length) throw new HttpError(400, "حداقل یک گروه مجاز انتخاب کنید");
    const groups = getDb()
      .prepare(
        `SELECT g.*,
           COALESCE(
             g.last_activity_at,
             (SELECT MAX(created_at) FROM inbox_messages im WHERE im.chat_id = g.wa_id)
           ) AS last_activity_at
         FROM groups g
         WHERE g.id IN (${groupIds.map(() => "?").join(",")}) AND g.session_id = ? AND g.membership_status = 'member'`
      )
      .all(...groupIds, session.id);
    if (groups.length !== groupIds.length) {
      throw new HttpError(400, "فقط گروه‌هایی که حساب در آن‌ها عضو است قابل انتخاب هستند");
    }
    groups.sort((a, b) => String(b.last_activity_at || "").localeCompare(String(a.last_activity_at || "")));
    const info = getDb()
      .prepare(
        `INSERT INTO campaigns
         (user_id, session_id, name, message, caption, delay_min, delay_max, random_delay, status, scheduled_at, total_groups, pending_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        user.id,
        session.id,
        payload.name.trim(),
        payload.message || "",
        payload.caption || "",
        payload.delayMin,
        payload.randomDelay ? payload.delayMax : payload.delayMin,
        payload.randomDelay ? 1 : 0,
        payload.scheduledAt ? "scheduled" : "draft",
        payload.scheduledAt || null,
        groups.length,
        groups.length
      );
    const campaignId = Number(info.lastInsertRowid);
    const insertG = getDb().prepare(
      "INSERT INTO campaign_groups (campaign_id, group_id, position, status) VALUES (?, ?, ?, 'pending')"
    );
    groups.forEach((g, i) => insertG.run(campaignId, g.id, i));
    if (payload.attachment) {
      getDb()
        .prepare(
          `INSERT INTO message_attachments
           (campaign_id, stored_name, original_name, mime_type, size, rel_path)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          campaignId,
          payload.attachment.storedName,
          payload.attachment.originalName,
          payload.attachment.mimeType,
          payload.attachment.size,
          payload.attachment.relPath
        );
    }
    if (payload.scheduledAt) {
      getDb()
        .prepare("INSERT INTO scheduled_campaigns (campaign_id, run_at, status) VALUES (?, ?, 'scheduled')")
        .run(campaignId, payload.scheduledAt);
    }
    campaignLog(campaignId, "created", `Campaign created with ${groups.length} groups`);
    systemLog("campaign_created", `Campaign ${payload.name} created`, { userId: user.id });
    return this.get(campaignId, user.id, user.role);
  }

  validateDelay(payload) {
    const min = Number(payload.delayMin);
    const max = Number(payload.randomDelay ? payload.delayMax : payload.delayMin);
    if (!Number.isFinite(min) || min < config.minDelaySeconds) {
      throw new HttpError(400, `حداقل فاصله ارسال ${config.minDelaySeconds} ثانیه است`);
    }
    if (min > config.maxDelaySeconds || max > config.maxDelaySeconds) {
      throw new HttpError(400, `حداکثر فاصله ارسال ${config.maxDelaySeconds} ثانیه است`);
    }
    if (payload.randomDelay && max < min) {
      throw new HttpError(400, "حداکثر تأخیر باید از حداقل بزرگ‌تر باشد");
    }
  }

  duplicate(id, user) {
    const { campaign, groups, attachment } = this.get(id, user.id, user.role);
    return this.create(user, {
      sessionId: campaign.session_id,
      name: `${campaign.name} (کپی)`,
      message: campaign.message,
      caption: campaign.caption,
      delayMin: campaign.delay_min,
      delayMax: campaign.delay_max,
      randomDelay: Boolean(campaign.random_delay),
      groupIds: groups.map((g) => g.group_id),
      attachment: attachment
        ? {
            storedName: attachment.stored_name,
            originalName: attachment.original_name,
            mimeType: attachment.mime_type,
            size: attachment.size,
            relPath: attachment.rel_path
          }
        : null
    });
  }

  remove(id, user) {
    const { campaign } = this.get(id, user.id, user.role);
    if (["sending", "queued"].includes(campaign.status)) {
      throw new HttpError(400, "کمپین در حال ارسال را ابتدا متوقف کنید");
    }
    getDb().prepare("DELETE FROM campaigns WHERE id = ?").run(id);
  }

  summary(id, user) {
    const { campaign, groups, attachment } = this.get(id, user.id, user.role);
    return {
      name: campaign.name,
      message: campaign.message,
      caption: campaign.caption,
      attachment: attachment
        ? { name: attachment.original_name, mime: attachment.mime_type, size: attachment.size }
        : null,
      groupCount: groups.length,
      delayMin: campaign.delay_min,
      delayMax: campaign.delay_max,
      randomDelay: Boolean(campaign.random_delay),
      scheduledAt: campaign.scheduled_at,
      estimatedDurationSeconds: estimateDurationSeconds(
        groups.length,
        campaign.delay_min,
        campaign.delay_max,
        campaign.random_delay
      )
    };
  }

  setStatus(id, status, extra = {}) {
    const fields = { status, updated_at: new Date().toISOString().slice(0, 19).replace("T", " "), ...extra };
    const keys = Object.keys(fields);
    getDb()
      .prepare(`UPDATE campaigns SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
      .run(...keys.map((k) => fields[k]), id);
  }

  recount(id) {
    const row = getDb()
      .prepare(
        `SELECT
           SUM(status = 'sent') AS sent_count,
           SUM(status = 'failed') AS failed_count,
           SUM(status = 'skipped') AS skipped_count,
           SUM(status = 'pending') AS pending_count
         FROM campaign_groups WHERE campaign_id = ?`
      )
      .get(id);
    getDb()
      .prepare(
        `UPDATE campaigns SET sent_count = ?, failed_count = ?, skipped_count = ?, pending_count = ? WHERE id = ?`
      )
      .run(row.sent_count || 0, row.failed_count || 0, row.skipped_count || 0, row.pending_count || 0, id);
    return getDb().prepare("SELECT * FROM campaigns WHERE id = ?").get(id);
  }

  canControl(campaign) {
    return ACTIVE.has(campaign.status) || campaign.status === "draft" || campaign.status === "scheduled";
  }
}

export const campaignService = new CampaignService();
