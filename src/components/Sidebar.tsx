/** 고객사 > 폴더 > 서버 트리가 들어갈 자리 (FUN-01, FUN-02) */
export function Sidebar() {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="p-3">
        <input
          type="search"
          placeholder="서버 검색"
          disabled
          className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
      </div>
      <div className="flex-1 overflow-y-auto px-3 text-sm text-zinc-500">
        등록된 서버가 없습니다.
      </div>
    </aside>
  );
}
