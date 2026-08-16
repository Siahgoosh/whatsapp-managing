import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { statusFa, useApp } from "../store.jsx";

export function CampaignsPage() {
  const { pushToast } = useApp();
  const [items, setItems] = useState([]);

  async function load() {
    const d = await api.campaigns();
    setItems(d.campaigns || []);
  }
  useEffect(() => {
    load().catch(() => {});
  }, []);

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>تاریخچه کمپین</h2>
          <p className="muted">مشاهده، کپی، حذف و خروجی CSV</p>
        </div>
        <Link className="btn" to="/campaigns/new">ساخت کمپین</Link>
      </div>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>کمپین</th>
              <th>گروه‌ها</th>
              <th>موفق</th>
              <th>ناموفق</th>
              <th>تاریخ</th>
              <th>وضعیت</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.total_groups}</td>
                <td>{c.sent_count}</td>
                <td>{c.failed_count}</td>
                <td>{c.created_at}</td>
                <td><span className="badge">{statusFa(c.status)}</span></td>
                <td className="row">
                  <Link className="btn secondary" to={`/campaigns/${c.id}`}>مشاهده</Link>
                  <button className="btn secondary" onClick={() => api.duplicateCampaign(c.id).then(load)}>کپی</button>
                  <a className="btn secondary" href={`/api/campaigns/${c.id}/export`}>CSV</a>
                  <button className="btn danger" onClick={() => api.deleteCampaign(c.id).then(load).catch((e) => pushToast(e.message))}>حذف</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
