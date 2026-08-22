let csrf = null;

export function setCsrf(token) {
  csrf = token;
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (csrf && options.method && options.method !== "GET") headers["X-CSRF-Token"] = csrf;
  const res = await fetch(path, { credentials: "include", ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "خطای شبکه");
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

export const api = {
  me: () => request("/api/auth/me"),
  login: (username, password) =>
    request("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => request("/api/auth/logout", { method: "POST", body: "{}" }),
  dashboard: () => request("/api/dashboard"),
  waStatus: (sessionId) =>
    request(`/api/whatsapp/status${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`),
  waQr: (sessionId) =>
    request(`/api/whatsapp/qr${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`),
  waConnect: (sessionId) =>
    request("/api/whatsapp/connect", { method: "POST", body: JSON.stringify(sessionId ? { sessionId } : {}) }),
  waLogout: (sessionId) =>
    request("/api/whatsapp/logout", { method: "POST", body: JSON.stringify(sessionId ? { sessionId } : {}) }),
  waAccounts: () => request("/api/whatsapp/accounts"),
  waCreateAccount: (label) => request("/api/whatsapp/accounts", { method: "POST", body: JSON.stringify({ label }) }),
  waRenameAccount: (id, label) =>
    request(`/api/whatsapp/accounts/${id}`, { method: "PATCH", body: JSON.stringify({ label }) }),
  waSetActive: (sessionId) =>
    request("/api/whatsapp/active", { method: "POST", body: JSON.stringify({ sessionId }) }),
  groups: (q = "") => request(`/api/groups?q=${encodeURIComponent(q)}`),
  syncGroups: () => request("/api/groups/sync", { method: "POST", body: "{}" }),
  patchGroup: (id, body) => request(`/api/groups/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  campaigns: () => request("/api/campaigns"),
  campaign: (id) => request(`/api/campaigns/${id}`),
  createCampaign: (formData) => request("/api/campaigns", { method: "POST", body: formData, headers: {} }),
  startCampaign: (id) => request(`/api/campaigns/${id}/start`, { method: "POST", body: "{}" }),
  pauseCampaign: (id) => request(`/api/campaigns/${id}/pause`, { method: "POST", body: "{}" }),
  resumeCampaign: (id) => request(`/api/campaigns/${id}/resume`, { method: "POST", body: "{}" }),
  stopCampaign: (id) => request(`/api/campaigns/${id}/stop`, { method: "POST", body: "{}" }),
  duplicateCampaign: (id) => request(`/api/campaigns/${id}/duplicate`, { method: "POST", body: "{}" }),
  deleteCampaign: (id) => request(`/api/campaigns/${id}`, { method: "DELETE" }),
  inbox: () => request("/api/inbox"),
  thread: (chatId) => request(`/api/inbox/${encodeURIComponent(chatId)}`),
  reply: (chatId, text) => request("/api/inbox/reply", { method: "POST", body: JSON.stringify({ chatId, text }) }),
  suggest: (chatId, chatName) =>
    request("/api/inbox/suggest", { method: "POST", body: JSON.stringify({ chatId, chatName }) }),
  templates: () => request("/api/templates"),
  createTemplate: (formData) => request("/api/templates", { method: "POST", body: formData, headers: {} }),
  deleteTemplate: (id) => request(`/api/templates/${id}`, { method: "DELETE" }),
  autoReplies: () => request("/api/auto-replies"),
  createRule: (body) => request("/api/auto-replies", { method: "POST", body: JSON.stringify(body) }),
  updateRule: (id, body) => request(`/api/auto-replies/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteRule: (id) => request(`/api/auto-replies/${id}`, { method: "DELETE" }),
  quickReplies: () => request("/api/quick-replies"),
  createQuick: (body) => request("/api/quick-replies", { method: "POST", body: JSON.stringify(body) }),
  deleteQuick: (id) => request(`/api/quick-replies/${id}`, { method: "DELETE" }),
  settings: () => request("/api/settings"),
  saveSettings: (body) => request("/api/settings", { method: "PUT", body: JSON.stringify(body) }),
  users: () => request("/api/settings/users"),
  createUser: (body) => request("/api/settings/users", { method: "POST", body: JSON.stringify(body) }),
  assignUserAccount: (id, whatsappSessionId) =>
    request(`/api/settings/users/${id}`, { method: "PATCH", body: JSON.stringify({ whatsappSessionId }) }),
  audit: () => request("/api/settings/audit"),
  backup: () => request("/api/settings/backup"),
  notifications: () => request("/api/notifications"),
  readAll: () => request("/api/notifications/read-all", { method: "POST", body: "{}" }),
  scheduler: () => request("/api/scheduler"),
  reports: () => request("/api/reports"),
  finderMeta: () => request("/api/finder/meta"),
  finderGroups: (qs = "") => request(`/api/finder/groups${qs}`),
  finderStats: () => request("/api/finder/stats"),
  finderScans: () => request("/api/finder/scans"),
  finderScan: (cities) => request("/api/finder/scan", { method: "POST", body: JSON.stringify({ cities }) }),
  finderCrawl: (body) => request("/api/finder/crawl", { method: "POST", body: JSON.stringify(body) }),
  finderAdd: (body) => request("/api/finder/groups", { method: "POST", body: JSON.stringify(body) }),
  finderPatch: (id, body) => request(`/api/finder/groups/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  finderImport: (csv) => request("/api/finder/import", { method: "POST", body: JSON.stringify({ csv }) }),
  finderToCampaign: (body) => request("/api/finder/add-to-campaign", { method: "POST", body: JSON.stringify(body) }),
  finderSchedule: (hours) => request("/api/finder/schedule", { method: "PUT", body: JSON.stringify({ hours }) }),
  outreachGroups: (q = "") => request(`/api/outreach/groups?q=${encodeURIComponent(q)}`),
  outreachAdmins: (qs = "") => request(`/api/outreach/admins${qs}`),
  outreachAdmin: (id) => request(`/api/outreach/admins/${id}`),
  outreachHistory: (id) => request(`/api/outreach/admins/${id}/history`),
  outreachPreview: (id) => request(`/api/outreach/admins/${id}/preview`),
  outreachTemplate: () => request("/api/outreach/template"),
  saveOutreachTemplate: (body) => request("/api/outreach/template", { method: "PUT", body: JSON.stringify(body) }),
  outreachAnalytics: () => request("/api/outreach/analytics"),
  outreachInbox: () => request("/api/outreach/inbox"),
  outreachDetect: (groupIds) => request("/api/outreach/detect", { method: "POST", body: JSON.stringify({ groupIds }) }),
  outreachPrepare: (body) => request("/api/outreach/prepare", { method: "POST", body: JSON.stringify(body) }),
  outreachApprove: (body) => request("/api/outreach/approve", { method: "POST", body: JSON.stringify(body) }),
  outreachSend: (body) => request("/api/outreach/send", { method: "POST", body: JSON.stringify(body) }),
  outreachNotes: (body) => request("/api/outreach/notes", { method: "POST", body: JSON.stringify(body) }),
  outreachPermission: (body) => request("/api/outreach/permission", { method: "POST", body: JSON.stringify(body) }),
  discovery: (qs = "") => request(`/api/discovery${qs}`),
  discoveryOpen: (id) => request(`/api/discovery/${id}/open`, { method: "POST", body: "{}" }),
  discoveryValidate: (id) => request(`/api/discovery/${id}/validate`, { method: "POST", body: "{}" }),
  discoveryConfirmJoin: (id) => request(`/api/discovery/${id}/confirm-join`, { method: "POST", body: "{}" }),
  discoveryAdd: (id) => request(`/api/discovery/${id}/add-to-manager`, { method: "POST", body: "{}" }),
  discoveryNotes: (id, body) => request(`/api/discovery/${id}/notes`, { method: "POST", body: JSON.stringify({ body }) }),
  discoveryRefresh: () => request("/api/discovery/refresh-joined", { method: "POST", body: "{}" }),
  discoveryScan: () => request("/api/discovery/scan", { method: "POST", body: "{}" }),
  discoveryCopy: (ids) => request("/api/discovery/copy-text", { method: "POST", body: JSON.stringify({ ids }) }),
  discoveryShare: (body) => request("/api/discovery/share", { method: "POST", body: JSON.stringify(body) })
};
