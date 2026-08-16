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

export function statusFa(s) {
  return STATUS_FA[s] || s;
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
    socket.on("whatsapp:status", setWa);
    socket.on("notification:new", (n) => {
      setNotifications((prev) => [n, ...prev]);
      pushToast(n.title);
    });
    return () => socket.close();
  }, [user]);

  function pushToast(text) {
    const id = Date.now();
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }

  const value = useMemo(
    () => ({ user, setUser, theme, setTheme, wa, setWa, pushToast, notifications, setNotifications, statusFa }),
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
