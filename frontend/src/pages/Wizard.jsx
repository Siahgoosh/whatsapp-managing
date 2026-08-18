import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { activityAgo } from "../format.js";
import { useApp } from "../store.jsx";

const STEPS = [
  "نام کمپین",
  "پیام",
  "پیوست",
  "انتخاب گروه",
  "تأخیر و زمان‌بندی",
  "پیش‌نمایش",
  "تأیید",
  "ارسال"
];

export function WizardPage() {
  const { pushToast } = useApp();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("تبلیغ فایل‌های جدید املاک فرتاک");
  const [message, setMessage] = useState("🏠 فایل جدید فروش\n\nزمین ۲۰۰ متری\n📍 لامرد\n💰 قیمت: ...\n\nبرای اطلاعات بیشتر پیام دهید.");
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [groups, setGroups] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [q, setQ] = useState("");
  const [delayMin, setDelayMin] = useState(5);
  const [delayMax, setDelayMax] = useState(7);
  const [random, setRandom] = useState(true);
  const [schedule, setSchedule] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [limits, setLimits] = useState({ minDelaySeconds: 3, maxDelaySeconds: 30 });

  const [loadError, setLoadError] = useState("");

  async function loadGroups() {
    setLoadError("");
    try {
      const d = await api.groups();
      const list = Array.isArray(d.groups) ? d.groups : [];
      setGroups(list);
      setSelected((prev) => {
        if (prev.size) return prev;
        return new Set(list.filter((g) => g.advertising_permission === "approved").map((g) => g.id));
      });
      return list;
    } catch (e) {
      setLoadError(e.message || "بارگذاری گروه‌ها ناموفق بود");
      pushToast(e.message || "بارگذاری گروه‌ها ناموفق بود");
      return [];
    }
  }

  useEffect(() => {
    loadGroups();
    api.settings().then((d) => setLimits(d.limits || limits)).catch(() => {});
  }, []);

  useEffect(() => {
    if (step === 3) loadGroups();
  }, [step]);

  const visible = groups.filter((g) => String(g.name || "").includes(q));
  const est = useMemo(() => {
    const n = selected.size;
    const avg = random ? (Number(delayMin) + Number(delayMax)) / 2 : Number(delayMin);
    return Math.max(0, Math.round((n - 1) * avg));
  }, [selected, delayMin, delayMax, random]);

  function onFile(f) {
    if (!f) return;
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  }

  async function createAndMaybeStart(startNow) {
    const fd = new FormData();
    fd.append("name", name);
    fd.append("message", message);
    fd.append("caption", caption);
    fd.append("groupIds", JSON.stringify([...selected]));
    fd.append("delayMin", String(delayMin));
    fd.append("delayMax", String(delayMax));
    fd.append("randomDelay", String(random));
    if (schedule) fd.append("scheduledAt", schedule.replace("T", " ") + ":00");
    if (file) fd.append("file", file);
    try {
      const created = await api.createCampaign(fd);
      if (startNow && !schedule) {
        await api.startCampaign(created.campaign.id);
      }
      nav(`/campaigns/${created.campaign.id}`);
    } catch (e) {
      pushToast(e.message);
    }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>ساخت کمپین</h2>
          <p className="muted">فقط برای گروه‌هایی که عضو هستید و اجازه ارسال دارید.</p>
        </div>
      </div>
      <div className="wizard">
        {STEPS.map((s, i) => (
          <div key={s} className={`step ${i === step ? "current" : i < step ? "done" : ""}`}>{i + 1}. {s}</div>
        ))}
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        {step === 0 && (
          <>
            <label>نام کمپین</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </>
        )}
        {step === 1 && (
          <>
            <label>پیام (متن، ایموجی، خط جدید، *پررنگ* و لینک)</label>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} />
          </>
        )}
        {step === 2 && (
          <>
            <div
              className="drop"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                onFile(e.dataTransfer.files[0]);
              }}
            >
              فایل را رها کنید یا انتخاب کنید (JPG, PNG, WEBP, MP4, PDF)
              <div style={{ marginTop: 10 }}>
                <input type="file" accept=".jpg,.jpeg,.png,.webp,.mp4,.pdf,.gif" onChange={(e) => onFile(e.target.files[0])} />
              </div>
            </div>
            {file && (
              <div style={{ marginTop: 12 }}>
                <div className="row">
                  <b>{file.name}</b>
                  <button className="btn danger" onClick={() => { setFile(null); setPreviewUrl(""); }}>حذف</button>
                </div>
                {previewUrl && file.type.startsWith("image/") && <img src={previewUrl} alt="" style={{ maxWidth: 240, marginTop: 8, borderRadius: 12 }} />}
                {previewUrl && file.type.startsWith("video/") && <video src={previewUrl} controls style={{ maxWidth: 320, marginTop: 8 }} />}
                <label style={{ marginTop: 10 }}>کپشن</label>
                <textarea value={caption} onChange={(e) => setCaption(e.target.value)} />
              </div>
            )}
          </>
        )}
        {step === 3 && (
          <>
            <div className="row">
              <input className="input" style={{ maxWidth: 240 }} placeholder="جستجو" value={q} onChange={(e) => setQ(e.target.value)} />
              <button className="btn secondary" onClick={() => setSelected(new Set(visible.map((g) => g.id)))}>انتخاب همه</button>
              <button className="btn secondary" onClick={() => setSelected(new Set())}>هیچکدام</button>
              <span className="badge">Selected Groups: {selected.size}</span>
            </div>
            <p className="muted">گروه‌ها بر اساس آخرین پیام مرتب شده‌اند؛ گروه‌های خیلی قدیمی پایین لیست هستند.</p>
            <div style={{ marginTop: 12, maxHeight: 420, overflow: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
              {visible.map((g) => (
                <label key={g.id} className="group-item">
                  <input type="checkbox" checked={selected.has(g.id)} onChange={() => {
                    const n = new Set(selected);
                    n.has(g.id) ? n.delete(g.id) : n.add(g.id);
                    setSelected(n);
                  }} />
                  <span style={{ flex: 1 }}>
                    {g.name || "بدون نام"}
                    <div className="muted" style={{ fontSize: 12 }}>آخرین پیام: {activityAgo(g.last_activity_at)}</div>
                  </span>
                  {g.advertising_permission === "approved" ? (
                    <span className="badge ok">🟢 Permission Granted</span>
                  ) : (
                    <span className="badge">{g.advertising_permission === "unknown" ? "اجازه نامشخص" : g.advertising_permission}</span>
                  )}
                </label>
              ))}
              {!visible.length && (
                <div className="card" style={{ textAlign: "center" }}>
                  <p>{loadError || (groups.length ? "با این جستجو گروهی پیدا نشد." : "گروهی در فهرست عضویت نیست.")}</p>
                  <div className="row" style={{ justifyContent: "center" }}>
                    <button
                      className="btn"
                      onClick={async () => {
                        try {
                          await api.syncGroups();
                        } catch (e) {
                          pushToast(e.message);
                        }
                        await loadGroups();
                      }}
                    >
                      همگام‌سازی گروه‌های واتساپ
                    </button>
                  </div>
                </div>
              )}
            </div>
            <p className="muted">به‌صورت پیش‌فرض فقط گروه‌های Joined با Advertising Permission = Approved انتخاب می‌شوند. اگر لیست خالی است، همگام‌سازی را بزنید.</p>
          </>
        )}
        {step === 4 && (
          <>
            <label>فاصله بین پیام‌ها (ثانیه) — حداقل {limits.minDelaySeconds} و حداکثر {limits.maxDelaySeconds}</label>
            <input className="input" type="number" min={limits.minDelaySeconds} max={limits.maxDelaySeconds} value={delayMin} onChange={(e) => setDelayMin(e.target.value)} />
            <label className="row" style={{ marginTop: 12 }}>
              <input type="checkbox" checked={random} onChange={(e) => setRandom(e.target.checked)} />
              تأخیر تصادفی برای جلوگیری از ارسال پشت‌سرهم (نه برای دور زدن محدودیت)
            </label>
            {random && (
              <>
                <label>حداکثر تأخیر</label>
                <input className="input" type="number" min={delayMin} max={limits.maxDelaySeconds} value={delayMax} onChange={(e) => setDelayMax(e.target.value)} />
              </>
            )}
            <label style={{ marginTop: 12 }}>زمان‌بندی اختیاری</label>
            <input className="input" type="datetime-local" value={schedule} onChange={(e) => setSchedule(e.target.value)} />
          </>
        )}
        {step === 5 && (
          <>
            <h3>پیش‌نمایش پیام</h3>
            <div className="preview">{message}</div>
            {previewUrl && file?.type.startsWith("image/") && <img src={previewUrl} alt="" style={{ maxWidth: 240, marginTop: 12, borderRadius: 12 }} />}
            <h3>خلاصه کمپین</h3>
            <p>تعداد گروه‌ها: {selected.size}</p>
            <p>تأخیر: {random ? `${delayMin} تا ${delayMax}` : delayMin} ثانیه</p>
            <p>مدت تخمینی: حدود {est} ثانیه</p>
            <p>پیوست: {file ? file.name : "ندارد"}</p>
          </>
        )}
        {step === 6 && (
          <>
            <p>قبل از شروع، تأیید کنید که برای ارسال در این گروه‌ها اجازه دارید.</p>
            <button className="btn" onClick={() => setConfirmOpen(true)}>نمایش تأیید نهایی</button>
          </>
        )}
        {step === 7 && (
          <p>کمپین ذخیره می‌شود و در صورت انتخاب «شروع» وارد صف می‌گردد.</p>
        )}
        <div className="row" style={{ marginTop: 18, justifyContent: "space-between" }}>
          <button className="btn secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>قبلی</button>
          {step < 7 ? (
            <button className="btn" onClick={() => setStep(step + 1)}>بعدی</button>
          ) : (
            <div className="row">
              <button className="btn secondary" onClick={() => createAndMaybeStart(false)}>ذخیره</button>
              <button className="btn" onClick={() => setConfirmOpen(true)}>شروع کمپین</button>
            </div>
          )}
        </div>
      </div>
      {confirmOpen && (
        <div className="modal-back" onClick={() => setConfirmOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Are you sure you want to start this campaign?</h3>
            <p>تعداد گروه‌ها: {selected.size}</p>
            <div className="preview">{message}</div>
            <p>پیوست: {file ? file.name : "—"}</p>
            <p>تأخیر: {delayMin}{random ? `–${delayMax}` : ""} ثانیه</p>
            <p>زمان‌بندی: {schedule || "فوری"}</p>
            <div className="row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
              <button className="btn secondary" onClick={() => setConfirmOpen(false)}>Cancel</button>
              <button className="btn" onClick={() => createAndMaybeStart(!schedule)}>Start Campaign</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
