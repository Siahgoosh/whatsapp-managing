import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../store.jsx";

export function SettingsPage() {
  const { user, pushToast } = useApp();
  const [s, setS] = useState(null);
  const [form, setForm] = useState({});
  const [users, setUsers] = useState([]);
  const [quicks, setQuicks] = useState([]);
  const [shortcut, setShortcut] = useState("/price");
  const [qmsg, setQmsg] = useState("");
  const [newUser, setNewUser] = useState({ username: "", password: "", role: "operator", displayName: "", whatsappSessionId: "" });
  const [accounts, setAccounts] = useState([]);

  async function load() {
    const d = await api.settings();
    setS(d);
    setForm(d.settings || {});
    if (user.role === "admin") {
      const u = await api.users();
      setUsers(u.users || []);
      setAccounts(u.accounts || []);
    }
    setQuicks((await api.quickReplies()).items || []);
  }
  useEffect(() => { load().catch(() => {}); }, []);

  if (!s) return null;

  return (
    <div>
      <div className="topbar"><div><h2>تنظیمات</h2><p className="muted">امنیت، تلگرام، کاربران و پاسخ‌های سریع</p></div></div>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <form className="card" onSubmit={(e) => { e.preventDefault(); api.saveSettings(form).then(() => pushToast("ذخیره شد")).catch((err) => pushToast(err.message)); }}>
          <label>نام برند</label>
          <input className="input" value={form.brand_name || ""} onChange={(e) => setForm({ ...form, brand_name: e.target.value })} />
          <label className="row" style={{ marginTop: 12 }}>
            <input type="checkbox" checked={form.telegram_enabled === "true"} onChange={(e) => setForm({ ...form, telegram_enabled: e.target.checked ? "true" : "false" })} />
            اعلان تلگرام
          </label>
          <label>Bot Token</label>
          <input className="input" value={form.telegram_bot_token || ""} onChange={(e) => setForm({ ...form, telegram_bot_token: e.target.value })} />
          <label>Chat ID</label>
          <input className="input" value={form.telegram_chat_id || ""} onChange={(e) => setForm({ ...form, telegram_chat_id: e.target.value })} />
          <p className="muted">حداقل تأخیر ارسال: {s.limits.minDelaySeconds}s — حداکثر آپلود: {s.limits.maxUploadMb}MB</p>
          {user.role === "admin" && <button className="btn">ذخیره</button>}
        </form>
        <div className="card">
          <h3>پاسخ‌های سریع</h3>
          <div className="row">
            <input className="input" value={shortcut} onChange={(e) => setShortcut(e.target.value)} />
            <input className="input" value={qmsg} onChange={(e) => setQmsg(e.target.value)} placeholder="متن" />
            <button className="btn" onClick={() => api.createQuick({ shortcut, message: qmsg }).then(load)}>افزودن</button>
          </div>
          {quicks.map((q) => (
            <div key={q.id} className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
              <span><b>{q.shortcut}</b> → {q.message}</span>
              <button className="btn danger" onClick={() => api.deleteQuick(q.id).then(load)}>حذف</button>
            </div>
          ))}
        </div>
        {user.role === "admin" && (
          <div className="card">
            <h3>کاربران (Admin / Operator)</h3>
            {users.map((u) => (
              <div key={u.id} className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span>{u.username} · {u.role}</span>
                {accounts.length ? (
                  <select
                    className="input"
                    style={{ maxWidth: 220 }}
                    value={u.whatsapp_session_id || ""}
                    onChange={(e) =>
                      api.assignUserAccount(u.id, Number(e.target.value)).then(load).catch((err) => pushToast(err.message))
                    }
                  >
                    <option value="">اکانت واتساپ</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}{a.phone ? ` · ${a.phone}` : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="muted">{u.account_label || "—"}</span>
                )}
              </div>
            ))}
            <hr />
            <input className="input" placeholder="username" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} />
            <input className="input" placeholder="display name" value={newUser.displayName} onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })} />
            <input className="input" type="password" placeholder="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
            <select className="input" value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
              <option value="operator">operator</option>
              <option value="admin">admin</option>
            </select>
            {accounts.length > 0 && (
              <select
                className="input"
                value={newUser.whatsappSessionId}
                onChange={(e) => setNewUser({ ...newUser, whatsappSessionId: e.target.value })}
              >
                <option value="">اکانت واتساپ (برای اپراتور)</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}{a.phone ? ` · ${a.phone}` : ""}
                  </option>
                ))}
              </select>
            )}
            <button
              className="btn"
              style={{ marginTop: 8 }}
              onClick={() =>
                api
                  .createUser({
                    ...newUser,
                    whatsappSessionId: newUser.whatsappSessionId ? Number(newUser.whatsappSessionId) : undefined
                  })
                  .then(load)
                  .catch((e) => pushToast(e.message))
              }
            >
              ایجاد کاربر
            </button>
          </div>
        )}
        {user.role === "admin" && (
          <div className="card">
            <h3>پشتیبان</h3>
            <button className="btn secondary" onClick={() => api.backup().then((d) => {
              const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "wcm-backup.json";
              a.click();
            })}>خروجی پشتیبان (بدون رمز و نشست واتساپ)</button>
          </div>
        )}
      </div>
    </div>
  );
}
