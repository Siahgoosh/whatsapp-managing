import { getDb } from "../../database/index.js";
import { normalizeInviteUrl } from "./links.js";
import { CITIES } from "./cities.js";

export function upsertPublicGroup({
  url,
  city,
  title = "",
  description = "",
  sourceUrl = "",
  sourceType = "search_engine",
  sourceWebsite = "",
  query = "",
  status = "unknown",
  httpStatus = null
}) {
  const normalized = normalizeInviteUrl(url);
  if (!normalized) return { group: null, duplicate: false, invalid: true };
  const db = getDb();
  const existing = db.prepare("SELECT * FROM public_whatsapp_groups WHERE normalized_url = ?").get(normalized);
  if (existing) {
    db.prepare(
      `INSERT INTO group_sources (group_id, source_type, source_website, source_url, search_query, title, city)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(existing.id, sourceType, sourceWebsite, sourceUrl || normalized, query, title, city);
    return { group: existing, duplicate: true, invalid: false };
  }
  const cityFa = CITIES.find((c) => c.id === city || c.fa === city)?.fa || city;
  const info = db
    .prepare(
      `INSERT INTO public_whatsapp_groups
       (group_name, city, whatsapp_url, normalized_url, source_url, source_type, description, status, http_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      title || "گروه واتساپ",
      cityFa,
      normalized,
      normalized,
      sourceUrl || normalized,
      sourceType,
      description || "",
      status,
      httpStatus
    );
  const group = db.prepare("SELECT * FROM public_whatsapp_groups WHERE id = ?").get(info.lastInsertRowid);
  db.prepare(
    `INSERT INTO group_sources (group_id, source_type, source_website, source_url, search_query, title, city)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(group.id, sourceType, sourceWebsite, sourceUrl || normalized, query, title, cityFa);
  return { group, duplicate: false, invalid: false };
}

export function listPublicGroups({ q = "", city = "", status = "", category = "", sort = "id" } = {}) {
  let sql = "SELECT * FROM public_whatsapp_groups WHERE 1=1";
  const params = [];
  if (q) {
    sql += " AND (group_name LIKE ? OR normalized_url LIKE ? OR notes LIKE ?)";
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (city) {
    sql += " AND city = ?";
    params.push(city);
  }
  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }
  if (category) {
    sql += " AND category = ?";
    params.push(category);
  }
  const sortMap = {
    id: "id DESC",
    name: "group_name COLLATE NOCASE ASC",
    city: "city ASC",
    status: "status ASC",
    date: "discovered_at DESC"
  };
  sql += ` ORDER BY ${sortMap[sort] || sortMap.id}`;
  const rows = getDb().prepare(sql).all(...params);
  const src = getDb().prepare("SELECT * FROM group_sources WHERE group_id = ? ORDER BY id DESC");
  return rows.map((r) => ({ ...r, sources: src.all(r.id) }));
}

export function finderStats() {
  const db = getDb();
  const cities = db.prepare("SELECT COUNT(DISTINCT city) AS c FROM public_whatsapp_groups").get().c;
  const found = db.prepare("SELECT COUNT(*) AS c FROM public_whatsapp_groups").get().c;
  const valid = db.prepare("SELECT COUNT(*) AS c FROM public_whatsapp_groups WHERE status = 'valid'").get().c;
  const invalid = db.prepare("SELECT COUNT(*) AS c FROM public_whatsapp_groups WHERE status = 'invalid'").get().c;
  const unavailable = db.prepare("SELECT COUNT(*) AS c FROM public_whatsapp_groups WHERE status = 'unavailable'").get().c;
  const joined = db.prepare("SELECT COUNT(*) AS c FROM public_whatsapp_groups WHERE joined_status = 'joined'").get().c;
  const notJoined = db.prepare("SELECT COUNT(*) AS c FROM public_whatsapp_groups WHERE joined_status = 'not_joined'").get().c;
  const dups = db.prepare("SELECT COUNT(*) AS c FROM group_sources").get().c - found;
  return {
    citiesScanned: cities,
    groupsFound: found,
    validLinks: valid,
    invalidLinks: invalid,
    unavailable,
    duplicates: Math.max(0, dups),
    alreadyJoined: joined,
    notJoined
  };
}
