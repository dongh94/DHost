import { create } from "zustand";

export type Page = "servers" | "sessions" | "history" | "hostkeys" | "settings";

interface UiState {
  page: Page;
  search: string;
  /** 서버 목록에 보이는 순서대로의 서버 ID. 검색창에서 ↑↓·Enter로 고른다 (GAP-06). */
  results: string[];
  cursor: number;
  /** 늘어날 때마다 검색창에 포커스를 준다 */
  searchFocus: number;
  setPage: (page: Page) => void;
  setSearch: (search: string) => void;
  setResults: (ids: string[]) => void;
  moveCursor: (delta: number) => void;
  focusSearch: () => void;
}

export const useUi = create<UiState>((set) => ({
  page: "servers",
  search: "",
  results: [],
  cursor: 0,
  searchFocus: 0,
  setPage: (page) => set({ page }),
  setSearch: (search) => set({ search, cursor: 0 }),
  setResults: (results) => set((s) => ({ results, cursor: Math.min(s.cursor, Math.max(results.length - 1, 0)) })),
  moveCursor: (delta) =>
    set((s) => (s.results.length ? { cursor: (s.cursor + delta + s.results.length) % s.results.length } : {})),
  focusSearch: () => set((s) => ({ page: "servers", searchFocus: s.searchFocus + 1 })),
}));
