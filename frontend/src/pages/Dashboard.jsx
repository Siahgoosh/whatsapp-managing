import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { statusFa, useApp } from "../store.jsx";

export function Dashboard() {
  const { wa } = useApp();
  const [data, setData] = useState(null);

  useEffect(() => {
    api.dashboard().then(setData).catch(() => {});
  }, []);

  const s = data?.stats || {};
  return (
    <div>
      <div className="topbar">
        <div>
          <h2>داشبورد</h2>
          <p className="muted">وضعیت حساب، کمپین‌ها و فعالیت‌های اخیر</p>
        </div>
        <Link className="btn" to="/campaigns/new">
          کمپین جدید
        </Link>
      </div>
      <div className="grid stats">
        <div className="card stat">
          وضعیت واتساپ
          <b>{statusFa(wa.status)}</b>
        </div>
        <div className="card stat">
          گروه‌ها
          <b>{s.groups ?? "—"}</b>
        </div>
        <div className="card stat">
          کمپین‌ها
          <b>{s.campaigns ?? "—"}</b>
        </div>
        <div className="card stat">
          پیام‌های ارسال‌شده
          <b>{s.sent ?? "—"}</b>
        </div>
        <div className="card stat">
          ناموفق
          <b>{s.failed ?? "—"}</b>
        </div>
        <div className="card stat">
          کمپین فعال
          <b>{s.active ?? "—"}</b>
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "1.2fr .8fr", marginTop: 18 }}>
        <div className="card">
          <h3>گزارش فعالیت</h3>
          {(data?.activity || []).map((a) => (
            <div key={a.id} className="row" style={{ justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
              <span>{a.message}</span>
              <span className="muted">{a.event}</span>
            </div>
          ))}
        </div>
        <div className="card">
          <h3>کمپین‌های اخیر</h3>
          {(data?.recent || []).map((c) => (
            <Link key={c.id} to={`/campaigns/${c.id}`} className="row" style={{ justifyContent: "space-between", padding: "8px 0" }}>
              <span>{c.name}</span>
              <span className="badge">{statusFa(c.status)}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
