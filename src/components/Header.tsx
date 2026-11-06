import { useEffect, useRef } from "react";
import { Search } from "lucide-react";
// macOS 앱 아이콘과 같은 이미지
import logo from "../assets/logo.png";
import { connectServer } from "../lib/connect";
import { useCatalog } from "../stores/catalog";
import { useUi } from "../stores/ui";

/** 상단 바: 앱 이름과 전역 서버 검색 (⌘K). ↑↓로 고르고 Enter로 접속한다 (GAP-06). */
export function Header() {
  const { search, setSearch, setPage, searchFocus, moveCursor } = useUi();
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchFocus === 0) return;
    // 페이지 전환 직후에도 포커스가 가도록 한 프레임 미룬다.
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
  }, [searchFocus]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setSearch("");
      ref.current?.blur();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setPage("servers");
      moveCursor(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      const { results, cursor } = useUi.getState();
      const server = useCatalog.getState().servers.find((s) => s.id === results[cursor]);
      if (server) {
        e.preventDefault();
        ref.current?.blur();
        connectServer(server);
      }
    }
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-line bg-chrome px-4">
      <div className="flex w-48 items-center gap-2">
        <img src={logo} alt="" className="h-6 w-6" draggable={false} />
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
          onKeyDown={onKeyDown}
          placeholder="서버 검색 — ↑↓ 선택, Enter 접속"
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
