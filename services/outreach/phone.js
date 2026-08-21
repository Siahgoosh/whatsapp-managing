export function phoneToWhatsAppJid(raw) {
  let d = String(raw || "").replace(/[^\d]/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0") && d.length === 11) d = `98${d.slice(1)}`;
  if (d.length === 10 && d.startsWith("9")) d = `98${d}`;
  if (d.length < 10 || d.length > 15) return null;
  return `${d}@s.whatsapp.net`;
}

export function formatShareLinks(rows, { startIndex = 1, part, parts } = {}) {
  const title =
    parts > 1
      ? `لینک گروه‌های عمومی پیشنهادی (${part} از ${parts}):`
      : "لینک گروه‌های عمومی پیشنهادی:";
  const lines = [title, ""];
  let i = startIndex;
  for (const row of rows) {
    const name = row.group_name || "گروه واتساپ";
    lines.push(`${i}. ${name}`);
    lines.push(row.normalized_url);
    lines.push("");
    i += 1;
  }
  return lines.join("\n").trim();
}

export function chunkShareRows(rows, maxChars = 3500) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!list.length) return [];
  const slices = [];
  let i = 0;
  while (i < list.length) {
    let take = 1;
    while (i + take < list.length) {
      const trial = formatShareLinks(list.slice(i, i + take + 1), { startIndex: i + 1 });
      if (trial.length > maxChars) break;
      take += 1;
    }
    slices.push(list.slice(i, i + take));
    i += take;
  }
  return slices.map((slice, idx) => {
    const startIndex = slices.slice(0, idx).reduce((n, s) => n + s.length, 0) + 1;
    return {
      rows: slice,
      text: formatShareLinks(slice, { startIndex, part: idx + 1, parts: slices.length })
    };
  });
}
