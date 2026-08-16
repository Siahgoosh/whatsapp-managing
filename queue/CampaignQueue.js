import { config } from "../config/index.js";
import { getDb } from "../database/index.js";
import { waManager } from "../services/whatsapp/WhatsAppService.js";
import { campaignService } from "../services/campaign/CampaignService.js";
import { notificationService } from "../services/notifications/NotificationService.js";
import { campaignLog, systemLog, logger } from "../backend/src/utils/logger.js";
import { looksLikeRateLimit } from "../backend/src/utils/files.js";
import { nowSql } from "../backend/src/utils/persian.js";

function sleep(ms, token) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (token) {
      token.cancel = () => {
        clearTimeout(t);
        reject(Object.assign(new Error("cancelled"), { code: "cancelled" }));
      };
    }
  });
}

function pickDelay(campaign) {
  if (campaign.random_delay) {
    const min = campaign.delay_min * 1000;
    const max = campaign.delay_max * 1000;
    return Math.floor(min + Math.random() * (max - min + 1));
  }
  return campaign.delay_min * 1000;
}

export class CampaignQueue {
  constructor() {
    this.running = new Map();
    this.io = null;
    this.loopTimer = null;
  }

  attach(io) {
    this.io = io;
  }

  emit(campaignId, payload) {
    if (this.io) this.io.emit("campaign:progress", { campaignId, ...payload });
  }

  snapshot(campaignId) {
    const campaign = getDb().prepare("SELECT * FROM campaigns WHERE id = ?").get(campaignId);
    const current = campaign.current_group_id
      ? getDb()
          .prepare(
            `SELECT cg.*, g.name AS group_name FROM campaign_groups cg
             JOIN groups g ON g.id = cg.group_id WHERE cg.id = ?`
          )
          .get(campaign.current_group_id)
      : null;
    return {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      sent: campaign.sent_count,
      failed: campaign.failed_count,
      skipped: campaign.skipped_count,
      pending: campaign.pending_count,
      total: campaign.total_groups,
      currentGroup: current?.group_name || null,
      pauseReason: campaign.pause_reason
    };
  }

  async start(campaignId, user) {
    const { campaign } = campaignService.get(campaignId, user.id, user.role);
    const wa = waManager.primary();
    if (!wa.isConnected()) {
      throw Object.assign(new Error("WhatsApp is not connected"), { status: 409, code: "not_connected" });
    }
    if (["sending", "queued"].includes(campaign.status)) return this.snapshot(campaignId);
    campaignService.setStatus(campaignId, "queued", {
      started_at: nowSql(),
      pause_reason: null,
      consecutive_failures: 0
    });
    campaignLog(campaignId, "started", "Campaign queued");
    systemLog("campaign_started", `Campaign ${campaign.name} started`, { userId: user.id });
    notificationService.create({
      userId: user.id,
      type: "campaign_started",
      title: "کمپین شروع شد",
      body: campaign.name
    });
    this.ensureLoop();
    this.emit(campaignId, this.snapshot(campaignId));
    return this.snapshot(campaignId);
  }

  pause(campaignId, user, reason = "paused_by_user") {
    const { campaign } = campaignService.get(campaignId, user.id, user.role);
    if (!["sending", "queued"].includes(campaign.status)) return this.snapshot(campaignId);
    campaignService.setStatus(campaignId, "paused", { paused_at: nowSql(), pause_reason: reason });
    campaignLog(campaignId, "paused", reason);
    systemLog("campaign_paused", `Campaign ${campaign.name} paused`, { userId: user.id });
    notificationService.create({
      userId: user.id,
      type: "campaign_paused",
      title: "کمپین متوقف موقت شد",
      body: reason === "rate_limit"
        ? "Sending has been paused because WhatsApp returned an abnormal/rate-limit response."
        : campaign.name
    });
    this.emit(campaignId, this.snapshot(campaignId));
    return this.snapshot(campaignId);
  }

  resume(campaignId, user) {
    const { campaign } = campaignService.get(campaignId, user.id, user.role);
    if (campaign.status !== "paused") return this.snapshot(campaignId);
    if (!waManager.primary().isConnected()) {
      throw Object.assign(new Error("WhatsApp is not connected"), { status: 409 });
    }
    campaignService.setStatus(campaignId, "queued", { pause_reason: null });
    campaignLog(campaignId, "resumed", "Campaign resumed");
    this.ensureLoop();
    this.emit(campaignId, this.snapshot(campaignId));
    return this.snapshot(campaignId);
  }

