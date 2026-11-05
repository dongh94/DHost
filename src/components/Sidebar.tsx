import { ConnectForm } from "./ConnectForm";

/** 고객사 > 폴더 > 서버 트리가 들어갈 자리 (FUN-01, FUN-02) */
export function Sidebar() {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
      <ConnectForm />
      <div className="border-t border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800">
        서버 목록은 아직 없습니다.
      </div>
    </aside>
  );
}
