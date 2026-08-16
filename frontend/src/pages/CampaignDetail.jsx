import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { io } from "socket.io-client";
import { api } from "../api.js";
import { statusFa, useApp } from "../store.jsx";

export function CampaignDetail() {
  const { id } = useParams();
  const { pushToast } = useApp();
  const [data, setData] = useState(null);
  const [live, setLive] = useState(null);

  async function load() {
    setData(await api.campaign(id));
  }

  useEffect(() => {
    load().catch((e) => pushToast(e.message));
    const socket = io({ withCredentials: true });
    socket.on("campaign:progress", (p) => {
      if (String(p.campaignId) === String(id)) setLive(p);
    });
    return () => socket.close();
  }, [id]);

  const c = data?.campaign;
  if (!c) return <div>در حال بارگذاری...</div>;
  const sent = live?.sent ?? c.sent_count;
  const total = live?.total ?? c.total_groups;
  const status = live?.status ?? c.status;
  const pct = total ? Math.round((sent / total) * 100) : 0;

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>{c.name}</h2>
          <p className="muted">پیشرفت زنده بدون نیاز به رفرش صفحه</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => api.startCampaign(id).then(load).catch((e) => pushToast(e.message))}>Start</button>
          <button className="btn secondary" onClick={() => api.pauseCampaign(id).then(load)}>Pause</button>
          <button className="btn secondary" onClick={() => api.resumeCampaign(id).then(load).catch((e) => pushToast(e.message))}>Resume</button>
          <button className="btn danger" onClick={() => api.stopCampaign(id).then(load)}>Stop</button>
        </div>
      </div>
      {c.pause_reason === "rate_limit" && (
        <div className="card" style={{ borderColor: "var(--warning)", marginBottom: 16 }}>
          Sending has been paused because WhatsApp returned an abnormal/rate-limit response.
        </div>
      )}
      <div className="grid stats">
        <div className="card stat">وضعیت<b>{statusFa(status)}</b></div>
        <div className="card stat">پیشرفت<b>{sent} / {total}</b></div>
        <div className="card stat">گروه فعلی<b>{live?.currentGroup || "—"}</b></div>
        <div className="card stat">ناموفق<b>{live?.failed ?? c.failed_count}</b></div>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <div className="progress"><span style={{ width: `${pct}%` }} /></div>
        <div className="row" style={{ marginTop: 10 }}>
          <span className="badge ok">Sent {live?.sent ?? c.sent_count}</span>
          <span className="badge danger">Failed {live?.failed ?? c.failed_count}</span>
          <span className="badge">Pending {live?.pending ?? c.pending_count}</span>
          <span className="badge warn">Skipped {live?.skipped ?? c.skipped_count}</span>
        </div>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h3>گزارش کمپین</h3>
        <p>Total Groups: {total} · Successful: {sent} · Failed: {live?.failed ?? c.failed_count} · Skipped: {live?.skipped ?? c.skipped_count}</p>
        <a className="btn secondary" href={`/api/campaigns/${id}/export`}>Export CSV</a>
        <table className="table" style={{ marginTop: 12 }}>
          <thead>
            <tr><th>گروه</th><th>وضعیت</th><th>زمان</th><th>خطا</th><th>Retry</th></tr>
          </thead>
          <tbody>
            {(data.groups || []).map((g) => (
              <tr key={g.id}>
                <td>{g.group_name}</td>
                <td>{statusFa(g.status)}</td>
                <td>{g.sent_at || "—"}</td>
                <td>{g.error || "—"}</td>
                <td>{g.retry_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
