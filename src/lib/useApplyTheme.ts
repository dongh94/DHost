import { useEffect, useState } from "react";
import { useSettings } from "../stores/settings";

/** 설정된 테마를 <html>에 적용하고 실제 적용된 값(light/dark)을 돌려준다. */
export function useApplyTheme(): "light" | "dark" {
  const theme = useSettings((s) => s.theme);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolved = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [resolved]);

  return resolved;
}
