import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { statusFa } from "../store.jsx";

export function SchedulerPage() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    api.scheduler().then((d) => setItems(d.items || []));
  }, []);
  return (
    <div>
      <div className="topbar">
        <div>
          <h2>زمان‌بندی</h2>
          <p className="muted">قبل از اجرا اتصال واتساپ بررسی می‌شود. اگر قطع باشد کمپین Pause می‌شود.</p>
        </div>
        <Link className="btn" to="/campaigns/new">کمپین زمان‌بندی‌شده</Link>
      </div>
      <div className="card">
        <table className="table">
          <thead>
            <tr><th>کمپین</th><th>زمان اجرا</th><th>وضعیت زمان‌بندی</th><th>وضعیت کمپین</th></tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td><Link to={`/campaigns/${i.campaign_id}`}>{i.name}</Link></td>
                <td>{i.run_at}</td>
                <td>{statusFa(i.status)}</td>
                <td>{statusFa(i.campaign_status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ReportsPage() {
  const [data, setData] = useState(null);
  const [notes, setNotes] = useState([]);
  useEffect(() => {
    api.reports().then(setData);
    api.notifications().then((d) => setNotes(d.notifications || []));
  }, []);
  return (
    <div>
      <div className="topbar"><div><h2>گزارش‌ها و اعلان‌ها</h2></div>
        <button className="btn secondary" onClick={() => api.readAll()}>خواندن همه</button>
      </div>
      <div className="grid stats">
        <div className="card stat">ارسال موفق<b>{data?.totals?.sent ?? 0}</b></div>
        <div className="card stat">ناموفق<b>{data?.totals?.failed ?? 0}</b></div>
        <div className="card stat">ردشده<b>{data?.totals?.skipped ?? 0}</b></div>
        <div className="card stat">کمپین<b>{data?.totals?.campaigns ?? 0}</b></div>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h3>اعلان‌های داخلی</h3>
        {notes.map((n) => (
          <div key={n.id} className="row" style={{ justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
            <span>🔔 {n.title} — {n.body}</span>
            <span className="muted">{n.created_at}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
