import { create } from "zustand";
import { invoke, isTauri } from "@tauri-apps/api/core";

export type ThemeMode = "system" | "light" | "dark";

const DEFAULTS = { theme: "system" as ThemeMode, fontSize: 13 };

interface SettingsState {
  theme: ThemeMode;
  fontSize: number;
  loaded: boolean;
  load: () => Promise<void>;
  setTheme: (theme: ThemeMode) => void;
  setFontSize: (size: number) => void;
  /** 설정만 기본값으로 되돌린다 (FUN-12). 서버 목록과 호스트 키는 유지된다. */
  reset: () => Promise<void>;
}

function save(key: string, value: string) {
  if (!isTauri()) return;
  invoke("settings_set", { key, value }).catch((e) => console.error("설정 저장 실패", e));
}

export const useSettings = create<SettingsState>((set) => ({
  ...DEFAULTS,
  loaded: false,
  load: async () => {
    if (!isTauri()) return set({ loaded: true });
    try {
      const all = await invoke<Record<string, string>>("settings_get");
      const theme = (["system", "light", "dark"] as const).find((t) => t === all.theme) ?? DEFAULTS.theme;
      const fontSize = Number(all["terminal.fontSize"]) || DEFAULTS.fontSize;
      set({ theme, fontSize, loaded: true });
    } catch (e) {
      console.error("설정 불러오기 실패", e);
      set({ loaded: true });
    }
  },
  setTheme: (theme) => {
    set({ theme });
    save("theme", theme);
  },
  setFontSize: (fontSize) => {
    set({ fontSize });
    save("terminal.fontSize", String(fontSize));
  },
  reset: async () => {
    if (isTauri()) await invoke("settings_reset");
    set({ ...DEFAULTS });
  },
}));
