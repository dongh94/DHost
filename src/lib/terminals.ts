import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

/**
 * 탭마다 xterm 인스턴스를 하나씩 React 밖에서 보관한다.
 * 탭을 옮기거나 테마를 바꿔도 터미널과 세션이 유지된다.
 */
export interface TermEntry {
  term: Terminal;
  fit: FitAddon;
  el: HTMLDivElement;
  opened: boolean;
}

const registry = new Map<string, TermEntry>();

export const termThemes = {
  light: { background: "#ffffff", foreground: "#18181b", cursor: "#18181b", selectionBackground: "#bfdbfe" },
  dark: { background: "#09090b", foreground: "#e4e4e7", cursor: "#e4e4e7", selectionBackground: "#3f3f46" },
};

export function createTerminal(key: string, theme: "light" | "dark", fontSize = 13): TermEntry {
  const term = new Terminal({
    fontFamily: "Menlo, 'D2Coding', monospace",
    fontSize,
    cursorBlink: true,
    scrollback: 5000,
    theme: termThemes[theme],
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const el = document.createElement("div");
  el.style.width = "100%";
  el.style.height = "100%";
  const entry = { term, fit, el, opened: false };
  registry.set(key, entry);
  return entry;
}

export function getTerminal(key: string) {
  return registry.get(key);
}

export function disposeTerminal(key: string) {
  registry.get(key)?.term.dispose();
  registry.delete(key);
}

export function setAllThemes(theme: "light" | "dark") {
  for (const e of registry.values()) e.term.options.theme = termThemes[theme];
}

export function setAllFontSizes(fontSize: number) {
  for (const e of registry.values()) {
    e.term.options.fontSize = fontSize;
    if (e.opened && e.el.offsetParent !== null) e.fit.fit();
  }
}
