import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import { api } from "../api.js";
import { statusFa, useApp } from "../store.jsx";

const JOIN_LABEL = {
  joined: "🟢 Already Joined",
  not_joined: "🔵 Not Joined",
  unknown: "⚪ Unknown"
};

export function PublicGroupFinder() {
  const { pushToast } = useApp();
  const nav = useNavigate();
  const [meta, setMeta] = useState({ cities: [], categories: [], providers: [], configured: false, scheduleHours: 0 });
  const [selectedCities, setSelectedCities] = useState([]);
  const [groups, setGroups] = useState([]);
  const [scans, setScans] = useState([]);
  const [progress, setProgress] = useState(null);
  const [q, setQ] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sort, setSort] = useState("id");
  const [picked, setPicked] = useState(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ groupName: "", city: "لامرد", url: "", category: "سایر", notes: "" });
  const [csv, setCsv] = useState("");
  const [joinQueue, setJoinQueue] = useState([]);
  const [joinIdx, setJoinIdx] = useState(-1);

  async function load() {
    const [m, g, s] = await Promise.all([api.finderMeta(), api.finderGroups(queryString()), api.finderScans()]);
    setMeta(m);
    if (!selectedCities.length && m.cities?.length) setSelectedCities(m.cities.map((c) => c.id));
    setGroups(g.groups || []);
    setScans(s.scans || []);
  }

  function queryString() {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (cityFilter) p.set("city", cityFilter);
    if (statusFilter) p.set("status", statusFilter);
    if (sort) p.set("sort", sort);
    const s = p.toString();
    return s ? `?${s}` : "";
  }

  useEffect(() => {
    load().catch((e) => pushToast(e.message));
    const socket = io({ withCredentials: true });
    socket.on("finder:progress", (p) => setProgress(p));
    return () => socket.close();
  }, []);

  useEffect(() => {
    api.finderGroups(queryString()).then((d) => setGroups(d.groups || [])).catch(() => {});
  }, [q, cityFilter, statusFilter, sort]);

  const visible = groups;
  const allIds = useMemo(() => visible.map((g) => g.id), [visible]);

  function toggleCity(id) {
    setSelectedCities((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function startScan() {
    try {
      await api.finderScan(selectedCities);
      pushToast("اسکن شروع شد");
    } catch (e) {
      pushToast(e.message);
    }
  }

  async function saveManual(e) {
    e.preventDefault();
    try {
      await api.finderAdd(form);
      setAddOpen(false);
      load();
    } catch (err) {
      pushToast(err.message);
    }
  }

  async function importCsv() {
    try {
      const r = await api.finderImport(csv);
      pushToast(`وارد شد: ${r.imported} — تکراری ${r.duplicates} — نامعتبر ${r.invalid}`);
      load();
    } catch (e) {
      pushToast(e.message);
    }
  }

  function startJoinAssistant() {
    const items = visible.filter((g) => picked.has(g.id));
    if (!items.length) return pushToast("گروهی انتخاب نشده");
    setJoinQueue(items);
    setJoinIdx(0);
  }

  function confirmJoin() {
    const g = joinQueue[joinIdx];
    if (g) window.open(g.normalized_url, "_blank", "noopener,noreferrer");
    if (joinIdx + 1 >= joinQueue.length) {
      setJoinIdx(-1);
      setJoinQueue([]);
    } else setJoinIdx(joinIdx + 1);
  }

  async function toCampaign() {
    try {
      const r = await api.finderToCampaign({
        ids: [...picked],
        name: "کمپین از گروه‌های عمومی"
      });
      pushToast(`${r.matched} گروه عضو به کمپین اضافه شد`);
      nav(`/campaigns/${r.campaign.id}`);
    } catch (e) {
      pushToast(e.message);
    }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>جستجوی گروه عمومی</h2>
          <p className="muted">فقط لینک‌های chat.whatsapp.com که به‌صورت عمومی در وب منتشر شده‌اند. Join خودکار انجام نمی‌شود.</p>
        </div>
        <div className="row">
          <button className="btn secondary" onClick={() => setAddOpen(true)}>+ Add Group</button>
          <button className="btn" onClick={startScan}>Start Scan</button>
        </div>
      </div>

      {!meta.configured && (
        <div className="card" style={{ marginBottom: 16, borderColor: "var(--warning)" }}>
          Search API تنظیم نشده است. برای اسکن وب، در `.env` مقدار `GOOGLE_CSE_API_KEY` و `GOOGLE_CSE_CX` یا `BING_SEARCH_API_KEY` را بگذارید. افزودن دستی و CSV بدون API کار می‌کند.
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>شهرهای هدف</h3>
        <div className="row">
          {(meta.cities || []).map((c) => (
            <label key={c.id} className="row">
              <input type="checkbox" checked={selectedCities.includes(c.id)} onChange={() => toggleCity(c.id)} />
              {c.fa}
            </label>
          ))}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn secondary" onClick={() => setSelectedCities((meta.cities || []).map((c) => c.id))}>Select All</button>
          <button className="btn secondary" onClick={() => setSelectedCities([])}>Clear All</button>
          {progress && !progress.done && (
            <span className="badge info">
              Searching {progress.cityIndex} / {progress.cityTotal} — {progress.city} — Queries: {progress.queries} Results: {progress.results} WhatsApp Links: {progress.whatsappLinks} New: {progress.newGroups}
            </span>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row">
          <input className="input" style={{ maxWidth: 220 }} placeholder="جستجو" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" style={{ maxWidth: 160 }} value={cityFilter} onChange={(e) => setCityFilter(e.target.value)}>
            <option value="">همه شهرها</option>
            {(meta.cities || []).map((c) => (
              <option key={c.id} value={c.fa}>{c.fa}</option>
            ))}
          </select>
          <select className="input" style={{ maxWidth: 160 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">همه وضعیت‌ها</option>
            <option value="valid">Valid</option>
            <option value="invalid">Invalid</option>
            <option value="unavailable">Unavailable</option>
          </select>
          <select className="input" style={{ maxWidth: 140 }} value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="id">جدیدترین</option>
            <option value="name">نام</option>
            <option value="city">شهر</option>
            <option value="status">وضعیت</option>
          </select>
          <button className="btn secondary" onClick={() => setPicked(new Set(allIds))}>Select All</button>
          <button className="btn secondary" onClick={() => setPicked(new Set())}>Select None</button>
          <span className="badge">Selected: {picked.size} Groups</span>
          <button className="btn secondary" onClick={startJoinAssistant}>Start Join Assistant</button>
          <button className="btn" onClick={toCampaign}>Add Selected To Campaign</button>
        </div>
        <table className="table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Select</th>
              <th>Group</th>
              <th>City</th>
              <th>Source</th>
              <th>Status</th>
              <th>عضویت</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((g) => (
              <tr key={g.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={picked.has(g.id)}
                    onChange={() => {
                      const n = new Set(picked);
                      n.has(g.id) ? n.delete(g.id) : n.add(g.id);
                      setPicked(n);
                    }}
                  />
                </td>
                <td>
                  <b>{g.group_name || "Information unavailable"}</b>
                  <div className="muted">{g.description || "Information unavailable"}</div>
                </td>
                <td>{g.city}</td>
                <td>{g.source_type === "search_engine" ? "Search Engine" : g.source_type === "website" ? "Website" : g.source_type === "user_added" ? "User Added" : g.source_type}</td>
                <td><span className="badge">{statusFa(g.status)}</span></td>
                <td>{JOIN_LABEL[g.joined_status] || JOIN_LABEL.unknown}</td>
                <td className="row">
                  <a className="btn secondary" href={g.normalized_url} target="_blank" rel="noreferrer">Open WhatsApp</a>
                  <select
                    className="input"
                    style={{ maxWidth: 150 }}
                    value={g.category}
                    onChange={(e) => api.finderPatch(g.id, { category: e.target.value }).then(load)}
                  >
                    {(meta.categories || []).map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="card">
          <h3>ورود CSV / دستی</h3>
          <textarea value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={"city,group_name,url\nLamerd,گروه املاک,https://chat.whatsapp.com/..."} />
          <button className="btn secondary" style={{ marginTop: 8 }} onClick={importCsv}>Import CSV</button>
        </div>
        <div className="card">
          <h3>Scan History</h3>
          <table className="table">
            <thead>
              <tr><th>Date</th><th>Cities</th><th>Queries</th><th>Results</th><th>New</th><th>Dup</th><th>Invalid</th></tr>
            </thead>
            <tbody>
              {scans.map((s) => (
                <tr key={s.id}>
                  <td>{s.started_at}</td>
                  <td>{s.cities}</td>
                  <td>{s.queries_count}</td>
                  <td>{s.results_count}</td>
                  <td>{s.new_links}</td>
                  <td>{s.duplicates}</td>
                  <td>{s.invalid_links}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <label style={{ marginTop: 12 }}>اسکن زمان‌بندی‌شده</label>
          <select
            className="input"
            value={meta.scheduleHours}
            onChange={(e) => api.finderSchedule(Number(e.target.value)).then(() => load())}
          >
            <option value={0}>خاموش</option>
            <option value={24}>Every 24 Hours</option>
            <option value={48}>Every 48 Hours</option>
          </select>
        </div>
      </div>

      {addOpen && (
        <div className="modal-back" onClick={() => setAddOpen(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={saveManual}>
            <h3>Add Group</h3>
            <label>Group Name</label>
            <input className="input" value={form.groupName} onChange={(e) => setForm({ ...form, groupName: e.target.value })} />
            <label>City</label>
            <select className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })}>
              {(meta.cities || []).map((c) => <option key={c.id} value={c.fa}>{c.fa}</option>)}
            </select>
            <label>WhatsApp URL</label>
            <input className="input" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
            <label>Category</label>
            <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {(meta.categories || []).map((c) => <option key={c}>{c}</option>)}
            </select>
            <label>Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
              <button type="button" className="btn secondary" onClick={() => setAddOpen(false)}>Cancel</button>
              <button className="btn">Save</button>
            </div>
          </form>
        </div>
      )}

      {joinIdx >= 0 && joinQueue[joinIdx] && (
        <div className="modal-back">
          <div className="modal">
            <h3>Join Assistant</h3>
            <p>{joinIdx + 1} / {joinQueue.length}</p>
            <p>{joinQueue[joinIdx].group_name}</p>
            <p className="muted">سیستم Join نمی‌کند. لینک در مرورگر باز می‌شود و خودتان باید Join را تأیید کنید.</p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn secondary" onClick={() => { setJoinIdx(-1); setJoinQueue([]); }}>Stop</button>
              <button className="btn" onClick={confirmJoin}>Open WhatsApp & Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
