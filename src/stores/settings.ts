import { create } from "zustand";

export type ThemeMode = "system" | "light" | "dark";

interface SettingsState {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
}

// TODO: 로컬 저장소(OPEN-09) 결정 후 설정을 영구 저장한다.
export const useSettings = create<SettingsState>((set) => ({
  theme: "system",
  setTheme: (theme) => set({ theme }),
}));
