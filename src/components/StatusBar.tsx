import { useEffect, useState } from "react";
import { api, type EngineInfo } from "../lib/api";
import { useSettings, type ThemeMode } from "../stores/settings";

const themeLabels: Record<ThemeMode, string> = {
  system: "시스템",
  light: "라이트",
  dark: "다크",
};

export function StatusBar() {
  const { theme, setTheme } = useSettings();
  const [engine, setEngine] = useState<EngineInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.sshEngineInfo().then(setEngine).catch((e) => setError(String(e)));
  }, []);

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-zinc-200 bg-zinc-50 px-3 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
      <span>
        {error
          ? `SSH 엔진 오류: ${error}`
          : engine
            ? `${engine.version}${engine.supported ? "" : " (지원하지 않는 버전)"}`
            : "SSH 엔진 확인 중…"}
      </span>
      <label className="flex items-center gap-1">
        테마
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value as ThemeMode)}
          className="rounded border border-zinc-300 bg-white px-1 dark:border-zinc-700 dark:bg-zinc-950"
        >
          {(Object.keys(themeLabels) as ThemeMode[]).map((m) => (
            <option key={m} value={m}>
              {themeLabels[m]}
            </option>
          ))}
        </select>
      </label>
    </footer>
  );
}
