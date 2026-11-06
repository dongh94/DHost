import { useEffect, useRef } from "react";
import { Search } from "lucide-react";
import { useUi } from "../stores/ui";

/** 상단 바: 앱 이름과 전역 서버 검색 (⌘K) */
export function Header() {
  const { search, setSearch, setPage } = useUi();
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPage("servers");
        ref.current?.focus();
        ref.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPage]);

  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-line bg-chrome px-4">
      <div className="flex w-48 items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-600 text-xs font-bold text-white">D</div>
        <span className="text-sm font-semibold text-fg">DHost</span>
      </div>
      <div className="relative mx-auto w-full max-w-md">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
        <input
          ref={ref}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage("servers");
          }}
          onKeyDown={(e) => e.key === "Escape" && (setSearch(""), ref.current?.blur())}
          placeholder="서버 이름, 주소, 고객사 검색"
          className="w-full rounded-md border border-line bg-canvas py-1.5 pl-8 pr-12 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-500 focus:bg-surface focus:outline-none"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-line px-1.5 text-[10px] text-fg-subtle">
          ⌘K
        </kbd>
      </div>
      <div className="w-48" />
    </header>
  );
}
