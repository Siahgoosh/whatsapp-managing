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

  async function refreshQr() {
    const d = await api.waQr();
    setQr(d.qr);
  }

  useEffect(() => {
    refreshQr().catch(() => {});
    const socket = io({ withCredentials: true });
    socket.on("whatsapp:status", (s) => {
      setWa(s);
      if (s.status === "qr_required") refreshQr();
      if (s.status === "connected") setQr(null);
    });
    socket.on("whatsapp:qr", () => refreshQr());
    return () => socket.close();
  }, []);

  async function connect() {
    setBusy(true);
    try {
      const s = await api.waConnect();
      setWa(s);
      await refreshQr();
    } catch (e) {
      pushToast(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (!confirm("خروج از واتساپ باعث توقف کمپین‌های فعال می‌شود.")) return;
    setBusy(true);
    try {
      setWa(await api.waLogout());
      setQr(null);
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
            شروع اتصال
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
        </div>
        <div className="card" style={{ textAlign: "center" }}>
          {qr ? <img src={qr} alt="QR" style={{ width: 240, height: 240, background: "white", borderRadius: 16 }} /> : (
            <p className="muted">QR در وضعیت «نیاز به QR» اینجا نمایش داده می‌شود. اطلاعات نشست هرگز در تصویر یا لاگ ذخیرهٔ متنی نشان داده نمی‌شود.</p>
          )}
        </div>
      </div>
    </div>
  );
}
