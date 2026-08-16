import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { statusFa, useApp } from "../store.jsx";
import { io } from "socket.io-client";

function formatDuration(ms) {
  if (!ms) return "۰ دقیقه";
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  return h ? `${h} ساعت و ${m % 60} دقیقه` : `${m} دقیقه`;
}

export function WhatsAppPage() {
  const { wa, setWa, pushToast } = useApp();
  const [qr, setQr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("برای ساخت QR روی «شروع اتصال» بزنید.");

  function applyStatus(s) {
    if (!s) return;
    setWa(s);
    if (s.qr) setQr(s.qr);
    if (s.status === "connected") setQr(null);
  }

  async function refresh() {
    const s = await api.waStatus();
    applyStatus(s);
    if (!s.qr) {
      const d = await api.waQr();
      if (d.qr) setQr(d.qr);
    }
    return s;
  }

  useEffect(() => {
    refresh().catch(() => {});
    const socket = io({ withCredentials: true });
    socket.on("whatsapp:status", (s) => applyStatus(s));
    socket.on("whatsapp:qr", () => refresh().catch(() => {}));
    const timer = setInterval(() => {
      refresh().catch(() => {});
    }, 2000);
    return () => {
      socket.close();
      clearInterval(timer);
    };
  }, []);

  async function connect() {
    setBusy(true);
    setHint("در حال ساخت نشست و دریافت QR...");
    try {
      const s = await api.waConnect();
      applyStatus(s);
      if (s.qr) {
        setHint("QR را با واتساپ موبایل اسکن کنید.");
      } else if (s.status === "connected") {
        setHint("قبلاً متصل است.");
      } else {
        setHint("QR هنوز نیامده. چند ثانیه صبر کنید یا دوباره شروع اتصال را بزنید. اگر نآمد، اینترنت سرور به واتساپ را بررسی کنید.");
      }
    } catch (e) {
      pushToast(e.message);
      setHint(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (!confirm("خروج از واتساپ باعث توقف کمپین‌های فعال می‌شود.")) return;
    setBusy(true);
    try {
      applyStatus(await api.waLogout());
      setQr(null);
      setHint("از حساب خارج شد.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>اتصال واتساپ</h2>
          <p className="muted">با اسکن QR، نشست پایدار ساخته می‌شود و پس از راه‌اندازی مجدد نیاز به اسکن دوباره نیست.</p>
        </div>
        <div className="row">
          <button className="btn" disabled={busy} onClick={connect}>
            {busy ? "در حال اتصال..." : "شروع اتصال"}
          </button>
          <button className="btn danger" disabled={busy} onClick={logout}>
            خروج از حساب
          </button>
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="card">
          <div className={`badge ${wa.status === "connected" ? "ok" : "warn"}`}>{statusFa(wa.status)}</div>
          <p>شماره متصل‌شده: <b>{wa.phone || "—"}</b></p>
          <p>نام اکانت: <b>{wa.accountName || "—"}</b></p>
          <p>آخرین اتصال: <b>{wa.lastConnectedAt || "—"}</b></p>
          <p>مدت نشست: <b>{formatDuration(wa.sessionDurationMs)}</b></p>
          {wa.lastError && <p className="muted">خطا: {wa.lastError}</p>}
        </div>
        <div className="card" style={{ textAlign: "center" }}>
          {qr ? (
            <>
              <img src={qr} alt="QR" style={{ width: 240, height: 240, background: "white", borderRadius: 16 }} />
              <p className="muted">QR را با گوشی اسکن کنید</p>
            </>
          ) : (
            <p className="muted">{hint}</p>
          )}
        </div>
      </div>
    </div>
  );
}
