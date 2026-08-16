import { config } from "../../config/index.js";
import { extractInviteLinks, isWhatsAppInviteHost, normalizeInviteUrl } from "./links.js";
import { safeFetch } from "./http.js";

function looksLikeCaptchaOrLogin(body = "", status) {
  const t = String(body).toLowerCase();
  if (status === 401 || status === 403) return true;
  return (
    t.includes("captcha") ||
    t.includes("g-recaptcha") ||
    t.includes("hcaptcha") ||
    t.includes("cf-challenge") ||
    t.includes("please log in") ||
    t.includes("sign in to continue")
  );
}

export function parsePublicInviteMeta(html = "") {
  const name =
    html.match(/property="og:title"\s+content="([^"]+)"/i)?.[1] ||
    html.match(/<title>([^<]+)<\/title>/i)?.[1] ||
    "";
  const description =
    html.match(/property="og:description"\s+content="([^"]+)"/i)?.[1] ||
    html.match(/name="description"\s+content="([^"]+)"/i)?.[1] ||
    "";
  const image = html.match(/property="og:image"\s+content="([^"]+)"/i)?.[1] || "";
  const clean = (s) =>
    String(s)
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  return {
    groupName: clean(name).replace(/\s+\|\s+WhatsApp.*$/i, "") || "",
    description: clean(description),
    image
  };
}

export async function validateInvite(url) {
  const normalized = normalizeInviteUrl(url);
  if (!normalized) return { status: "invalid", httpStatus: null, meta: null };
  if (config.isTest) return { status: "valid", httpStatus: 200, meta: { groupName: "", description: "", image: "" } };
  try {
    const res = await safeFetch(normalized, { method: "GET", maxRedirects: 3 });
    if (!isWhatsAppInviteHost(res.url) && !isWhatsAppInviteHost(normalized)) {
      return { status: "invalid", httpStatus: res.status, meta: null };
    }
    if (res.status >= 400 && res.status < 500) return { status: "invalid", httpStatus: res.status, meta: null };
    if (res.status >= 500) return { status: "unavailable", httpStatus: res.status, meta: null };
    if (looksLikeCaptchaOrLogin(res.body, res.status)) {
      return { status: "unavailable", httpStatus: res.status, meta: null };
    }
    const meta = parsePublicInviteMeta(res.body);
    return { status: "valid", httpStatus: res.status, meta };
  } catch (err) {
    if (err.code === "ssrf" || err.code === "bad_protocol" || err.code === "invalid_url") {
      return { status: "invalid", httpStatus: null, meta: null };
    }
    return { status: "unavailable", httpStatus: null, meta: null };
  }
}

export { looksLikeCaptchaOrLogin, extractInviteLinks };
