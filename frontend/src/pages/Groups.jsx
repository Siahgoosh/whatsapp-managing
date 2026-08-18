import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { activityAgo } from "../format.js";
import { useApp } from "../store.jsx";

export function GroupsPage() {
  const { pushToast } = useApp();
  const [groups, setGroups] = useState([]);
  const [q, setQ] = useState("");
  const [onlyAdmin, setOnlyAdmin] = useState(false);
  const [onlyFav, setOnlyFav] = useState(false);
  const [selected, setSelected] = useState(new Set());

  async function load() {
    const d = await api.groups(q);
    setGroups(d.groups || []);
  }

  useEffect(() => {
    load().catch((e) => pushToast(e.message));
  }, [q]);

  const visible = useMemo(
    () => groups.filter((g) => (!onlyAdmin || g.is_admin) && (!onlyFav || g.is_favorite)),
    [groups, onlyAdmin, onlyFav]
  );

  function toggle(id) {
    const n = new Set(selected);
    n.has(id) ? n.delete(id) : n.add(id);
    setSelected(n);
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>گروه‌ها</h2>
          <p className="muted">فقط گروه‌هایی که حساب در آن‌ها عضو است. شماره اعضا استخراج نمی‌شود.</p>
        </div>
        <button className="btn" onClick={() => api.syncGroups().then(load).catch((e) => pushToast(e.message))}>
          همگام‌سازی
        </button>
      </div>
      <div className="card">
        <div className="row">
          <input className="input" style={{ maxWidth: 280 }} placeholder="جستجو" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="row"><input type="checkbox" checked={onlyAdmin} onChange={(e) => setOnlyAdmin(e.target.checked)} /> فقط ادمین</label>
          <label className="row"><input type="checkbox" checked={onlyFav} onChange={(e) => setOnlyFav(e.target.checked)} /> علاقه‌مندی</label>
          <button className="btn secondary" onClick={() => setSelected(new Set(visible.map((g) => g.id)))}>انتخاب همه</button>
          <button className="btn secondary" onClick={() => setSelected(new Set())}>هیچکدام</button>
          <span className="badge">{selected.size} انتخاب‌شده</span>
        </div>
        <div className="grid" style={{ marginTop: 14 }}>
          {visible.map((g) => (
            <label key={g.id} className="group-item">
              <input type="checkbox" checked={selected.has(g.id)} onChange={() => toggle(g.id)} />
              <img
                src={g.picture_path ? `/api/files/group/${g.id}` : ""}
                alt=""
                width="36"
                height="36"
                style={{ borderRadius: 10, background: "var(--bg-2)", objectFit: "cover" }}
                onError={(e) => {
                  e.currentTarget.style.visibility = "hidden";
                }}
              />
              <div style={{ flex: 1 }}>
                <b>{g.name}</b>
                <div className="muted" style={{ fontSize: 12 }}>
                  آخرین پیام: {activityAgo(g.last_activity_at)} · اعضا: {g.member_count ?? "—"} · {g.is_admin ? "ادمین" : "عضو"}
                  {g.city ? ` · ${g.city}` : ""} · مدیران: {g.admin_count ?? "—"}
                </div>
              </div>
              {g.advertising_permission === "approved" ? <span className="badge ok">🟢 Permission Granted</span> : null}
              <select
                className="input"
                style={{ maxWidth: 150 }}
                value={g.advertising_permission || "unknown"}
                onClick={(e) => e.preventDefault()}
                onChange={(e) => {
                  e.preventDefault();
                  api.patchGroup(g.id, { advertisingPermission: e.target.value }).then(load);
                }}
              >
                <option value="unknown">Unknown</option>
                <option value="requested">Requested</option>
                <option value="approved">Approved</option>
                <option value="declined">Declined</option>
                <option value="blocked">Blocked</option>
              </select>
              <button
                className="btn ghost"
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  api.patchGroup(g.id, { isFavorite: !g.is_favorite }).then(load);
                }}
              >
                {g.is_favorite ? "★" : "☆"}
              </button>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
