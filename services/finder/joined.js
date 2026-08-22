import { getDb } from "../../database/index.js";

function normName(s) {
  return String(s || "")
    .toLocaleLowerCase("fa")
    .replace(/\s+/g, " ")
    .trim();
}

export function refreshJoinedStatus() {
  const members = getDb()
    .prepare("SELECT name FROM groups WHERE membership_status = 'member'")
    .all()
    .map((g) => normName(g.name))
    .filter(Boolean);
  const rows = getDb().prepare("SELECT id, group_name FROM public_whatsapp_groups").all();
  const upd = getDb().prepare("UPDATE public_whatsapp_groups SET joined_status = ?, updated_at = datetime('now') WHERE id = ?");
  for (const row of rows) {
    const n = normName(row.group_name);
    if (!n || n === "گروه واتساپ") {
      upd.run("unknown", row.id);
      continue;
    }
    const hit = members.some((m) => m === n || m.includes(n) || n.includes(m));
    upd.run(hit ? "joined" : "not_joined", row.id);
  }
}
