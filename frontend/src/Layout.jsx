import React from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api, setCsrf } from "./api.js";
import { statusFa, useApp } from "./store.jsx";

const LINKS = [
  ["/", "داشبورد"],
  ["/whatsapp", "واتساپ"],
  ["/groups", "گروه‌ها"],
  ["/inbox", "صندوق ورودی"],
  ["/campaigns", "کمپین‌ها"],
  ["/templates", "قالب‌ها"],
  ["/auto-reply", "پاسخ خودکار"],
  ["/ai", "دستیار هوش مصنوعی"],
  ["/scheduler", "زمان‌بندی"],
  ["/reports", "گزارش‌ها"],
  ["/settings", "تنظیمات"]
];

export function Layout() {
  const { user, setUser, theme, setTheme, wa, notifications } = useApp();
  const nav = useNavigate();
  const unread = notifications.filter((n) => !n.read).length;

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
          {LINKS.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === "/"}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div style={{ marginTop: "auto", padding: 10 }}>
          <div className={`badge ${wa.status === "connected" ? "ok" : "warn"}`}>{statusFa(wa.status)}</div>
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
