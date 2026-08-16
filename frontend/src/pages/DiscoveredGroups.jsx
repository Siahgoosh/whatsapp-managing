import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { statusFa, useApp } from "../store.jsx";

const JOIN_LABEL = {
  joined: "🟢 Already Joined",
  not_joined: "🔵 Not Joined",
  unknown: "⚪ Unknown"
};

export function DiscoveredGroups() {
  const { pushToast } = useApp();
  const nav = useNavigate();
  const [rows, setRows] = useState([]);
  const [analytics, setAnalytics] = useState({});
  const [q, setQ] = useState("");
  const [review, setReview] = useState(null);

  async function load() {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    const qs = p.toString() ? `?${p}` : "";
    const d = await api.discovery(qs);
    setRows(d.groups || []);
    setAnalytics(d.analytics || {});
  }

  useEffect(() => {
    load().catch((e) => pushToast(e.message));
  }, []);

  async function openJoin(row) {
    try {
      const r = await api.discoveryOpen(row.id);
      setReview(r.group);
      window.open(r.openUrl || row.normalized_url, "_blank", "noopener,noreferrer");
    } catch (e) {
      pushToast(e.message);
    }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Discovered Groups</h2>
          <p className="muted">لینک‌های chat.whatsapp.com که در گروه‌های عضو شما ارسال شده‌اند. Join خودکار انجام نمی‌شود.</p>
        </div>
        <button className="btn secondary" onClick={() => api.discoveryRefresh().then(load)}>بروزرسانی عضویت</button>
      </div>

      <div className="grid stats">
        <div className="card stat">Links Found<b>{analytics.linksFound ?? 0}</b></div>
        <div className="card stat">New Groups<b>{analytics.newGroups ?? 0}</b></div>
        <div className="card stat">Already Joined<b>{analytics.alreadyJoined ?? 0}</b></div>
        <div className="card stat">Pending Review<b>{analytics.pendingReview ?? 0}</b></div>
        <div className="card stat">Approved Groups<b>{analytics.approvedGroups ?? 0}</b></div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="row">
          <input className="input" style={{ maxWidth: 280 }} placeholder="جستجو" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn secondary" onClick={load}>جستجو</button>
        </div>
        <table className="table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Group Link</th>
              <th>Source Group</th>
              <th>Sender</th>
              <th>Date Found</th>
              <th>Validation</th>
              <th>Join Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id}>
                <td>
                  <b>{g.group_name || "Information unavailable"}</b>
                  <div className="muted" style={{ fontSize: 12 }}>{g.normalized_url}</div>
                  <div className="muted">Found By: {g.found_by} · {g.city}</div>
                </td>
                <td>{g.source_group_name || "—"}</td>
                <td>{g.sender_name || "—"}</td>
                <td>{g.found_at}</td>
                <td>
                  {g.validation_status === "valid" ? <span className="badge ok">🟢 Valid</span> : null}
                  {g.validation_status === "invalid" ? <span className="badge danger">🔴 Invalid</span> : null}
                  {g.validation_status !== "valid" && g.validation_status !== "invalid" ? (
                    <span className="badge">{statusFa(g.validation_status)}</span>
                  ) : null}
                </td>
                <td>{JOIN_LABEL[g.join_status] || JOIN_LABEL.unknown}</td>
                <td className="row">
                  <button className="btn secondary" onClick={() => api.discoveryValidate(g.id).then(load)}>Validate</button>
                  {g.validation_status === "valid" && (
                    <button className="btn" onClick={() => openJoin(g)}>Review & Join</button>
                  )}
                  {g.join_status === "joined" && !g.added_to_manager && (
                    <button
                      className="btn"
                      onClick={() =>
                        api.discoveryAdd(g.id).then(() => {
                          pushToast("به Group Manager اضافه شد");
                          load();
                          nav("/groups");
                        }).catch((e) => pushToast(e.message))
                      }
                    >
                      Add To Marketing Groups
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {review && (
        <div className="modal-back" onClick={() => setReview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Review & Join</h3>
            <p><b>{review.group_name || "Information unavailable"}</b></p>
            <p className="muted">{review.description || "Information unavailable"}</p>
            <p>Source Group: {review.source_group_name}</p>
            <p>Found By: {review.found_by}</p>
            <p>Found At: {review.found_at}</p>
            <p>لینک واتساپ در تب جدید باز شد. Join را خودتان در واتساپ تأیید کنید. سیستم گروهی را خودکار Join نمی‌کند.</p>
            <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
              <a className="btn secondary" href={review.normalized_url} target="_blank" rel="noreferrer">باز کردن دوباره لینک</a>
              <button
                className="btn"
                onClick={async () => {
                  try {
                    const r = await api.discoveryConfirmJoin(review.id);
                    setReview(r.group);
                    pushToast(r.group.join_status === "joined" ? "🟢 Already Joined" : "پس از عضویت همگام‌سازی کنید");
                    load();
                  } catch (e) {
                    pushToast(e.message);
                  }
                }}
              >
                عضویت را در واتساپ تأیید کردم
              </button>
              {review.join_status === "joined" && (
                <button
                  className="btn"
                  onClick={() =>
                    api.discoveryAdd(review.id).then(() => {
                      setReview(null);
                      nav("/groups");
                    }).catch((e) => pushToast(e.message))
                  }
                >
                  Add To Marketing Groups
                </button>
              )}
              <button className="btn secondary" onClick={() => setReview(null)}>بستن</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
