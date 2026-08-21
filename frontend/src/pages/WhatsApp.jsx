import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { accountLabel, statusFa, useApp } from "../store.jsx";
import { io } from "socket.io-client";

function formatDuration(ms) {
  if (!ms) return "۰ دقیقه";
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  return h ? `${h} ساعت و ${m % 60} دقیقه` : `${m} دقیقه`;
}

export function WhatsAppPage() {
  const { user, wa, setWa, switchAccount, pushToast } = useApp();
  const [qr, setQr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("برای ساخت QR روی «شروع اتصال» بزنید.");
  const [newLabel, setNewLabel] = useState("");
  const accounts = wa.accounts || [];
  const activeId = wa.account?.id;

  function applyStatus(s) {
    if (!s) return;
    setWa(s);
    if (s.qr) setQr(s.qr);
    if (s.status === "connected") setQr(null);
  }

  async function refresh(sessionId) {
    const s = await api.waStatus(sessionId);
    applyStatus(s);
    if (!s.qr) {
      const d = await api.waQr(sessionId || s.account?.id);
      if (d.qr) setQr(d.qr);
    }
    return s;
  }

  useEffect(() => {
    refresh().catch(() => {});
    const socket = io({ withCredentials: true });
    socket.on("whatsapp:status", () => refresh().catch(() => {}));
    socket.on("whatsapp:qr", () => refresh().catch(() => {}));
    const timer = setInterval(() => {
      refresh().catch(() => {});
    }, 2000);
    return () => {
      socket.close();
      clearInterval(timer);
    };
  }, [activeId]);

  async function connect() {
    setBusy(true);
    setHint("در حال ساخت نشست و دریافت QR...");
    try {
      const s = await api.waConnect(activeId);
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
    if (!confirm("خروج از این اکانت واتساپ فقط کمپین‌های همین شماره را متوقف می‌کند.")) return;
    setBusy(true);
    try {
      applyStatus(await api.waLogout(activeId));
      setQr(null);
      setHint("از حساب خارج شد.");
    } finally {
      setBusy(false);
    }
  }

  async function addAccount() {
    const label = newLabel.trim();
    if (!label) return;
    setBusy(true);
    try {
      const created = await api.waCreateAccount(label);
      setNewLabel("");
      await switchAccount(created.account.id);
      pushToast("اکانت اضافه شد. QR را اسکن کنید.");
    } catch (e) {
      pushToast(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>اکانت‌های واتساپ</h2>
          <p className="muted">هر شماره واتساپ یک اکانت جداست و کمپین خودش را جلو می‌برد. روی یک شماره دو کمپین همزمان اجرا نمی‌شود.</p>
        </div>
        <div className="row">
          <button className="btn" disabled={busy} onClick={connect}>
            {busy ? "در حال اتصال..." : "شروع اتصال"}
          </button>
          <button className="btn danger" disabled={busy} onClick={logout}>
            خروج از این اکانت
          </button>
        </div>
      </div>
      {accounts.length > 0 && (
        <div className="account-grid">
          {accounts.map((a) => (
            <button
              key={a.id}
              className={`card account-card ${a.id === activeId ? "selected" : ""}`}
              onClick={() => switchAccount(a.id).then((s) => applyStatus(s)).catch((e) => pushToast(e.message))}
            >
              <div className={`badge ${a.status === "connected" ? "ok" : "warn"}`}>{statusFa(a.status)}</div>
              <b>{accountLabel(a)}</b>
              <p className="muted" style={{ margin: "6px 0 0" }}>{a.accountName || "هنوز لاگین نشده"}</p>
            </button>
          ))}
        </div>
      )}
      {user?.role === "admin" && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>افزودن اکانت جدید</h3>
          <p className="muted">برای اپراتور جدا یا شماره دوم، یک اکانت بسازید و QR همان شماره را اسکن کنید.</p>
          <div className="row">
            <input
              className="input"
              placeholder="مثلاً شماره فروش یا اپراتور ۱"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
            />
            <button className="btn" disabled={busy || !newLabel.trim()} onClick={addAccount}>
              افزودن اکانت
            </button>
          </div>
        </div>
      )}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 16 }}>
        <div className="card">
          <div className={`badge ${wa.status === "connected" ? "ok" : "warn"}`}>{statusFa(wa.status)}</div>
          <p>اکانت فعال: <b>{accountLabel(wa.account)}</b></p>
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
              <p className="muted">QR را با گوشی همان شماره اسکن کنید</p>
            </>
          ) : (
            <p className="muted">{hint}</p>
          )}
        </div>
      </div>
    </div>
  );
}
