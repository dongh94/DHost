import { History, KeyRound, Server, Settings, SquareTerminal } from "lucide-react";
import type { ReactNode } from "react";
import { useSessions } from "../stores/sessions";
import { useUi, type Page } from "../stores/ui";

function Item({ page, icon, label, badge }: { page: Page; icon: ReactNode; label: string; badge?: number }) {
  const { page: current, setPage } = useUi();
  const active = current === page;
  return (
    <button
      onClick={() => setPage(page)}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors ${
        active ? "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300" : "text-fg-muted hover:bg-muted hover:text-fg"
      }`}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {!!badge && (
        <span className="rounded-full bg-brand-600 px-1.5 text-[10px] font-semibold leading-4 text-white">{badge}</span>
      )}
    </button>
  );
}

/** 왼쪽 내비게이션 */
export function NavRail() {
  const open = useSessions((s) => s.tabs.filter((t) => t.status !== "closed").length);
  const cls = "h-4 w-4";
  return (
    <nav className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-line bg-chrome p-2">
      <Item page="servers" icon={<Server className={cls} />} label="서버" />
      <Item page="sessions" icon={<SquareTerminal className={cls} />} label="세션" badge={open} />
      <Item page="history" icon={<History className={cls} />} label="접속 이력" />
      <Item page="hostkeys" icon={<KeyRound className={cls} />} label="호스트 키" />
      <div className="flex-1" />
      <Item page="settings" icon={<Settings className={cls} />} label="설정" />
    </nav>
  );
}
