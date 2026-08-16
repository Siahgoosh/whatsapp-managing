const cache = new Map();

function parseRobots(text) {
  const lines = String(text || "").split(/\r?\n/);
  const groups = [];
  let current = { agents: [], rules: [] };
  for (let line of lines) {
    line = line.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (current.rules.length || current.agents.length > 1) {
        groups.push(current);
        current = { agents: [value.toLowerCase()], rules: [] };
      } else {
        current.agents.push(value.toLowerCase());
      }
    } else if (key === "disallow" || key === "allow") {
      current.rules.push({ type: key, path: value || "/" });
    }
  }
  if (current.agents.length) groups.push(current);
  return groups;
}

function matchingGroup(groups) {
  const star = groups.find((g) => g.agents.includes("*"));
  return star || { rules: [] };
}

function allowedPath(pathname, group) {
  const rules = [...(group.rules || [])].sort((a, b) => (b.path || "").length - (a.path || "").length);
  for (const rule of rules) {
    const p = rule.path || "";
    if (!p) continue;
    if (p === "/" || pathname.startsWith(p)) return rule.type === "allow";
  }
  return true;
}

export async function robotsAllows(origin, pathname, fetcher) {
  const key = origin;
  let parsed = cache.get(key);
  if (!parsed) {
    try {
      const res = await fetcher(`${origin}/robots.txt`);
      parsed = parseRobots(res.body || "");
    } catch {
      parsed = [];
    }
    cache.set(key, parsed);
  }
  return allowedPath(pathname || "/", matchingGroup(parsed));
}

export function _parseRobotsForTests(text) {
  return parseRobots(text);
}

export function _pathAllowedForTests(pathname, text) {
  return allowedPath(pathname, matchingGroup(parseRobots(text)));
}

export function clearRobotsCache() {
  cache.clear();
}
