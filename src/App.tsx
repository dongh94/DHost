import { useEffect } from "react";
import { PromptDialog } from "./components/PromptDialog";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TabBar } from "./components/TabBar";
import { TerminalView } from "./components/TerminalView";
import { setAllThemes } from "./lib/terminals";
import { useApplyTheme } from "./lib/useApplyTheme";
import { useBackendEvents } from "./lib/useBackendEvents";
import { useSessions } from "./stores/sessions";

export default function App() {
  const theme = useApplyTheme();
  useBackendEvents();
  const { tabs, activeKey } = useSessions();

  // 테마를 바꿔도 터미널을 다시 만들지 않는다 (세션 유지)
  useEffect(() => setAllThemes(theme), [theme]);

  return (
    <div className="flex h-full flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <TabBar />
          <div className="min-h-0 flex-1">
            {tabs.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                왼쪽에서 서버 정보를 입력하고 연결을 누르세요.
              </div>
            ) : (
              tabs.map((t) => <TerminalView key={t.key} termKey={t.key} active={t.key === activeKey} />)
            )}
          </div>
        </main>
      </div>
      <StatusBar />
      <PromptDialog />
    </div>
  );
}