  stop(campaignId, user) {
    campaignService.get(campaignId, user.id, user.role);
    getDb()
      .prepare("UPDATE campaign_groups SET status = 'skipped' WHERE campaign_id = ? AND status = 'pending'")
      .run(campaignId);
    campaignService.setStatus(campaignId, "stopped", { completed_at: nowSql() });
    campaignService.recount(campaignId);
    campaignLog(campaignId, "stopped", "Campaign stopped; remaining jobs cancelled");
    systemLog("campaign_stopped", `Campaign ${campaignId} stopped`, { userId: user.id });
    notificationService.create({
      userId: user.id,
      type: "campaign_stopped",
      title: "کمپین متوقف شد",
      body: `شناسه ${campaignId}`
    });
    this.emit(campaignId, this.snapshot(campaignId));
    return this.snapshot(campaignId);
  }

  pauseAll(reason) {
    const rows = getDb()
      .prepare("SELECT id, user_id, name FROM campaigns WHERE status IN ('sending', 'queued')")
      .all();
    for (const row of rows) {
      campaignService.setStatus(row.id, "paused", { paused_at: nowSql(), pause_reason: reason });
      campaignLog(row.id, "paused", reason);
      notificationService.create({
        userId: row.user_id,
        type: "campaign_paused",
        title: "کمپین متوقف موقت شد",
        body: reason
      });
      this.emit(row.id, this.snapshot(row.id));
    }
  }

  ensureLoop() {
    if (this.loopTimer) return;
    this.loopTimer = setInterval(() => {
      this.tick().catch((err) => logger.warn({ err: err.message }, "queue tick"));
    }, config.isTest ? 50 : 800);
    this.loopTimer.unref?.();
  }

  stopLoop() {
    if (this.loopTimer) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
  }

  async tick() {
    this.processScheduled();
    const campaign = getDb()
      .prepare("SELECT * FROM campaigns WHERE status IN ('queued', 'sending') ORDER BY id ASC LIMIT 1")
      .get();
    if (!campaign) return;
    if (this.running.has(campaign.id)) return;
    this.running.set(campaign.id, true);
    try {
      await this.processOne(campaign);
    } finally {
      this.running.delete(campaign.id);
    }
  }

  processScheduled() {
    const due = getDb()
      .prepare(
        `SELECT sc.*, c.status AS campaign_status FROM scheduled_campaigns sc
         JOIN campaigns c ON c.id = sc.campaign_id
         WHERE sc.status = 'scheduled' AND sc.run_at <= datetime('now')`
      )
      .all();
    for (const item of due) {
      if (!waManager.primary().isConnected()) {
        campaignService.setStatus(item.campaign_id, "paused", {
          pause_reason: "whatsapp_disconnected",
          paused_at: nowSql()
        });
        getDb()
          .prepare("UPDATE scheduled_campaigns SET status = 'waiting_connection', last_checked_at = datetime('now') WHERE id = ?")
          .run(item.id);
        notificationService.create({
          type: "campaign_paused",
          title: "زمان‌بندی اجرا نشد",
          body: "واتساپ متصل نیست؛ کمپین در حالت توقف موقت است."
        });
        continue;
      }
      getDb().prepare("UPDATE scheduled_campaigns SET status = 'started', last_checked_at = datetime('now') WHERE id = ?").run(item.id);
      campaignService.setStatus(item.campaign_id, "queued", { started_at: nowSql(), pause_reason: null });
      campaignLog(item.campaign_id, "scheduled_start", "Scheduled campaign entered queue");
    }
  }

