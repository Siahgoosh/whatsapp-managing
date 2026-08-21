import React from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api, setCsrf } from "./api.js";
import { accountLabel, statusFa, useApp } from "./store.jsx";

const NAV = [
  {
    title: "اصلی",
    items: [
      ["/", "داشبورد"],
      ["/whatsapp", "واتساپ"]
    ]
  },
  {
    title: "گروه‌ها و ارتباط",
    items: [
      ["/groups", "مدیریت گروه‌ها"],
      ["/admin-outreach", "ارتباط با مدیران"],
      ["/discovered-groups", "گروه‌های کشف‌شده"],
      ["/public-group-finder", "جستجوی گروه عمومی"]
    ]
  },
  {
    title: "کمپین",
    items: [
      ["/inbox", "صندوق ورودی"],
      ["/campaigns", "کمپین‌ها"],
      ["/templates", "قالب‌ها"],
      ["/auto-reply", "پاسخ خودکار"],
      ["/ai", "دستیار هوش مصنوعی"],
      ["/scheduler", "زمان‌بندی"],
      ["/reports", "گزارش‌ها"],
      ["/settings", "تنظیمات"]
    ]
  }
];

const HIGHLIGHT = new Set(["/admin-outreach", "/discovered-groups"]);

export function Layout() {
  const { user, setUser, theme, setTheme, wa, switchAccount, notifications } = useApp();
  const nav = useNavigate();
  const unread = notifications.filter((n) => !n.read).length;
  const accounts = wa.accounts || [];
  const activeId = wa.account?.id || "";

  async function logout() {
    await api.logout();
    setCsrf(null);
    setUser(null);
    nav("/login");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">ف</div>
          <div>
            <h1>کمپین واتساپ</h1>
            <p>ارسال مجاز به گروه‌ها</p>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((section) => (
            <div key={section.title} className="nav-section">
              <div className="nav-label">{section.title}</div>
              {section.items.map(([to, label]) => (
                <NavLink key={to} to={to} end={to === "/"} className={HIGHLIGHT.has(to) ? "nav-highlight" : undefined}>
                  {label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className={`badge ${wa.status === "connected" ? "ok" : "warn"}`}>{statusFa(wa.status)}</div>
          {accounts.length > 1 ? (
            <select
              className="input"
              style={{ marginTop: 8 }}
              value={activeId}
              onChange={(e) => switchAccount(Number(e.target.value)).catch(() => {})}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {accountLabel(a)}
                </option>
              ))}
            </select>
          ) : (
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              {accountLabel(wa.account)}
            </div>
          )}
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            {user?.displayName} · {user?.role === "admin" ? "مدیر" : "اپراتور"}
            {unread ? ` · ${unread} اعلان` : ""}
          </div>
        </div>
      </aside>
      <section className="main">
        <div className="topbar">
          <div />
          <div className="row">
            <button className="icon-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="تم">
              {theme === "dark" ? "☀" : "☾"}
            </button>
            <button className="btn secondary" onClick={logout}>
              خروج
            </button>
          </div>
        </div>
        <Outlet />
      </section>
    </div>
  );
}
