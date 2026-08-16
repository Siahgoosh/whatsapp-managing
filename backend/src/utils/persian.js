import jalaali from "jalaali-js";

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function toFaDigits(value) {
  return String(value).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
}

export function toJalali(isoOrSql) {
  if (!isoOrSql) return "—";
  const d = new Date(isoOrSql.includes("T") ? isoOrSql : isoOrSql.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return "—";
  const { jy, jm, jd } = jalaali.toJalaali(d);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return toFaDigits(`${jy}/${String(jm).padStart(2, "0")}/${String(jd).padStart(2, "0")} ${hh}:${mm}`);
}

export function formatDuration(ms) {
  if (!ms || ms < 0) return toFaDigits("0 دقیقه");
  const totalMin = Math.floor(ms / 60000);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours <= 0) return `${toFaDigits(mins)} دقیقه`;
  return `${toFaDigits(hours)} ساعت و ${toFaDigits(mins)} دقیقه`;
}

export function nowSql() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export function estimateDurationSeconds(groupCount, delayMin, delayMax, random) {
  const avg = random ? (Number(delayMin) + Number(delayMax)) / 2 : Number(delayMin);
  return Math.max(0, Math.round((groupCount - 1) * avg));
}
