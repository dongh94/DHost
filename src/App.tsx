import { useEffect } from "react";
import { Header } from "./components/Header";
import { NavRail } from "./components/NavRail";
import { PromptDialog } from "./components/PromptDialog";
import { StatusBar } from "./components/StatusBar";
import { setAllThemes } from "./lib/terminals";
import { useApplyTheme } from "./lib/useApplyTheme";
import { useBackendEvents } from "./lib/useBackendEvents";
import { HostKeysPage } from "./pages/HostKeysPage";
import { ServersPage } from "./pages/ServersPage";
import { SessionsPage } from "./pages/SessionsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { useCatalog } from "./stores/catalog";
import { useUi } from "./stores/ui";

export default function App() {
  const theme = useApplyTheme();
  useBackendEvents();
  const page = useUi((s) => s.page);

  // 테마를 바꿔도 터미널을 다시 만들지 않는다 (세션 유지)
  useEffect(() => setAllThemes(theme), [theme]);
  useEffect(() => {
    void useCatalog.getState().reload();
  }, []);

  return (
    <div className="flex h-full flex-col bg-canvas text-fg">
      <Header />
      <div className="flex min-h-0 flex-1">
        <NavRail />
        <main className="min-w-0 flex-1">
          {page === "servers" && <ServersPage />}
          {page === "hostkeys" && <HostKeysPage />}
          {page === "settings" && <SettingsPage />}
          {/* 세션 화면은 항상 마운트해서 다른 화면에 가도 터미널이 유지되게 한다 */}
          <SessionsPage visible={page === "sessions"} />
        </main>
      </div>
      <StatusBar />
      <PromptDialog />
    </div>
  );
}
