import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// Quiet console in release builds
if (import.meta.env.PROD) {
  console.log("%cدل — Del Messenger 0.1.0-alpha.1", "color:#38bdf8;font-weight:bold");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
