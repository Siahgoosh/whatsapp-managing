import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { statusFa, useApp } from "../store.jsx";

const PIPELINE = [
  "discovered",
  "contact_pending",
  "message_approved",
  "contacted",
  "replied",
  "permission_granted",
  "marketing_group",
  "declined"
];

const PERMISSIONS = ["unknown", "requested", "approved", "declined", "blocked"];

function permBadge(status) {
  if (status === "approved") return <span className="badge ok">🟢 Permission Granted</span>;
  if (status === "declined" || status === "blocked") return <span className="badge danger">{statusFa(status)}</span>;
  if (status === "requested") return <span className="badge warn">Permission Requested</span>;
  return <span className="badge">{statusFa(status || "unknown")}</span>;
}

export function AdminOutreach() {
  const { pushToast } = useApp();
  const [tab, setTab] = useState("groups");
  const [groups, setGroups] = useState([]);
  const [cities, setCities] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [analytics, setAnalytics] = useState({});
  const [pickedGroups, setPickedGroups] = useState(new Set());
  const [pickedAdmins, setPickedAdmins] = useState(new Set());
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState({ group: "", city: "", permission: "", status: "", dateFrom: "", dateTo: "" });
  const [template, setTemplate] = useState("");
  const [officeName, setOfficeName] = useState("");
  const [preview, setPreview] = useState(null);
  const [editText, setEditText] = useState("");
  const [history, setHistory] = useState(null);
  const [confirmSend, setConfirmSend] = useState(null);
  const [inbox, setInbox] = useState([]);
  const [noteDraft, setNoteDraft] = useState("");

  async function loadGroups() {
    const d = await api.outreachGroups(q);
    setGroups(d.groups || []);
    setCities(d.cities || []);
  }

  async function loadAdmins() {
    const p = new URLSearchParams();
    if (filters.group) p.set("group", filters.group);
    if (filters.city) p.set("city", filters.city);
    if (filters.permission) p.set("permission", filters.permission);
    if (filters.status) p.set("status", filters.status);
    if (filters.dateFrom) p.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) p.set("dateTo", filters.dateTo);
    if (q && tab === "admins") p.set("q", q);
    const qs = p.toString() ? `?${p}` : "";
    const d = await api.outreachAdmins(qs);
    setAdmins(d.admins || []);
  }

  async function loadAll() {
    await Promise.all([
      loadGroups(),
      loadAdmins(),
      api.outreachAnalytics().then(setAnalytics).catch(() => {}),
      api.outreachTemplate().then((t) => {
        setTemplate(t.template);
        setOfficeName(t.officeName);
      }),
      api.outreachInbox().then((d) => setInbox(d.conversations || [])).catch(() => {})
    ]);
  }

  useEffect(() => {
    loadAll().catch((e) => pushToast(e.message));
  }, []);

  useEffect(() => {
    if (tab === "admins") loadAdmins().catch(() => {});
  }, [filters, q, tab]);

  const visibleGroups = groups;
  const allGroupIds = useMemo(() => visibleGroups.map((g) => g.id), [visibleGroups]);
  const selectedAdmins = admins.filter((a) => pickedAdmins.has(a.id));

  function toggle(set, id) {
    const n = new Set(set);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  }

  async function detect() {
    try {
      const r = await api.outreachDetect([...pickedGroups]);
      pushToast(`${r.stored} مدیر شناسایی شد — اعضای عادی ذخیره نشدند`);
      await loadAll();
      setTab("admins");
    } catch (e) {
      pushToast(e.message);
    }
  }

  async function prepare(ids) {
    try {
      await api.outreachPrepare({ adminIds: ids, template });
      await loadAdmins();
      pushToast("پیام‌ها آماده شد");
    } catch (e) {
      pushToast(e.message);
    }
  }

  async function openPreview(id) {
    const d = await api.outreachPreview(id);
    setPreview(d);
    setEditText(d.message);
  }

  async function approvePreview() {
    try {
      await api.outreachApprove({ adminIds: [preview.admin.id], messages: { [preview.admin.id]: editText } });
      setPreview(null);
      await loadAdmins();
    } catch (e) {
      pushToast(e.message);
    }
  }

  function askSend(ids) {
    setConfirmSend(ids);
  }

  async function doSend(force = false) {
    const ids = confirmSend;
    try {
      const r = await api.outreachSend({
        adminIds: ids,
        confirm: true,
        confirmCount: ids.length,
        force
      });
      const sent = r.results.filter((x) => x.status === "sent").length;
      const skipped = r.results.filter((x) => x.status === "skipped").length;
      pushToast(`ارسال شد: ${sent} — Already Contacted: ${skipped}`);
      setConfirmSend(null);
      await loadAll();
    } catch (e) {
      pushToast(e.message);
    }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Admin Outreach</h2>
          <p className="muted">فقط مدیران گروه‌هایی که عضو آن‌ها هستید. ارسال بدون تأیید انجام نمی‌شود.</p>
        </div>
        <Link className="btn secondary" to="/discovered-groups">Discovered Groups</Link>
      </div>

      <div className="grid stats">
        <div className="card stat">Admins Found<b>{analytics.adminsFound ?? 0}</b></div>
        <div className="card stat">Pending Approval<b>{analytics.pendingApproval ?? 0}</b></div>
        <div className="card stat">Contacted<b>{analytics.adminsContacted ?? 0}</b></div>
        <div className="card stat">Replied<b>{analytics.adminsReplied ?? 0}</b></div>
        <div className="card stat">Permission Granted<b>{analytics.permissionsGranted ?? 0}</b></div>
      </div>

      <div className="tabs" style={{ marginTop: 16 }}>
        {[
          ["groups", "گروه‌های هدف"],
          ["admins", "Admin List"],
          ["inbox", "Admin Inbox"],
          ["template", "قالب پیام"]
        ].map(([id, label]) => (
          <button key={id} className={`btn ${tab === id ? "" : "secondary"}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "groups" && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="row">
            <input className="input" style={{ maxWidth: 260 }} placeholder="جستجو" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn secondary" onClick={loadGroups}>جستجو</button>
            <button className="btn secondary" onClick={() => setPickedGroups(new Set(allGroupIds))}>انتخاب همه</button>
            <button className="btn secondary" onClick={() => setPickedGroups(new Set())}>هیچکدام</button>
            <span className="badge">{pickedGroups.size} انتخاب‌شده</span>
            <button className="btn" disabled={!pickedGroups.size} onClick={detect}>شناسایی مدیران</button>
          </div>
          <div className="grid" style={{ marginTop: 14 }}>
            {visibleGroups.map((g) => (
              <label key={g.id} className="group-item">
                <input type="checkbox" checked={pickedGroups.has(g.id)} onChange={() => setPickedGroups(toggle(pickedGroups, g.id))} />
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
                    {g.wa_id} · اعضا: {g.member_count ?? "—"} · مدیران: {g.admin_count ?? "—"} · شهر: {g.city || "سایر"}
                    <br />
                    آخرین فعالیت: {g.last_activity_at || "—"} · {g.membership_status}
                  </div>
                </div>
                {permBadge(g.advertising_permission)}
              </label>
            ))}
          </div>
        </div>
      )}

      {tab === "admins" && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="row">
            <input className="input" style={{ maxWidth: 180 }} placeholder="Admin / Group" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="input" style={{ maxWidth: 140 }} value={filters.city} onChange={(e) => setFilters({ ...filters, city: e.target.value })}>
              <option value="">شهر</option>
              {cities.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select className="input" style={{ maxWidth: 160 }} value={filters.permission} onChange={(e) => setFilters({ ...filters, permission: e.target.value })}>
              <option value="">اجازه</option>
              {PERMISSIONS.map((p) => <option key={p} value={p}>{statusFa(p)}</option>)}
            </select>
            <select className="input" style={{ maxWidth: 180 }} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">وضعیت / Pipeline</option>
              {["new", "prepared", "pending_approval", "sent", "failed", ...PIPELINE].map((s) => (
                <option key={s} value={s}>{statusFa(s)}</option>
              ))}
            </select>
            <input className="input" type="date" style={{ maxWidth: 150 }} value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} />
            <input className="input" type="date" style={{ maxWidth: 150 }} value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} />
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn secondary" onClick={() => prepare(selectedAdmins.map((a) => a.id))} disabled={!pickedAdmins.size}>آماده‌سازی پیام</button>
            <button className="btn" onClick={() => askSend([...pickedAdmins])} disabled={!pickedAdmins.size}>Send Selected</button>
            <span className="badge">{pickedAdmins.size} انتخاب‌شده</span>
          </div>
          <table className="table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Select</th>
                <th>Admin</th>
                <th>Group</th>
                <th>Status</th>
                <th>Message</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.id}>
                  <td>
                    <input type="checkbox" checked={pickedAdmins.has(a.id)} onChange={() => setPickedAdmins(toggle(pickedAdmins, a.id))} />
                  </td>
                  <td>
                    <b>{a.display_name || "مدیر گروه"}</b>
                    <div className="muted" style={{ fontSize: 12 }}>{a.admin_role} · {a.wa_jid}</div>
                    {a.already_contacted && (
                      <div className="badge warn">Already Contacted · Last Contact: {a.last_contact}</div>
                    )}
                    {a.follow_up_available ? <div className="badge info">Follow-up available</div> : null}
                  </td>
                  <td>
                    {a.group_name}
                    <div>{permBadge(a.advertising_permission)}</div>
                    <div className="muted">{a.city}</div>
                  </td>
                  <td>
                    <span className="badge">{statusFa(a.message_status)}</span>
                    <div className="muted">{statusFa(a.pipeline_status)}</div>
                  </td>
                  <td style={{ maxWidth: 240 }}>{(a.prepared_message || a.preview || "").slice(0, 90)}</td>
                  <td className="row">
                    <button className="btn secondary" onClick={() => openPreview(a.id)}>Preview</button>
                    <button className="btn" onClick={() => askSend([a.id])}>Send</button>
                    <button className="btn secondary" onClick={async () => setHistory({ admin: a, items: (await api.outreachHistory(a.id)).history })}>History</button>
                    <select
                      className="input"
                      style={{ maxWidth: 140 }}
                      value={a.advertising_permission}
                      onChange={(e) => api.outreachPermission({ groupId: a.group_id, adminId: a.id, status: e.target.value }).then(loadAll)}
                    >
                      {PERMISSIONS.map((p) => <option key={p} value={p}>{statusFa(p)}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "inbox" && (
        <div className="card" style={{ marginTop: 14 }}>
          <h3>Admin Inbox</h3>
          {!inbox.length && <p className="muted">هنوز پاسخی از مدیران ثبت نشده است.</p>}
          {inbox.map((c) => (
            <div key={c.chat_id} className="group-item" style={{ marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <b>🟢 Admin replied · {c.chat_name}</b>
                <div className="muted">{c.admin?.group_name}</div>
                <div>{c.lastMessage?.body}</div>
              </div>
              <Link className="btn" to="/inbox">Open Conversation</Link>
            </div>
          ))}
        </div>
      )}

      {tab === "template" && (
        <div className="card" style={{ marginTop: 14 }}>
          <label>نام مجموعه (office_name)</label>
          <input className="input" value={officeName} onChange={(e) => setOfficeName(e.target.value)} />
          <label style={{ marginTop: 10 }}>قالب — متغیرها: {`{{admin_name}} {{group_name}} {{city}} {{office_name}}`}</label>
          <textarea value={template} onChange={(e) => setTemplate(e.target.value)} />
          <button
            className="btn"
            style={{ marginTop: 10 }}
            onClick={() => api.saveOutreachTemplate({ template, officeName }).then(() => pushToast("قالب ذخیره شد"))}
          >
            ذخیره قالب
          </button>
        </div>
      )}

      {preview && (
        <div className="modal-back" onClick={() => setPreview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Message Preview</h3>
            <p>To: مدیر گروه {preview.admin.group_name}</p>
            {preview.alreadyContacted && <p className="badge warn">Already Contacted · {preview.lastContact}</p>}
            <textarea value={editText} onChange={(e) => setEditText(e.target.value)} />
            <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
              <button className="btn secondary" onClick={() => setPreview(null)}>بستن</button>
              <button className="btn secondary" onClick={approvePreview}>Edit</button>
              <button
                className="btn"
                onClick={async () => {
                  await api.outreachApprove({ adminIds: [preview.admin.id], messages: { [preview.admin.id]: editText } });
                  const id = preview.admin.id;
                  setPreview(null);
                  askSend([id]);
                }}
              >
                Approve
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmSend && (
        <div className="modal-back" onClick={() => setConfirmSend(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>You are about to contact {confirmSend.length} group administrators.</h3>
            <p>ارسال فقط پس از این تأیید انجام می‌شود و پیام خودکار انبوه نیست.</p>
            <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
              <button className="btn secondary" onClick={() => setConfirmSend(null)}>Cancel</button>
              <button className="btn secondary" onClick={() => doSend(true)}>ارسال حتی Already Contacted</button>
              <button className="btn" onClick={() => doSend(false)}>تأیید و ارسال</button>
            </div>
          </div>
        </div>
      )}

      {history && (
        <div className="modal-back" onClick={() => setHistory(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: "min(720px, 100%)" }}>
            <h3>Contact History · {history.admin.display_name || history.admin.group_name}</h3>
            <table className="table">
              <thead>
                <tr><th>Date</th><th>Group</th><th>Message</th><th>Status</th><th>Response</th><th>Notes</th></tr>
              </thead>
              <tbody>
                {(history.items || []).map((h) => (
                  <tr key={h.id}>
                    <td>{h.date}</td>
                    <td>{history.admin.group_name}</td>
                    <td>{(h.message || "").slice(0, 80)}</td>
                    <td>{statusFa(h.status)}</td>
                    <td>{h.response}</td>
                    <td>{h.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <label>یادداشت</label>
            <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="تبلیغات ملکی روز جمعه مجاز است." />
            <div className="row" style={{ marginTop: 10 }}>
              <button
                className="btn"
                onClick={() =>
                  api.outreachNotes({ adminId: history.admin.id, groupId: history.admin.group_id, body: noteDraft }).then(() => {
                    pushToast("یادداشت ذخیره شد");
                    setNoteDraft("");
                  })
                }
              >
                ذخیره یادداشت
              </button>
              <button className="btn secondary" onClick={() => setHistory(null)}>بستن</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
