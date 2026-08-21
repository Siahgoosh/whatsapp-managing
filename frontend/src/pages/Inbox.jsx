import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../store.jsx";

export function InboxPage() {
  const { pushToast, wa } = useApp();
  const [convos, setConvos] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [suggestion, setSuggestion] = useState("");
  const [quicks, setQuicks] = useState([]);

  async function load() {
    const d = await api.inbox();
    setConvos(d.conversations || []);
  }

  useEffect(() => {
    load().catch(() => {});
    api.quickReplies().then((d) => setQuicks(d.items || [])).catch(() => {});
  }, [wa.account?.id]);

  async function open(c) {
    setActive(c);
    const d = await api.thread(c.chat_id);
    setMessages(d.messages || []);
    setSuggestion(d.messages?.slice().reverse().find((m) => m.ai_suggestion)?.ai_suggestion || "");
  }

  async function send(e) {
    e.preventDefault();
    if (!active || !text.trim()) return;
    try {
      await api.reply(active.chat_id, text.trim());
      setText("");
      await open(active);
      await load();
    } catch (err) {
      pushToast(err.message);
    }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>صندوق ورودی</h2>
          <p className="muted">پیام‌های دریافتی، پیشنهاد هوش مصنوعی و پاسخ سریع</p>
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "320px 1fr" }}>
        <div className="card chat-list">
          {convos.map((c) => (
            <button key={c.chat_id} className="group-item" style={{ width: "100%", marginBottom: 8 }} onClick={() => open(c)}>
              <div style={{ textAlign: "right", flex: 1 }}>
                <b>{c.chat_name}</b>
                <div className="muted">{c.lastMessage?.body?.slice(0, 60)}</div>
              </div>
              {c.unread > 0 && <span className="badge info">{c.unread}</span>}
            </button>
          ))}
        </div>
        <div className="card">
          {!active && <p className="muted">یک گفتگو را انتخاب کنید.</p>}
          {active && (
            <>
              <h3>{active.chat_name} <span className="badge">{active.chat_type === "group" ? "گروه" : "مخاطب"}</span></h3>
              <div style={{ minHeight: 280 }}>
                {messages.map((m) => (
                  <div key={m.id} className={`bubble ${m.direction === "out" ? "out" : "in"}`}>{m.body}</div>
                ))}
              </div>
              {suggestion && (
                <div className="card" style={{ background: "var(--surface-2)", marginBottom: 10 }}>
                  <div className="muted">پیشنهاد هوش مصنوعی (فقط با تأیید شما ارسال می‌شود)</div>
                  <p>{suggestion}</p>
                  <button className="btn secondary" onClick={() => setText(suggestion)}>استفاده از پیشنهاد</button>
                </div>
              )}
              <div className="row" style={{ marginBottom: 8 }}>
                {quicks.map((q) => (
                  <button key={q.id} className="btn secondary" type="button" onClick={() => setText(q.message)}>
                    {q.shortcut}
                  </button>
                ))}
                <button className="btn ghost" type="button" onClick={() => api.suggest(active.chat_id, active.chat_name).then((d) => setSuggestion(d.suggestion || "پیشنهادی در دسترس نیست"))}>
                  پیشنهاد AI
                </button>
              </div>
              <form className="row" onSubmit={send}>
                <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="پاسخ..." />
                <button className="btn">ارسال</button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
