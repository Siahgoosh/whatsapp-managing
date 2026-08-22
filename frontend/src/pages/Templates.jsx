import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../store.jsx";

export function TemplatesPage() {
  const { pushToast } = useApp();
  const [items, setItems] = useState([]);
  const [title, setTitle] = useState("فروش زمین");
  const [message, setMessage] = useState("");
  const [tags, setTags] = useState("زمین,فروش");
  const [file, setFile] = useState(null);

  async function load() {
    setItems((await api.templates()).templates || []);
  }
  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function save(e) {
    e.preventDefault();
    const fd = new FormData();
    fd.append("title", title);
    fd.append("message", message);
    fd.append("tags", tags);
    if (file) fd.append("file", file);
    try {
      await api.createTemplate(fd);
      setMessage("");
      setFile(null);
      load();
    } catch (err) {
      pushToast(err.message);
    }
  }

  return (
    <div>
      <div className="topbar"><div><h2>قالب پیام</h2><p className="muted">عنوان، متن، پیوست و برچسب</p></div></div>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <form className="card" onSubmit={save}>
          <label>عنوان</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          <label>پیام</label>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} />
          <label>برچسب‌ها</label>
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
          <label>پیوست</label>
          <input type="file" onChange={(e) => setFile(e.target.files[0])} />
          <button className="btn" style={{ marginTop: 12 }}>ذخیره قالب</button>
        </form>
        <div className="card">
          {items.map((t) => (
            <div key={t.id} className="group-item" style={{ marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <b>{t.title}</b>
                <div className="muted">{t.tags}</div>
              </div>
              <button className="btn danger" onClick={() => api.deleteTemplate(t.id).then(load)}>حذف</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AutoReplyPage() {
  const { pushToast } = useApp();
  const [rules, setRules] = useState([]);
  const [form, setForm] = useState({ keyword: "قیمت", response: "سلام، برای دریافت قیمت لطفاً نام فایل موردنظر را ارسال کنید.", matchType: "contains", caseInsensitive: true, enabled: true, applyTo: "private" });

  async function load() {
    setRules((await api.autoReplies()).rules || []);
  }
  useEffect(() => { load().catch(() => {}); }, []);

  return (
    <div>
      <div className="topbar"><div><h2>پاسخ خودکار</h2><p className="muted">قوانین کلیدواژه فقط برای پیام‌های خصوصی، مگر اینکه صریحاً گروه را انتخاب کنید.</p></div></div>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <form className="card" onSubmit={(e) => { e.preventDefault(); api.createRule(form).then(load).catch((err) => pushToast(err.message)); }}>
          <label>کلیدواژه</label>
          <input className="input" value={form.keyword} onChange={(e) => setForm({ ...form, keyword: e.target.value })} />
          <label>پاسخ</label>
          <textarea value={form.response} onChange={(e) => setForm({ ...form, response: e.target.value })} />
          <label>نوع تطبیق</label>
          <select className="input" value={form.matchType} onChange={(e) => setForm({ ...form, matchType: e.target.value })}>
            <option value="contains">شامل</option>
            <option value="exact">دقیق</option>
          </select>
          <label className="row"><input type="checkbox" checked={form.caseInsensitive} onChange={(e) => setForm({ ...form, caseInsensitive: e.target.checked })} /> بدون حساسیت به حروف</label>
          <label className="row"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> فعال</label>
          <button className="btn" style={{ marginTop: 12 }}>افزودن قانون</button>
        </form>
        <div className="card">
          {rules.map((r) => (
            <div key={r.id} className="group-item" style={{ marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <b>{r.keyword}</b>
                <div className="muted">{r.response}</div>
              </div>
              <button className="btn secondary" onClick={() => api.updateRule(r.id, { ...r, matchType: r.match_type, caseInsensitive: !r.case_insensitive, enabled: !r.enabled, applyTo: r.apply_to }).then(load)}>
                {r.enabled ? "غیرفعال" : "فعال"}
              </button>
              <button className="btn danger" onClick={() => api.deleteRule(r.id).then(load)}>حذف</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AiPage() {
  const [settings, setSettings] = useState(null);
  useEffect(() => { api.settings().then(setSettings); }, []);
  return (
    <div>
      <div className="topbar"><div><h2>دستیار هوش مصنوعی</h2><p className="muted">کلید API از فایل .env خوانده می‌شود. ارسال نامحدود خودکار وجود ندارد.</p></div></div>
      <div className="card">
        <p>وضعیت ماژول: {settings?.ai?.enabled ? "فعال" : "غیرفعال (AI_ENABLED و AI_API_KEY)"}</p>
        <p>حالت: {settings?.ai?.mode === "suggest" ? "فقط پیشنهاد" : "قوانین مشخص"}</p>
        <ul>
          <li>Suggest Only: پاسخ پیشنهادی در اینباکس، ارسال فقط با تأیید شما</li>
          <li>Auto Reply: فقط قوانین کلیدواژه‌ای که خودتان تعریف کرده‌اید</li>
        </ul>
      </div>
    </div>
  );
}
