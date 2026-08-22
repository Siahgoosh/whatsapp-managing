export class SearchProvider {
  constructor(name) {
    this.name = name;
  }
  enabled() {
    return false;
  }
  async search() {
    throw new Error("not implemented");
  }
}

function mapItems(items, sourceType) {
  return items.map((it) => ({
    url: it.url,
    title: it.title || "",
    snippet: it.snippet || "",
    sourceWebsite: hostname(it.url),
    sourceType
  }));
}

function hostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export class GoogleProvider extends SearchProvider {
  constructor(config) {
    super("google");
    this.key = config.finder.googleKey;
    this.cx = config.finder.googleCx;
    this.num = config.finder.maxResultsPerQuery;
  }
  enabled() {
    return Boolean(this.key && this.cx);
  }
  async search(query) {
    if (!this.enabled()) {
      throw Object.assign(new Error("Google CSE API is not configured (GOOGLE_CSE_API_KEY / GOOGLE_CSE_CX)"), {
        code: "search_unconfigured"
      });
    }
    const u = new URL("https://www.googleapis.com/customsearch/v1");
    u.searchParams.set("key", this.key);
    u.searchParams.set("cx", this.cx);
    u.searchParams.set("q", query);
    u.searchParams.set("num", String(Math.min(10, this.num)));
    const res = await fetch(u, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      throw Object.assign(new Error(`Google Search API error ${res.status}`), { code: "search_api" });
    }
    const data = await res.json();
    const items = (data.items || []).map((it) => ({
      url: it.link,
      title: it.title,
      snippet: it.snippet
    }));
    return mapItems(items, "search_engine");
  }
}

export class BingProvider extends SearchProvider {
  constructor(config) {
    super("bing");
    this.key = config.finder.bingKey;
    this.num = config.finder.maxResultsPerQuery;
  }
  enabled() {
    return Boolean(this.key);
  }
  async search(query) {
    if (!this.enabled()) {
      throw Object.assign(new Error("Bing Search API is not configured (BING_SEARCH_API_KEY)"), {
        code: "search_unconfigured"
      });
    }
    const u = new URL("https://api.bing.microsoft.com/v7.0/search");
    u.searchParams.set("q", query);
    u.searchParams.set("count", String(Math.min(10, this.num)));
    const res = await fetch(u, {
      headers: { "Ocp-Apim-Subscription-Key": this.key, Accept: "application/json" }
    });
    if (!res.ok) {
      throw Object.assign(new Error(`Bing Search API error ${res.status}`), { code: "search_api" });
    }
    const data = await res.json();
    const items = (data.webPages?.value || []).map((it) => ({
      url: it.url,
      title: it.name,
      snippet: it.snippet
    }));
    return mapItems(items, "search_engine");
  }
}

export class CustomProvider extends SearchProvider {
  constructor(config) {
    super("custom");
    this.template = config.finder.customUrl;
    this.header = config.finder.customHeader;
  }
  enabled() {
    return Boolean(this.template && this.template.includes("{query}"));
  }
  async search(query) {
    if (!this.enabled()) {
      throw Object.assign(new Error("Custom search URL is not configured (SEARCH_CUSTOM_URL with {query})"), {
        code: "search_unconfigured"
      });
    }
    const url = this.template.replace("{query}", encodeURIComponent(query));
    const headers = { Accept: "application/json" };
    if (this.header && this.header.includes(":")) {
      const idx = this.header.indexOf(":");
      headers[this.header.slice(0, idx).trim()] = this.header.slice(idx + 1).trim();
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw Object.assign(new Error(`Custom Search API error ${res.status}`), { code: "search_api" });
    }
    const data = await res.json();
    const list = data.items || data.results || data.webPages?.value || [];
    const items = list.map((it) => ({
      url: it.url || it.link,
      title: it.title || it.name || "",
      snippet: it.snippet || it.description || ""
    }));
    return mapItems(items.filter((i) => i.url), "search_engine");
  }
}

export function getEnabledProviders(config, extra = []) {
  const all = [new GoogleProvider(config), new BingProvider(config), new CustomProvider(config), ...extra];
  return all.filter((p) => p.enabled());
}
