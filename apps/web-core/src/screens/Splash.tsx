import { useStore, makeT } from "../storeExport";

export function Splash() {
  const lang = useStore((s) => s.lang);
  const t = makeT(lang);
  return (
    <div className="splash">
      <div className="beat logo-heart" style={{ color: "#4f8ef7" }}>
        <svg width="110" height="110" viewBox="0 0 24 24" fill="currentColor">
          <defs>
            <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#2f6bff" />
              <stop offset="100%" stopColor="#38bdf8" />
            </linearGradient>
          </defs>
          <path
            fill="url(#lg)"
            d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
          />
        </svg>
      </div>
      <div className="wordmark" style={{ fontSize: 44, fontWeight: 900 }}>
        {t("appName")}
      </div>
      <div className="tagline">{t("tagline")}</div>
      <div className="loader" />
      <div style={{ position: "absolute", bottom: 24, fontSize: 11, color: "var(--muted)" }}>
        Alpha 0.1.0 · Phase 2
      </div>
    </div>
  );
}
