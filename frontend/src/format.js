export function activityAgo(sql) {
  if (!sql) return "بدون پیام اخیر";
  const raw = String(sql);
  const d = new Date(raw.includes("T") ? raw : raw.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return "بدون پیام اخیر";
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (mins < 5) return "همین الان";
  if (mins < 60) return `${mins} دقیقه پیش`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} ساعت پیش`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} روز پیش`;
  const months = Math.round(days / 30);
  if (months < 18) return `${months} ماه پیش`;
  return "خیلی قدیمی";
}
