import { isIP } from "node:net";
import dns from "node:dns/promises";

const BLOCKED_HOSTS = new Set(["localhost", "localhost.localdomain", "metadata.google.internal"]);

function ipParts(ip) {
  return ip.split(".").map((n) => Number(n));
}

export function isPrivateIp(ip) {
  if (!ip) return true;
  const v = String(ip).replace(/^::ffff:/, "");
  if (v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;
  if (!isIP(v) && !/^\d+\.\d+\.\d+\.\d+$/.test(v)) return true;
  if (!v.includes(".")) return true;
  const [a, b] = ipParts(v);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  return false;
}

export async function assertPublicHttpUrl(raw) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    throw Object.assign(new Error("invalid url"), { code: "invalid_url" });
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw Object.assign(new Error("only http/https allowed"), { code: "bad_protocol" });
  }
  if (u.username || u.password) {
    throw Object.assign(new Error("userinfo not allowed"), { code: "bad_url" });
  }
  const host = u.hostname.toLowerCase();
  if (!host || BLOCKED_HOSTS.has(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    throw Object.assign(new Error("blocked host"), { code: "ssrf" });
  }
  if (isIP(host) && isPrivateIp(host)) {
    throw Object.assign(new Error("private ip blocked"), { code: "ssrf" });
  }
  const looked = await dns.lookup(host, { all: true, verbatim: true }).catch(() => []);
  if (!looked.length) throw Object.assign(new Error("dns failed"), { code: "dns" });
  for (const rec of looked) {
    if (isPrivateIp(rec.address)) {
      throw Object.assign(new Error("private ip blocked"), { code: "ssrf" });
    }
  }
  return u.toString();
}
