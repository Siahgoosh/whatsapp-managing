import { config } from "../../config/index.js";
import { assertPublicHttpUrl } from "./ssrf.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export async function safeFetch(url, { method = "GET", maxRedirects = 3, timeoutMs } = {}) {
  const timeout = timeoutMs || config.finder.requestTimeoutMs;
  let current = await assertPublicHttpUrl(url);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    let res;
    try {
      res = await fetch(current, {
        method,
        redirect: "manual",
        signal: ctrl.signal,
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      });
    } catch (err) {
      clearTimeout(t);
      if (err.name === "AbortError") throw Object.assign(new Error("timeout"), { code: "timeout" });
      throw err;
    }
    clearTimeout(t);
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (!loc) return { url: current, status: res.status, body: "", headers: res.headers };
      current = await assertPublicHttpUrl(new URL(loc, current).toString());
      continue;
    }
    const ctype = res.headers.get("content-type") || "";
    let body = "";
    if (method !== "HEAD") {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 1_000_000) body = buf.subarray(0, 1_000_000).toString("utf8");
      else body = buf.toString("utf8");
    }
    return { url: current, status: res.status, body, contentType: ctype, headers: res.headers };
  }
  throw Object.assign(new Error("too many redirects"), { code: "redirects" });
}
