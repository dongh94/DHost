import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TerminalView } from "./components/TerminalView";
import { useApplyTheme } from "./lib/useApplyTheme";

export default function App() {
  const theme = useApplyTheme();

  return (
    <div className="flex h-full flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1">
          <TerminalView theme={theme} />
        </main>
      </div>
      <StatusBar />
    </div>
  );
}
