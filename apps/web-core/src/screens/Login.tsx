import { useState } from "react";
import { useStore, makeT } from "../storeExport";
import { serverRequestOtp, serverVerifyOtp } from "../api";
import { DEMO_CONTACTS, seedDemo } from "../demo";
import { AVATAR_COLORS, uid } from "../store";
import { Avatar } from "../components/Avatar";

export function Login() {
  const st = useStore();
  const t = makeT(st.lang);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState(0);
  const [busy, setBusy] = useState(false);
  const isFa = st.lang === "fa";

  const normalize = (v: string) => v.replace(/\s/g, "");

  async function submitPhone() {
    const phone = normalize(st.phoneInput);
    if (phone.replace(/\D/g, "").length < 7) return;
    setBusy(true);
    if (st.mode === "server" && st.serverUrl) {
      try {
        const devCode = await serverRequestOtp(phone);
        useStore.setState({ otpCode: devCode ?? "", screen: "otp" });
      } catch {
        st.showToast(t("failed"));
      }
    } else {
      useStore.setState({ otpCode: "12345", screen: "otp" });
    }
    setBusy(false);
  }

  async function submitOtp() {
    if (code.trim().length < 4) return;
    setBusy(true);
    if (st.mode === "server" && st.serverUrl) {
      try {
        const r = await serverVerifyOtp(normalize(st.phoneInput), code.trim());
        if (r.user.name) {
          useStore.setState({ user: r.user, token: r.token });
          await enterApp();
        } else {
          useStore.setState({ token: r.token, user: { ...r.user, name: "" }, screen: "name" });
        }
      } catch {
        st.showToast(t("wrongCode"));
      }
    } else {
      if (code.trim() === st.otpCode) {
        useStore.setState({
          user: { id: uid(), name: "", phone: normalize(st.phoneInput), color: 0 },
          screen: "name",
        });
      } else {
        st.showToast(t("wrongCode"));
      }
    }
    setBusy(false);
  }

  async function finishName() {
    const user = useStore.getState().user;
    if (!user || !name.trim()) return;
    setBusy(true);
    const me = { ...user, name: name.trim(), color };
    useStore.setState({ user: me });
    if (st.mode === "server" && st.serverUrl && st.token) {
      const { serverUpdateMe } = await import("../api");
      try {
        const u = await serverUpdateMe({ name: me.name, color: me.color });
        useStore.setState({ user: { ...me, ...u } });
      } catch { /* keep local */ }
    }
    await enterApp();
    setBusy(false);
  }

  async function enterApp() {
    const cur = useStore.getState();
    if (cur.mode === "server" && cur.serverUrl && cur.token) {
      const { connectServer } = await import("../api");
      const ok = await connectServer();
      if (ok) return;
      cur.showToast(t("failed"));
    }
    seedDemo();
  }

  // ----- OTP screen -----
  if (st.screen === "otp") {
    return (
      <div className="center-screen fade-in">
        <div className="hero">
          <h2>{t("otpTitle")}</h2>
          <p>{t("otpSub", { phone: st.phoneInput })}</p>
        </div>
        <input
          className="field"
          inputMode="numeric"
          maxLength={5}
          placeholder="• • • • •"
          value={code}
          style={{ textAlign: "center", fontSize: 22, letterSpacing: 8, fontWeight: 800 }}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && submitOtp()}
          autoFocus
        />
        {st.otpCode && (
          <div className="hint">
            {t("otpHint")} — <b dir="ltr">{st.otpCode}</b>
          </div>
        )}
        <div style={{ flex: 1 }} />
        <button className="btn" disabled={busy || code.length < 4} onClick={submitOtp}>
          {t("verify")}
        </button>
        <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => st.go("phone")}>
          {t("back")}
        </button>
      </div>
    );
  }

  // ----- Name screen -----
  if (st.screen === "name") {
    return (
      <div className="center-screen fade-in">
        <div className="hero">
          <h2>{t("nameTitle")}</h2>
          <p>{t("nameSub")}</p>
        </div>
        <input
          className="field"
          placeholder={t("namePh")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && finishName()}
          autoFocus
        />
        <div className="field-label" style={{ marginTop: 18 }}>
          {t("pickColor")}
        </div>
        <div className="color-dots">
          {AVATAR_COLORS.map((c, i) => (
            <button
              key={c}
              className={`color-dot ${color === i ? "sel" : ""}`}
              style={{ background: c }}
              onClick={() => setColor(i)}
            />
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn" disabled={busy || !name.trim()} onClick={finishName}>
          {t("finish")}
        </button>
      </div>
    );
  }

  // ----- Phone screen -----
  return (
    <div className="center-screen fade-in">
      <div className="hero">
        <div className="logo-heart" style={{ color: "#4f8ef7", display: "inline-block" }}>
          <svg width="72" height="72" viewBox="0 0 24 24" fill="currentColor">
            <path
              fill="url(#lg2)"
              d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
            />
            <defs>
              <linearGradient id="lg2" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#2f6bff" />
                <stop offset="100%" stopColor="#38bdf8" />
              </linearGradient>
            </defs>
          </svg>
        </div>
        <h2>
          {t("welcome")} <span className="wordmark">{t("appName")}</span>
        </h2>
        <p>{t("welcomeSub")}</p>
      </div>
      <div className="field-label">{t("phone")}</div>
      <input
        className="field"
        dir="ltr"
        inputMode="tel"
        placeholder={t("phonePh")}
        value={st.phoneInput}
        onChange={(e) => useStore.setState({ phoneInput: e.target.value })}
        onKeyDown={(e) => e.key === "Enter" && submitPhone()}
        style={{ textAlign: isFa ? "right" : "left" }}
        autoFocus
      />
      <div className="hint">
        {st.mode === "demo" ? t("otpHint") : t("connecting")}
      </div>
      <div style={{ flex: 1 }} />
      <button
        className="btn"
        disabled={busy || normalize(st.phoneInput).replace(/\D/g, "").length < 7}
        onClick={submitPhone}
      >
        {t("continue")}
      </button>
      {DEMO_CONTACTS.length > 0 && null}
    </div>
  );
}

export function loginAsDemoAvatarPreview() {
  return <Avatar name="دل" color={0} />;
}
