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
  waStatus: () => request("/api/whatsapp/status"),
  waQr: () => request("/api/whatsapp/qr"),
  waConnect: () => request("/api/whatsapp/connect", { method: "POST", body: "{}" }),
  waLogout: () => request("/api/whatsapp/logout", { method: "POST", body: "{}" }),
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
  audit: () => request("/api/settings/audit"),
  backup: () => request("/api/settings/backup"),
  notifications: () => request("/api/notifications"),
  readAll: () => request("/api/notifications/read-all", { method: "POST", body: "{}" }),
  scheduler: () => request("/api/scheduler"),
  reports: () => request("/api/reports")
};
