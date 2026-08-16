const INVITE_RE = /https?:\/\/(?:www\.)?(?:chat\.whatsapp\.com|wa\.me\/g)\/([A-Za-z0-9_-]{8,40})/gi;
const INVITE_CODE = /^[A-Za-z0-9_-]{8,40}$/;

export function extractInviteLinks(text = "") {
  const out = [];
  const seen = new Set();
  const str = String(text);
  let m;
  const re = new RegExp(INVITE_RE.source, "gi");
  while ((m = re.exec(str))) {
    const normalized = normalizeInviteUrl(m[0]);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
}

export function normalizeInviteUrl(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  try {
    if (s.startsWith("//")) s = "https:" + s;
    if (!/^https?:\/\//i.test(s)) s = "https://" + s.replace(/^\/+/, "");
    const u = new URL(s);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "chat.whatsapp.com" && host !== "wa.me") return null;
    let code = "";
    if (host === "chat.whatsapp.com") {
      code = u.pathname.replace(/^\//, "").split("/")[0];
    } else {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0] !== "g" || !parts[1]) return null;
      code = parts[1];
    }
    if (!INVITE_CODE.test(code)) return null;
    return `https://chat.whatsapp.com/${code}`;
  } catch {
    return null;
  }
}

export function isWhatsAppInviteHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return host === "chat.whatsapp.com" || host === "wa.me" || host.endsWith(".whatsapp.com");
  } catch {
    return false;
  }
}
