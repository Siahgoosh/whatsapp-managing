import { EventEmitter } from "node:events";
import { config } from "../../config/index.js";
import { getDb } from "../../database/index.js";
import { CITIES, generateQueries } from "./cities.js";
import { getEnabledProviders } from "./providers.js";
import { extractInviteLinks } from "./links.js";
import { safeFetch } from "./http.js";
import { robotsAllows } from "./robots.js";
import { looksLikeCaptchaOrLogin, validateInvite } from "./validate.js";
import { upsertPublicGroup } from "./store.js";
import { logger, systemLog } from "../../backend/src/utils/logger.js";
import { assertPublicHttpUrl } from "./ssrf.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export class PublicGroupScanner extends EventEmitter {
  constructor({ providers } = {}) {
    super();
    this.running = false;
    this.scanId = null;
    this.providers = providers;
    this.io = null;
  }

  attach(io) {
    this.io = io;
  }

  enabledProviders() {
    return this.providers || getEnabledProviders(config);
  }

  async start({ cities = CITIES.map((c) => c.id), userId = null } = {}) {
    if (this.running) throw Object.assign(new Error("اسکن در حال اجراست"), { status: 409 });
    const providers = this.enabledProviders();
    if (!providers.length) {
      throw Object.assign(
        new Error("هیچ Search API تنظیم نشده. GOOGLE_CSE_API_KEY+GOOGLE_CSE_CX یا BING_SEARCH_API_KEY را در .env بگذارید."),
        { status: 400, code: "search_unconfigured" }
      );
    }
    const selected = CITIES.filter((c) => cities.includes(c.id) || cities.includes(c.fa));
    if (!selected.length) throw Object.assign(new Error("شهری انتخاب نشده"), { status: 400 });

    const info = getDb()
      .prepare(
        `INSERT INTO public_group_scans (user_id, status, cities, progress_json) VALUES (?, 'running', ?, ?)`
      )
      .run(userId, selected.map((c) => c.fa).join("، "), "{}");
    this.scanId = Number(info.lastInsertRowid);
    this.running = true;
    this.run(selected, providers, userId).catch((err) => {
      logger.warn({ err: err.message }, "finder scan failed");
      getDb()
        .prepare("UPDATE public_group_scans SET status = 'failed', error = ?, completed_at = datetime('now') WHERE id = ?")
        .run(String(err.message).slice(0, 500), this.scanId);
    });
    return this.snapshot();
  }

  snapshot() {
    return getDb().prepare("SELECT * FROM public_group_scans WHERE id = ?").get(this.scanId);
  }

  emitProgress(payload) {
    if (this.scanId) {
      getDb()
        .prepare("UPDATE public_group_scans SET progress_json = ? WHERE id = ?")
        .run(JSON.stringify(payload), this.scanId);
    }
    if (this.io) this.io.emit("finder:progress", { scanId: this.scanId, ...payload });
    this.emit("progress", payload);
  }

  async run(selected, providers, userId) {
    let queriesCount = 0;
    let resultsCount = 0;
    let waLinks = 0;
    let newLinks = 0;
    let duplicates = 0;
    let invalidLinks = 0;
    let pagesFetched = 0;

    try {
      for (let i = 0; i < selected.length; i++) {
        const city = selected[i];
        const queries = generateQueries(city);
        let cityResults = 0;
        let cityLinks = 0;
        let cityNew = 0;
        for (const query of queries) {
          queriesCount += 1;
          for (const provider of providers) {
            let hits = [];
            try {
              hits = await provider.search(query);
            } catch (err) {
              logger.warn({ provider: provider.name, err: err.message }, "search provider error");
              continue;
            }
            for (const hit of hits) {
              resultsCount += 1;
              cityResults += 1;
              getDb()
                .prepare(
                  `INSERT INTO public_search_results
                   (scan_id, url, title, source_website, search_query, city, link_type)
                   VALUES (?, ?, ?, ?, ?, ?, ?)`
                )
                .run(
                  this.scanId,
                  String(hit.url || "").slice(0, 1000),
                  String(hit.title || "").slice(0, 300),
                  hit.sourceWebsite || provider.name,
                  query,
                  city.fa,
                  extractInviteLinks(`${hit.url} ${hit.snippet}`).length ? "whatsapp_invite" : "webpage"
                );

              const blob = `${hit.url}\n${hit.title}\n${hit.snippet}`;
              const direct = extractInviteLinks(blob);
              for (const link of direct) {
                const r = await this.ingest(link, {
                  city: city.fa,
                  title: hit.title,
                  sourceUrl: hit.url,
                  sourceType: "search_engine",
                  sourceWebsite: hit.sourceWebsite || provider.name,
                  query
                });
                waLinks += 1;
                cityLinks += 1;
                if (r.duplicate) duplicates += 1;
                else if (r.invalid) invalidLinks += 1;
                else newLinks += 1;
                if (!r.duplicate && !r.invalid) cityNew += 1;
              }

              if (pagesFetched < config.finder.maxPagesPerScan && hit.url && !extractInviteLinks(hit.url).length) {
                const crawled = await this.crawlPage(hit.url, city, query, hit, provider.name);
                pagesFetched += crawled.fetched;
                waLinks += crawled.links;
                newLinks += crawled.fresh;
                duplicates += crawled.dups;
                invalidLinks += crawled.invalid;
                cityLinks += crawled.links;
                cityNew += crawled.fresh;
              }
            }
            await sleep(config.isTest ? 0 : 800);
          }
        }
        this.emitProgress({
          city: city.fa,
          cityIndex: i + 1,
          cityTotal: selected.length,
          queries: queries.length,
          results: cityResults,
          whatsappLinks: cityLinks,
          newGroups: cityNew,
          totals: { queriesCount, resultsCount, waLinks, newLinks, duplicates, invalidLinks }
        });
        getDb()
          .prepare(
            `UPDATE public_group_scans SET queries_count = ?, results_count = ?, whatsapp_links = ?, new_links = ?, duplicates = ?, invalid_links = ? WHERE id = ?`
          )
          .run(queriesCount, resultsCount, waLinks, newLinks, duplicates, invalidLinks, this.scanId);
      }
      getDb()
        .prepare(
          `UPDATE public_group_scans SET status = 'completed', completed_at = datetime('now'),
           queries_count = ?, results_count = ?, whatsapp_links = ?, new_links = ?, duplicates = ?, invalid_links = ? WHERE id = ?`
        )
        .run(queriesCount, resultsCount, waLinks, newLinks, duplicates, invalidLinks, this.scanId);
      systemLog("finder_scan_completed", `Scan ${this.scanId} completed`, { userId });
    } finally {
      this.running = false;
      this.emitProgress({ done: true, ...this.snapshot() });
    }
  }

  async ingest(link, meta) {
    const saved = upsertPublicGroup({ url: link, ...meta });
    if (saved.invalid) return saved;
    if (saved.duplicate) return saved;
    const checked = await validateInvite(saved.group.normalized_url);
    getDb()
      .prepare(
        `UPDATE public_whatsapp_groups
         SET status = ?, http_status = ?, last_checked_at = datetime('now'),
             group_name = CASE WHEN ? != '' THEN ? ELSE group_name END,
             description = CASE WHEN ? != '' THEN ? ELSE description END,
             image_url = COALESCE(?, image_url),
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(
        checked.status,
        checked.httpStatus,
        checked.meta?.groupName || "",
        checked.meta?.groupName || "",
        checked.meta?.description || "",
        checked.meta?.description || "",
        checked.meta?.image || null,
        saved.group.id
      );
    if (checked.status === "invalid") return { ...saved, invalid: true };
    return saved;
  }

  async crawlPage(url, city, query, hit, providerName) {
    const out = { fetched: 0, links: 0, fresh: 0, dups: 0, invalid: 0 };
    try {
      await assertPublicHttpUrl(url);
      const page = new URL(url);
      const origin = `${page.protocol}//${page.host}`;
      const allowed = await robotsAllows(origin, page.pathname, async (robotsUrl) => {
        const r = await safeFetch(robotsUrl, { method: "GET" });
        return r;
      });
      if (!allowed) {
        getDb()
          .prepare(
            `INSERT INTO public_search_results (scan_id, url, title, source_website, search_query, city, http_status, link_type)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'blocked_robots')`
          )
          .run(this.scanId, url, hit.title || "", hit.sourceWebsite || providerName, query, city.fa, 0);
        return out;
      }
      await sleep(config.isTest ? 0 : config.finder.crawlDelayMs);
      const res = await safeFetch(url, { method: "GET" });
      out.fetched = 1;
      if (looksLikeCaptchaOrLogin(res.body, res.status)) return out;
      const links = extractInviteLinks(res.body);
      for (const link of links) {
        const r = await this.ingest(link, {
          city: city.fa,
          title: hit.title,
          sourceUrl: url,
          sourceType: "website",
          sourceWebsite: hit.sourceWebsite || providerName,
          query
        });
        out.links += 1;
        if (r.duplicate) out.dups += 1;
        else if (r.invalid) out.invalid += 1;
        else out.fresh += 1;
      }
    } catch (err) {
      logger.info({ err: err.message }, "skip page crawl");
    }
    return out;
  }
}

export const publicGroupScanner = new PublicGroupScanner();
