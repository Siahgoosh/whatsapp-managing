export function phoneToWhatsAppJid(raw) {
  let d = String(raw || "").replace(/[^\d]/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0") && d.length === 11) d = `98${d.slice(1)}`;
  if (d.length === 10 && d.startsWith("9")) d = `98${d}`;
  if (d.length < 10 || d.length > 15) return null;
  return `${d}@s.whatsapp.net`;
}

export function formatShareLinks(rows) {
  const lines = ["لینک گروه‌های عمومی پیشنهادی:", ""];
  let i = 1;
  for (const row of rows) {
    const name = row.group_name || "گروه واتساپ";
    lines.push(`${i}. ${name}`);
    lines.push(row.normalized_url);
    lines.push("");
    i += 1;
  }
  return lines.join("\n").trim();
}
