export function normalize(text, caseInsensitive = true) {
  let t = String(text || "").trim();
  if (caseInsensitive) t = t.toLocaleLowerCase("fa");
  return t.replace(/\s+/g, " ");
}

export function matchRule(rule, incomingText) {
  if (!rule.enabled) return false;
  const src = normalize(incomingText, rule.case_insensitive);
  const kw = normalize(rule.keyword, rule.case_insensitive);
  if (!kw) return false;
  if (rule.match_type === "exact") return src === kw;
  return src.includes(kw);
}

export function pickRule(rules, incomingText, chatType) {
  for (const rule of rules) {
    if (rule.apply_to === "private" && chatType === "group") continue;
    if (rule.apply_to === "groups" && chatType !== "group") continue;
    if (matchRule(rule, incomingText)) return rule;
  }
  return null;
}
