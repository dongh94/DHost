import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

async function boot() {
  // 개발 중 브라우저에서 화면만 확인할 때: http://localhost:1420/?mock
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("mock")) {
    const { installDevMock } = await import("./lib/devMock");
    installDevMock();
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void boot();
