import { useMemo, useState } from "react";
import { useStore, makeT, faDigits } from "../storeExport";
import { Avatar } from "../components/Avatar";
import { IconSearch, IconSettings, IconPlus, IconChat, IconCheck, IconDoubleCheck } from "../components/Icons";

export function Chats() {
  const st = useStore();
  const t = makeT(st.lang);
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const list = [...st.convs].sort((a, b) => lastAt(b) - lastAt(a));
    if (!q.trim()) return list;
    return list.filter((c) => c.peer.name.includes(q.trim()));
  }, [st.convs, q]);

  return (
    <div className="phone-frame">
      <div className="topbar">
        <Avatar name={st.user?.name ?? ""} color={st.user?.color ?? 0} size={38} />
        <div className="grow">
          <h1>
            <span className="wordmark">{t("appName")}</span>
          </h1>
          <div className="sub">
            {st.mode === "server" ? t("liveMode") : t("demoMode")}
          </div>
        </div>
        <button className="icon-btn" onClick={() => st.go("settings")}>
          <IconSettings />
        </button>
      </div>

      <div className="searchbar">
        <IconSearch size={19} />
        <input placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px calc(90px)" }}>
        {rows.length === 0 && (
          <div className="empty">
            <IconChat size={44} />
            <div style={{ whiteSpace: "pre-line" }}>{t("noChats")}</div>
          </div>
        )}
        {rows.map((c) => {
          const last = c.messages[c.messages.length - 1];
          return (
            <div key={c.id} className="chat-row" onClick={() => st.openConv(c.id)}>
              <Avatar name={c.peer.name} color={c.peer.color} size={52} online={c.peer.id === "d1"} />
              <div className="mid">
                <div className="name">{c.peer.name}</div>
                <div className="preview">
                  {c.typing ? (
                    <span style={{ color: "var(--accent2)" }}>{isFa(st) ? "در حال نوشتن…" : "typing…"}</span>
                  ) : last ? (
                    <>
                      {last.mine &&
                      (last.status === "read" ? (
                        <IconDoubleCheck size={13} />
                      ) : (
                        <IconCheck size={12} />
                      ))}{" "}
                      {last.text}
                    </>
                  ) : (
                    "—"
                  )}
                </div>
              </div>
              <div className="side">
                <span className="time">{last ? fmtTime(last.at, st.lang) : ""}</span>
                {c.unread > 0 && <span className="badge">{faDigits(String(c.unread))}</span>}
              </div>
            </div>
          );
        })}
      </div>

      <button className="fab" onClick={() => st.go("newchat")}>
        <IconPlus size={26} />
      </button>
    </div>
  );
}

function isFa(st: { lang: string }) {
  return st.lang === "fa";
}

function lastAt(c: { messages: { at: number }[] }) {
  return c.messages.length ? c.messages[c.messages.length - 1].at : 0;
}

export function fmtTime(at: number, lang: string) {
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const s = `${hh}:${mm}`;
  return lang === "fa" ? faDigits(s) : s;
}
