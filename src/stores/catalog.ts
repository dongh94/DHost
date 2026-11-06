import { create } from "zustand";
import { isTauri } from "@tauri-apps/api/core";
import { api, type Customer, type Folder, type Server } from "../lib/api";

interface CatalogState {
  customers: Customer[];
  folders: Folder[];
  servers: Server[];
  loaded: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export const useCatalog = create<CatalogState>((set) => ({
  customers: [],
  folders: [],
  servers: [],
  loaded: false,
  error: null,
  reload: async () => {
    if (!isTauri()) {
      set({ loaded: true, error: "브라우저 미리보기에서는 저장소를 쓸 수 없습니다" });
      return;
    }
    try {
      const c = await api.catalog();
      set({ ...c, loaded: true, error: null });
    } catch (e) {
      set({ loaded: true, error: String(e) });
    }
  },
}));
