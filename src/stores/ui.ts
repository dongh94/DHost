import { create } from "zustand";

export type Page = "servers" | "sessions" | "history" | "hostkeys" | "settings";

interface UiState {
  page: Page;
  search: string;
  setPage: (page: Page) => void;
  setSearch: (search: string) => void;
}

export const useUi = create<UiState>((set) => ({
  page: "servers",
  search: "",
  setPage: (page) => set({ page }),
  setSearch: (search) => set({ search }),
}));
