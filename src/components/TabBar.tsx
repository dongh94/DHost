import { closeTab, reconnect } from "../lib/connect";
import { useSessions, type SessionStatus } from "../stores/sessions";

const dot: Record<SessionStatus, string> = {
  connecting: "bg-amber-400",
  connected: "bg-emerald-500",
  closed: "bg-zinc-400",
};

export function TabBar() {
  const { tabs, activeKey, setActive } = useSessions();
  if (tabs.length === 0) return null;
  const active = tabs.find((t) => t.key === activeKey);

  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-zinc-200 bg-zinc-50 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex min-w-0 flex-1 overflow-x-auto">
        {tabs.map((t) => (
          <div
            key={t.key}
            onClick={() => setActive(t.key)}
            className={`group flex max-w-60 shrink-0 cursor-default items-center gap-2 border-r border-zinc-200 px-3 dark:border-zinc-800 ${
              t.key === activeKey ? "bg-white dark:bg-zinc-950" : "text-zinc-500"
            }`}
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${dot[t.status]}`} />
            <span className="truncate">{t.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t.key);
              }}
              className="rounded px-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800"
              aria-label="탭 닫기"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {active?.status === "closed" && (
        <button
          onClick={() => reconnect(active.key)}
          className="shrink-0 px-3 text-sm font-medium text-blue-600 hover:bg-zinc-100 dark:text-blue-400 dark:hover:bg-zinc-800"
        >
          재접속
        </button>
      )}
    </div>
  );
}
