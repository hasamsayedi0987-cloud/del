import { useEffect } from "react";
import { useStore, makeT } from "./storeExport";
import { Splash } from "./screens/Splash";
import { Login } from "./screens/Login";
import { Chats } from "./screens/Chats";
import { ChatView } from "./screens/ChatView";
import { NewChat } from "./screens/NewChat";
import { Settings } from "./screens/Settings";
import { seedDemo } from "./demo";

export default function App() {
  const screen = useStore((s) => s.screen);
  const lang = useStore((s) => s.lang);
  const theme = useStore((s) => s.theme);
  const toast = useStore((s) => s.toast);
  const user = useStore((s) => s.user);

  useEffect(() => {
    const html = document.documentElement;
    html.lang = lang;
    html.dir = lang === "fa" ? "rtl" : "ltr";
    html.setAttribute("data-theme", theme);
  }, [lang, theme]);

  useEffect(() => {
    useStore.getState().loadSaved();
    const t = setTimeout(() => {
      const st = useStore.getState();
      if (st.user?.id && st.user.name) {
        if (st.mode === "server" && st.serverUrl && st.token) {
          st.set({ screen: "chats" });
          void (async () => {
            const { connectServer } = await import("./api");
            const ok = await connectServer();
            if (!ok) {
              st.showToast(makeT(st.lang)("failed"));
              seedDemo();
            }
          })();
        } else {
          seedDemo();
        }
      } else {
        st.go("phone");
      }
    }, 1500);
    return () => clearTimeout(t);
  }, []);

  let view: React.ReactNode;
  switch (screen) {
    case "splash":
      view = <Splash />;
      break;
    case "phone":
    case "otp":
    case "name":
      view = <Login />;
      break;
    case "chats":
      view = <Chats />;
      break;
    case "chat":
      view = <ChatView />;
      break;
    case "newchat":
      view = <NewChat />;
      break;
    case "settings":
      view = <Settings />;
      break;
  }

  return (
    <div className="app-shell">
      {view}
      {toast && <div className="toast">{toast}</div>}
      {screen === "splash" && user === null && null}
    </div>
  );
}
