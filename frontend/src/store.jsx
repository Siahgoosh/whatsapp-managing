import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { api, setCsrf } from "./api.js";

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const STATUS_FA = {
  disconnected: "قطع",
  connecting: "در حال اتصال",
  qr_required: "نیاز به QR",
  connected: "متصل",
  reconnecting: "اتصال مجدد",
  authentication_failed: "خطای احراز هویت",
  draft: "پیش‌نویس",
  scheduled: "زمان‌بندی‌شده",
  queued: "صف",
  sending: "در حال ارسال",
  paused: "توقف موقت",
  stopped: "متوقف",
  completed: "تمام‌شده",
  sent: "ارسال‌شده",
  failed: "ناموفق",
  skipped: "ردشده",
  valid: "معتبر",
  invalid: "نامعتبر",
  unavailable: "غیرقابل دسترس",
  unknown: "نامشخص",
  joined: "عضو",
  not_joined: "عضو نیست",
  already_joined: "قبلاً عضو",
  new: "جدید",
  prepared: "پیام آماده",
  pending_approval: "در انتظار تأیید",
  discovered: "کشف‌شده",
  contact_pending: "در انتظار تماس",
  message_approved: "پیام تأییدشده",
  contacted: "تماس‌گرفته",
  replied: "پاسخ‌داده",
  permission_granted: "اجازه ثبت شد",
  marketing_group: "گروه بازاریابی",
  declined: "ردشده",
  requested: "درخواست‌شده",
  approved: "مجاز",
  blocked: "مسدود",
  already_discovered: "قبلاً کشف‌شده"
};

export function statusFa(s) {
  return STATUS_FA[s] || s;
}

export function accountLabel(account) {
  if (!account) return "بدون اکانت";
  const name = account.label || account.accountName || "اکانت واتساپ";
  return account.phone ? `${name} · ${account.phone}` : name;
}

export function AppProvider({ children }) {
  const [user, setUser] = useState(undefined);
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "dark");
  const [wa, setWa] = useState({ status: "disconnected" });
  const [toasts, setToasts] = useState([]);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    api.me()
      .then((d) => {
        setUser(d.user);
        setCsrf(d.csrfToken);
      })
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!user) return;
    api.waStatus().then(setWa).catch(() => {});
    api.notifications().then((d) => setNotifications(d.notifications || [])).catch(() => {});
    const socket = io({ withCredentials: true });
    socket.on("whatsapp:status", (s) => {
      setWa((prev) => {
        const key = prev.sessionKey || prev.account?.sessionKey;
        if (s.sessionKey && key && s.sessionKey !== key) {
          const accounts = (prev.accounts || []).map((a) =>
            a.sessionKey === s.sessionKey
              ? { ...a, status: s.status, phone: s.phone, accountName: s.accountName }
              : a
          );
          return { ...prev, accounts };
        }
        return { ...prev, ...s };
      });
    });
    socket.on("notification:new", (n) => {
      setNotifications((prev) => [n, ...prev]);
      pushToast(n.title);
    });
    return () => socket.close();
  }, [user]);

  async function switchAccount(sessionId) {
    const s = await api.waSetActive(sessionId);
    setWa(s);
    return s;
  }

  function pushToast(text) {
    const id = Date.now();
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }

  const value = useMemo(
    () => ({ user, setUser, theme, setTheme, wa, setWa, switchAccount, pushToast, notifications, setNotifications, statusFa }),
    [user, theme, wa, notifications]
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {toasts.map((t) => (
        <div className="toast" key={t.id}>
          {t.text}
        </div>
      ))}
    </Ctx.Provider>
  );
}
