import { useState } from "react";
import { useStore, makeT } from "../storeExport";
import { Avatar } from "../components/Avatar";
import { IconBack, IconUser } from "../components/Icons";

export function NewChat() {
  const st = useStore();
  const t = makeT(st.lang);
  const [q, setQ] = useState("");

  const list = st.contacts.filter(
    (c) => c.name.includes(q.trim()) || c.phone.includes(q.trim())
  );

  return (
    <div className="phone-frame">
      <div className="topbar">
        <button className="icon-btn" onClick={() => st.go("chats")}>
          <IconBack />
        </button>
        <div className="grow">
          <h1>{t("newChat")}</h1>
          <div className="sub">{t("newChatSub")}</div>
        </div>
      </div>

      <div className="searchbar">
        <IconUser size={18} />
        <input placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
        {list.length === 0 && <div className="empty">{t("noContact")}</div>}
        {list.map((c) => (
          <div key={c.id ?? c.phone} className="chat-row" onClick={() => st.createConv(c)}>
            <Avatar name={c.name} color={c.color} size={50} />
            <div className="mid">
              <div className="name">{c.name}</div>
              <div className="preview" dir="ltr">
                {c.phone}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