  async processOne(campaign) {
    if (!waManager.primary().isConnected()) {
      campaignService.setStatus(campaign.id, "paused", {
        pause_reason: "whatsapp_disconnected",
        paused_at: nowSql()
      });
      notificationService.create({
        userId: campaign.user_id,
        type: "whatsapp_disconnected",
        title: "واتساپ قطع شد",
        body: "کمپین به حالت توقف موقت رفت."
      });
      this.emit(campaign.id, this.snapshot(campaign.id));
      return;
    }

    const job = getDb()
      .prepare(
        `SELECT cg.*, g.wa_id, g.name AS group_name, g.membership_status
         FROM campaign_groups cg JOIN groups g ON g.id = cg.group_id
         WHERE cg.campaign_id = ? AND cg.status = 'pending'
         ORDER BY cg.position ASC LIMIT 1`
      )
      .get(campaign.id);

    if (!job) {
      campaignService.recount(campaign.id);
      campaignService.setStatus(campaign.id, "completed", { completed_at: nowSql(), current_group_id: null });
      const done = getDb().prepare("SELECT * FROM campaigns WHERE id = ?").get(campaign.id);
      campaignLog(campaign.id, "completed", "Campaign completed");
      systemLog("campaign_completed", `Campaign ${campaign.name} completed`);
      notificationService.create({
        userId: campaign.user_id,
        type: "campaign_completed",
        title: "کمپین تمام شد",
        body: `${done.total_groups} گروه | موفق ${done.sent_count} | ناموفق ${done.failed_count}`
      });
      this.emit(campaign.id, this.snapshot(campaign.id));
      return;
    }

    campaignService.setStatus(campaign.id, "sending", { current_group_id: job.id });
    this.emit(campaign.id, this.snapshot(campaign.id));

    if (job.membership_status !== "member") {
      getDb()
        .prepare("UPDATE campaign_groups SET status = 'skipped', error = ? WHERE id = ?")
        .run("not a member", job.id);
      campaignLog(campaign.id, "skipped", `${job.group_name}: not a member`);
      campaignService.recount(campaign.id);
      this.emit(campaign.id, this.snapshot(campaign.id));
      return;
    }

    const attachment = getDb()
      .prepare("SELECT * FROM message_attachments WHERE campaign_id = ? LIMIT 1")
      .get(campaign.id);

    try {
      await this.sendWithRetry(campaign, job, attachment);
      getDb()
        .prepare("UPDATE campaign_groups SET status = 'sent', sent_at = datetime('now'), error = NULL WHERE id = ?")
        .run(job.id);
      getDb()
        .prepare("UPDATE groups SET last_campaign_at = datetime('now') WHERE id = ?")
        .run(job.group_id);
      getDb()
        .prepare(
          `INSERT INTO messages (campaign_id, campaign_group_id, session_id, chat_id, direction, body, status)
           VALUES (?, ?, ?, ?, 'out', ?, 'sent')`
        )
        .run(campaign.id, job.id, campaign.session_id, job.wa_id, campaign.message);
      campaignLog(campaign.id, "sent", `Sent to ${job.group_name}`);
      systemLog("message_sent", `Message sent to group ${job.group_name}`);
      getDb().prepare("UPDATE campaigns SET consecutive_failures = 0 WHERE id = ?").run(campaign.id);
    } catch (err) {
      if (err.code === "cancelled") return;
      logger.warn({ err: err.message }, "send failed");
      if (looksLikeRateLimit(err)) {
        getDb()
          .prepare("UPDATE campaign_groups SET status = 'pending', error = ? WHERE id = ?")
          .run(err.message.slice(0, 500), job.id);
        this.pause(campaign.id, { id: campaign.user_id, role: "admin" }, "rate_limit");
        return;
      }
      getDb()
        .prepare("UPDATE campaign_groups SET status = 'failed', error = ? WHERE id = ?")
        .run(String(err.message).slice(0, 500), job.id);
      campaignLog(campaign.id, "failed", `${job.group_name}: ${err.message}`, "error");
      systemLog("message_failed", `Message failed for ${job.group_name}`);
      const c = getDb().prepare("SELECT consecutive_failures FROM campaigns WHERE id = ?").get(campaign.id);
      const nextFail = (c?.consecutive_failures || 0) + 1;
      getDb().prepare("UPDATE campaigns SET consecutive_failures = ? WHERE id = ?").run(nextFail, campaign.id);
      if (nextFail >= config.maxConsecutiveFailures) {
        this.pause(campaign.id, { id: campaign.user_id, role: "admin" }, "too_many_failures");
        notificationService.create({
          userId: campaign.user_id,
          type: "multiple_failures",
          title: "خطاهای متوالی ارسال",
          body: "کمپین به‌خاطر تعداد خطا متوقف موقت شد."
        });
        campaignService.recount(campaign.id);
        return;
      }
    }

    campaignService.recount(campaign.id);
    const latest = getDb().prepare("SELECT * FROM campaigns WHERE id = ?").get(campaign.id);
    if (latest.status !== "sending" && latest.status !== "queued") {
      this.emit(campaign.id, this.snapshot(campaign.id));
      return;
    }
    const more = getDb()
      .prepare("SELECT COUNT(*) AS c FROM campaign_groups WHERE campaign_id = ? AND status = 'pending'")
      .get(campaign.id).c;
    if (more > 0) {
      const delay = pickDelay(latest);
      await sleep(delay);
    }
    this.emit(campaign.id, this.snapshot(campaign.id));
  }

  async sendWithRetry(campaign, job, attachment) {
    const wa = waManager.primary();
    const payload = {
      waId: job.wa_id,
      text: campaign.message,
      caption: campaign.caption || campaign.message,
      attachmentRel: attachment?.rel_path || null
    };
    try {
      await wa.sendToGroup(payload);
    } catch (err) {
      if (looksLikeRateLimit(err)) throw err;
      const retries = config.maxRetryAttempts;
      if (retries < 1) throw err;
      getDb()
        .prepare("UPDATE campaign_groups SET retry_count = retry_count + 1 WHERE id = ?")
        .run(job.id);
      await sleep(config.retryWaitSeconds * 1000);
      const still = getDb().prepare("SELECT status FROM campaigns WHERE id = ?").get(campaign.id);
      if (!["sending", "queued"].includes(still.status)) {
        throw Object.assign(new Error("cancelled"), { code: "cancelled" });
      }
      await wa.sendToGroup(payload);
    }
  }
}

export const campaignQueue = new CampaignQueue();
