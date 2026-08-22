import React, { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { copyText, downloadText } from "../copyText.js";
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
  const [onlyJoinable, setOnlyJoinable] = useState(false);
  const [review, setReview] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareTo, setShareTo] = useState("");
  const [sharePreview, setSharePreview] = useState("");
  const [shareCount, setShareCount] = useState(0);
  const [shareBusy, setShareBusy] = useState(false);

  async function load() {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (onlyJoinable) p.set("suggested", "1");
    const qs = p.toString() ? `?${p}` : "";
    const d = await api.discovery(qs);
    setRows(d.groups || []);
    setAnalytics(d.analytics || {});
  }

  useEffect(() => {
    load().catch((e) => pushToast(e.message));
    const socket = io({ withCredentials: true });
    socket.on("discovery:scan-progress", setProgress);
    return () => socket.close();
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [onlyJoinable]);

  const selectedRows = useMemo(() => rows.filter((r) => picked.has(r.id)), [rows, picked]);

  function toggle(id) {
    const n = new Set(picked);
    n.has(id) ? n.delete(id) : n.add(id);
    setPicked(n);
  }

  async function scanNow() {
    setScanning(true);
    setProgress({ current: 0, total: 0 });
    try {
      const r = await api.discoveryScan();
      pushToast(`اسکن شد: ${r.groupsScanned} گروه — لینک جدید ${r.newLinks} — قابل عضویت ${r.validJoinable}`);
      setOnlyJoinable(false);
      await load();
    } catch (e) {
      pushToast(e.message);
    } finally {
      setScanning(false);
      setProgress(null);
    }
  }

  async function openJoin(row) {
    try {
      const r = await api.discoveryOpen(row.id);
      setReview(r.group);
      window.open(r.openUrl || row.normalized_url, "_blank", "noopener,noreferrer");
    } catch (e) {
      pushToast(e.message);
    }
  }

  function openableFrom(list) {
    return list.filter((r) => r.openable !== false && r.validation_status !== "invalid");
  }

  function shareableIds() {
    const source = selectedRows.length ? selectedRows : rows;
    return openableFrom(source).map((r) => r.id);
  }

  async function fetchCopyText(ids) {
    if (Array.isArray(ids) && !ids.length) {
      throw new Error("ابتدا لینک‌ها را انتخاب کنید");
    }
    return api.discoveryCopy(ids);
  }

  async function copyLinks(ids) {
    try {
      const r = await fetchCopyText(ids);
      const ok = await copyText(r.text);
      if (ok) {
        pushToast(`${r.count} لینک کپی شد`);
        return;
      }
      downloadText(r.text, `whatsapp-group-links-${r.count}.txt`);
      pushToast(`${r.count} لینک در فایل متنی ذخیره شد (کلیپ‌بورد در این مرورگر در دسترس نبود)`);
    } catch (e) {
      pushToast(e.message);
    }
  }

  async function downloadLinks(ids) {
    try {
      const r = await fetchCopyText(ids);
      downloadText(r.text, `whatsapp-group-links-${r.count}.txt`);
      pushToast(`${r.count} لینک دانلود شد`);
    } catch (e) {
      pushToast(e.message);
    }
  }

  async function openShare() {
    const ids = shareableIds();
    try {
      const r = await fetchCopyText(ids);
      setShareCount(r.count);
      setSharePreview(r.text.length > 3500 ? `${r.text.slice(0, 3500)}\n\n…` : r.text);
      setShareOpen(true);
    } catch (e) {
      pushToast(e.message);
    }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>گروه‌های کشف‌شده</h2>
          <p className="muted">
            همهٔ گروه‌هایی که عضو هستید برای لینک عمومی قابل عضویت اسکن می‌شوند. با «عضو شو» لینک در واتساپ باز می‌شود و Join را خودتان تأیید می‌کنید. همان لینک‌ها را می‌توانید کپی کنید یا یکجا برای یک نفر بفرستید.
          </p>
          <p className="muted" style={{ fontSize: 12 }}>نسخه اسکن گروهی v2 — لینک‌های پیدا شده حتی اگر واتساپ صفحه را به ربات ندهد نشان داده می‌شوند</p>
        </div>
        <div className="row">
          <button className="btn" disabled={scanning} onClick={scanNow}>
            {scanning ? "در حال اسکن..." : "اسکن همه گروه‌ها همین الان"}
          </button>
          <button className="btn secondary" onClick={() => api.discoveryRefresh().then(load)}>بروزرسانی عضویت</button>
        </div>
      </div>

      {progress && (
        <div className="card" style={{ marginBottom: 14 }}>
          اسکن {progress.current || 0} از {progress.total || "…"}
          {progress.groupName ? ` — ${progress.groupName}` : ""}
        </div>
      )}

      <div className="grid stats">
        <div className="card stat">Links Found<b>{analytics.linksFound ?? 0}</b></div>
        <div className="card stat">قابل عضویت<b>{analytics.valid ?? 0}</b></div>
        <div className="card stat">New Groups<b>{analytics.newGroups ?? 0}</b></div>
        <div className="card stat">Already Joined<b>{analytics.alreadyJoined ?? 0}</b></div>
        <div className="card stat">Pending Review<b>{analytics.pendingReview ?? 0}</b></div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="row">
          <input className="input" style={{ maxWidth: 280 }} placeholder="جستجو" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn secondary" onClick={load}>جستجو</button>
          <label className="row">
            <input type="checkbox" checked={onlyJoinable} onChange={(e) => setOnlyJoinable(e.target.checked)} />
            فقط هنوز عضو نیستم (لینک منقضی‌شده مخفی شود)
          </label>
          <button className="btn secondary" onClick={() => setPicked(new Set(rows.map((r) => r.id)))}>انتخاب همه</button>
          <button className="btn secondary" onClick={() => setPicked(new Set())}>هیچکدام</button>
          <button className="btn secondary" onClick={() => copyLinks(openableFrom(selectedRows).map((r) => r.id))}>کپی انتخاب‌شده</button>
          <button className="btn secondary" onClick={() => copyLinks(openableFrom(rows).map((r) => r.id))}>کپی همه لینک‌ها</button>
          <button className="btn secondary" onClick={() => downloadLinks(openableFrom(selectedRows.length ? selectedRows : rows).map((r) => r.id))}>دانلود فایل متنی</button>
          <button className="btn" onClick={openShare}>ارسال یکجا در واتساپ</button>
          <span className="badge">{picked.size} انتخاب‌شده</span>
        </div>
        <table className="table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th></th>
              <th>Group Link</th>
              <th>Source Group</th>
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
                  <input type="checkbox" checked={picked.has(g.id)} onChange={() => toggle(g.id)} />
                </td>
                <td>
                  <b>{g.group_name || "Information unavailable"}</b>
                  <div className="muted" style={{ fontSize: 12 }}>{g.normalized_url}</div>
                  <div className="muted">Found By: {g.found_by} · {g.city}</div>
                </td>
                <td>{g.source_group_name || "—"}</td>
                <td>{g.found_at}</td>
                <td>
                  {g.validation_status === "valid" ? <span className="badge ok">🟢 Valid / قابل عضویت</span> : null}
                  {g.validation_status === "unavailable" || g.validation_status === "unknown" ? (
                    <span className="badge ok">🟢 قابل باز شدن در واتساپ</span>
                  ) : null}
                  {g.validation_status === "invalid" ? <span className="badge danger">🔴 Invalid</span> : null}
                  {g.validation_status !== "valid" &&
                  g.validation_status !== "invalid" &&
                  g.validation_status !== "unavailable" &&
                  g.validation_status !== "unknown" ? (
                    <span className="badge">{statusFa(g.validation_status)}</span>
                  ) : null}
                </td>
                <td>{JOIN_LABEL[g.join_status] || JOIN_LABEL.unknown}</td>
                <td className="row">
                  {g.validation_status !== "invalid" && g.join_status !== "joined" && (
                    <button className="btn" onClick={() => openJoin(g)}>عضو شو</button>
                  )}
                  <a className="btn secondary" href={g.normalized_url} target="_blank" rel="noreferrer">باز کردن لینک</a>
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
        {!rows.length && analytics.linksFound > 0 && (
          <div className="card" style={{ marginTop: 16, textAlign: "center" }}>
            <p>
              {analytics.linksFound} لینک پیدا شده ولی با فیلتر فعلی دیده نمی‌شود.
            </p>
            <button className="btn" onClick={() => setOnlyJoinable(false)}>نمایش همه لینک‌ها</button>
          </div>
        )}
        {!rows.length && !analytics.linksFound && (
          <div className="card" style={{ marginTop: 16, textAlign: "center" }}>
            <p>هنوز لینکی پیدا نشده. همهٔ گروه‌های عضو را همین الان اسکن کنید.</p>
            <button className="btn" disabled={scanning} onClick={scanNow}>
              {scanning ? "در حال اسکن..." : "اسکن همه گروه‌ها همین الان"}
            </button>
          </div>
        )}
      </div>

      {review && (
        <div className="modal-back" onClick={() => setReview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>عضو شدن</h3>
            <p><b>{review.group_name || "Information unavailable"}</b></p>
            <p className="muted">{review.description || "Information unavailable"}</p>
            <p>لینک در واتساپ باز شد. Join را خودتان تأیید کنید. سیستم خودکار عضو نمی‌شود.</p>
            <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
              <a className="btn" href={review.normalized_url} target="_blank" rel="noreferrer">باز کردن لینک</a>
              <button
                className="btn secondary"
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
                عضویت را تأیید کردم
              </button>
              <button className="btn secondary" onClick={() => setReview(null)}>بستن</button>
            </div>
          </div>
        </div>
      )}

      {shareOpen && (
        <div className="modal-back" onClick={() => setShareOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: "min(640px, 100%)" }}>
            <h3>ارسال یکجای لینک‌ها در واتساپ</h3>
            <p className="muted">
              {shareCount} لینک برای یک مخاطب فرستاده می‌شود. واتساپ بیشتر از حدود ۱۸۰ لینک در هر پیام را خوب قبول نمی‌کند؛ اگر تعداد زیاد باشد چند پیام پشت‌سرهم برای همان نفر می‌رود. ارسال انبوه به افراد مختلف نیست.
            </p>
            <label>شماره مخاطب (مثال 0912…)</label>
            <input className="input" value={shareTo} onChange={(e) => setShareTo(e.target.value)} placeholder="09121234567" />
            <label style={{ marginTop: 10 }}>پیش‌نمایش (شروع متن)</label>
            <textarea className="input" value={sharePreview} readOnly />
            <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
              <button className="btn secondary" onClick={() => setShareOpen(false)}>Cancel</button>
              <button
                className="btn"
                disabled={shareBusy}
                onClick={async () => {
                  const ids = shareableIds();
                  setShareBusy(true);
                  try {
                    const r = await api.discoveryShare({
                      ids,
                      to: shareTo,
                      confirm: true,
                      confirmCount: ids.length
                    });
                    pushToast(`${r.count} لینک در ${r.messages || 1} پیام برای همان مخاطب ارسال شد`);
                    setShareOpen(false);
                  } catch (e) {
                    pushToast(e.message);
                  } finally {
                    setShareBusy(false);
                  }
                }}
              >
                {shareBusy ? "در حال ارسال..." : "تأیید و ارسال"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
