import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, makeT } from "../storeExport";
import { Avatar } from "../components/Avatar";
import { IconBack, IconSend, IconCheck, IconDoubleCheck } from "../components/Icons";
import { fmtTime } from "./Chats";
import { demoBotReply } from "../demo";
import { serverSendMsg } from "../api";

export function ChatView() {
  const st = useStore();
  const t = makeT(st.lang);
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const conv = useMemo(
    () => st.convs.find((c) => c.id === st.openConvId),
    [st.convs, st.openConvId]
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conv?.messages.length, conv?.typing]);

  useEffect(() => {
    if (conv && conv.unread > 0) st.markRead(conv.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv?.id]);

  if (!conv) return null;

  async function send() {
    const body = text.trim();
    if (!body) return;
    setText("");
    st.sendMsg(conv.id, body);
    if (st.mode === "server" && st.serverUrl && st.token) {
      try {
        await serverSendMsg(conv.id, body);
      } catch {
        st.showToast(t("failed"));
      }
    } else {
      demoBotReply(conv.id);
    }
  }

  let lastDay = "";

  return (
    <div className="phone-frame">
      <div className="topbar">
        <button className="icon-btn" onClick={() => st.go("chats")}>
          <IconBack />
        </button>
        <Avatar name={conv.peer.name} color={conv.peer.color} size={40} online />
        <div className="grow">
          <h1 style={{ fontSize: 15.5 }}>{conv.peer.name}</h1>
          <div className="sub" dir={st.lang === "fa" ? "rtl" : "ltr"}>
            {conv.typing ? (
              <span style={{ color: "var(--accent2)" }}>
                {st.lang === "fa" ? "در حال نوشتن…" : "typing…"}
              </span>
            ) : (
              t("online")
            )}
          </div>
        </div>
        <span className={`mode-chip ${st.mode === "server" ? "live" : ""}`}>
          {st.mode === "server" ? t("liveMode") : t("demoMode")}
        </span>
      </div>

      <div className="msgs">
        {conv.messages.length === 0 && (
          <div className="empty">{t("emptyChat")}</div>
        )}
        {conv.messages.map((m) => {
          const day = new Date(m.at).toDateString();
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <div key={m.id} className="fade-in">
              {showDay && (
                <div className="day-sep">
                  <span>{fmtDay(m.at, st.lang, t)}</span>
                </div>
              )}
              <div className={`bubble-row ${m.mine ? "mine" : "theirs"}`}>
                <div className="bubble">
                  {m.text}
                  <div className="meta">
                    {fmtTime(m.at, st.lang)}
                    {m.mine &&
                      (m.status === "read" ? (
                        <IconDoubleCheck size={12} />
                      ) : m.status === "sent" ? (
                        <IconCheck size={11} />
                      ) : (
                        <span style={{ opacity: 0.6 }}>·</span>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {conv.typing && (
          <div className="bubble-row theirs">
            <div className="bubble typing" style={{ padding: "12px 16px" }}>
              <i /><i /><i />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="composer">
        <textarea
          rows={1}
          placeholder={t("typeMsg")}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const el = e.target as HTMLTextAreaElement;
            el.style.height = "auto";
            el.style.height = Math.min(el.scrollHeight, 110) + "px";
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="send-btn" onClick={send} disabled={!text.trim()}>
          <IconSend size={20} />
        </button>
      </div>
    </div>
  );
}

function fmtDay(at: number, lang: string, t: ReturnType<typeof makeT>) {
  const d = new Date(at);
  const today = new Date().toDateString();
  const yest = new Date(Date.now() - 86400000).toDateString();
  if (d.toDateString() === today) return t("today");
  if (d.toDateString() === yest) return t("yesterday");
  return lang === "fa"
    ? new Intl.DateTimeFormat("fa-AF", { dateStyle: "medium" }).format(d)
    : new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(d);
}
