import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setCsrf } from "../api.js";
import { useApp } from "../store.jsx";

export function Login() {
  const { setUser, pushToast } = useApp();
  const nav = useNavigate();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    setErr("");
    try {
      const data = await api.login(username, password);
      setCsrf(data.csrfToken);
      setUser(data.user);
      nav("/");
    } catch (e2) {
      setErr(e2.message);
      pushToast(e2.message);
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand" style={{ paddingRight: 0 }}>
          <div className="logo">ف</div>
          <div>
            <h1>ورود به پنل</h1>
            <p>مدیریت کمپین واتساپ برای گروه‌های مجاز</p>
          </div>
        </div>
        <label>نام کاربری</label>
        <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} />
        <div style={{ height: 12 }} />
        <label>رمز عبور</label>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {err && <p className="muted" style={{ color: "var(--danger)" }}>{err}</p>}
        <button className="btn" style={{ width: "100%", marginTop: 18 }} type="submit">
          ورود
        </button>
      </form>
    </div>
  );
}
