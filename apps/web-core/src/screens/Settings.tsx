import { useState } from "react";
import { useStore, makeT, persistSettings, type Lang } from "../storeExport";
import { Avatar } from "../components/Avatar";
import {
  IconBack,
  IconGlobe,
  IconMoon,
  IconSun,
  IconServer,
  IconInfo,
  IconLogout,
  IconUser,
} from "../components/Icons";
import { connectServer, disconnectServer } from "../api";
import { seedDemo } from "../demo";

export function Settings() {
  const st = useStore();
  const t = makeT(st.lang);
  const [serverUrl, setServerUrl] = useState(st.serverUrl);
  const [busy, setBusy] = useState(false);

  function applyAppearance() {
    persistSettings({ lang: st.lang, theme: st.theme, serverUrl: st.serverUrl });
  }

  async function saveServer() {
    setBusy(true);
    useStore.setState({ serverUrl: serverUrl.trim() });
    persistSettings({ lang: st.lang, theme: st.theme, serverUrl: serverUrl.trim() });
    if (serverUrl.trim()) {
      const ok = await connectServer();
      if (ok) st.showToast(t("connected"));
      else st.showToast(t("failed"));
    } else {
      disconnectServer();
    }
    setBusy(false);
  }

  function cutServer() {
    disconnectServer();
    setServerUrl("");
    useStore.setState({ serverUrl: "" });
    persistSettings({ lang: st.lang, theme: st.theme, serverUrl: "" });
  }

  return (
    <div className="phone-frame">
      <div className="topbar">
        <button className="icon-btn" onClick={() => st.go("chats")}>
          <IconBack />
        </button>
        <div className="grow">
          <h1>{t("settings")}</h1>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {/* profile */}
        <div className="set-section">
          <h3>{t("profile")}</h3>
          <div className="card">
            <div className="set-row">
              <Avatar name={st.user?.name ?? ""} color={st.user?.color ?? 0} size={54} />
              <div className="grow">
                <div style={{ fontWeight: 800, fontSize: 15.5 }}>{st.user?.name}</div>
                <div dir="ltr" style={{ color: "var(--muted)", fontSize: 12.5, textAlign: "end" }}>
                  {st.user?.phone}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* appearance */}
        <div className="set-section">
          <h3>{t("appearance")}</h3>
          <div className="card">
            <div className="set-row">
              <IconGlobe />
              <div className="grow">{t("language")}</div>
              <div className="seg">
                <button
                  className={st.lang === "fa" ? "on" : ""}
                  onClick={() => {
                    useStore.setState({ lang: "fa" as Lang });
                    applyAppearance();
                  }}
                >
                  فارسی
                </button>
                <button
                  className={st.lang === "en" ? "on" : ""}
                  onClick={() => {
                    useStore.setState({ lang: "en" as Lang });
                    applyAppearance();
                  }}
                >
                  English
                </button>
              </div>
            </div>
            <div className="set-row">
              {st.theme === "dark" ? <IconMoon /> : <IconSun />}
              <div className="grow">{st.theme === "dark" ? t("dark") : t("light")}</div>
              <div className="seg">
                <button
                  className={st.theme === "dark" ? "on" : ""}
                  onClick={() => {
                    useStore.setState({ theme: "dark" as const });
                    applyAppearance();
                  }}
                >
                  {t("dark")}
                </button>
                <button
                  className={st.theme === "light" ? "on" : ""}
                  onClick={() => {
                    useStore.setState({ theme: "light" as const });
                    applyAppearance();
                  }}
                >
                  {t("light")}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* server */}
        <div className="set-section">
          <h3>{t("connection")}</h3>
          <div className="card">
            <div style={{ padding: "14px 16px" }}>
              <div className="field-label">{t("serverUrl")}</div>
              <input
                className="field"
                dir="ltr"
                placeholder="http://192.168.1.10:3000"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
              />
              <div style={{ fontSize: 11.5, color: "var(--muted)", margin: "8px 2px 12px", lineHeight: 1.9 }}>
                {t("serverHint")}
                <br />
                {st.connState === "ok" && (
                  <span style={{ color: "var(--ok)" }}>● {t("connected")}</span>
                )}
                {st.connState === "connecting" && <span>● {t("connecting")}</span>}
                {st.connState === "fail" && (
                  <span style={{ color: "var(--danger)" }}>● {t("failed")}</span>
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-sm" disabled={busy} onClick={saveServer}>
                  <IconServer size={15} />
                  {t("connect")}
                </button>
                {st.mode === "server" && (
                  <button className="btn btn-sm ghost" onClick={cutServer}>
                    {t("disconnect")}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* about */}
        <div className="set-section">
          <h3>{t("about")}</h3>
          <div className="card">
            <div className="set-row">
              <IconInfo />
              <div className="grow">
                {t("version")} <b dir="ltr">0.1.0-alpha.1</b> · Phase 2
              </div>
            </div>
            <div className="set-row" style={{ color: "var(--danger)" }} onClick={() => {
              if (confirm(t("logoutConfirm"))) {
                st.logout();
                seedDemo();
              }
            }}>
              <IconLogout />
              <div className="grow">{t("logout")}</div>
            </div>
          </div>
        </div>

        <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 11, padding: "8px 0 20px", lineHeight: 2 }}>
          دل — Del Messenger
          <br />
          © 2025–2026 · Built with 💙
        </div>
      </div>
    </div>
  );
}
