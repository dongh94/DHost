import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { IBufferRange } from "@xterm/xterm";
import { parseSafeUrl, requestOpenLink } from "./links";

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

/** 링크는 ⌘+클릭일 때만 연다. 그냥 클릭은 글자 선택에 쓴다. */
const modifierHeld = (e: MouseEvent) => e.metaKey || e.ctrlKey;

export function createTerminal(key: string, theme: "light" | "dark", fontSize = 13, scrollback = 5000): TermEntry {
  const term = new Terminal({
    fontFamily: "Menlo, 'D2Coding', monospace",
    fontSize,
    cursorBlink: true,
    // 보관 줄 수가 탭 하나의 메모리 상한이 된다 (GAP-05).
    scrollback,
    theme: termThemes[theme],
    // 원격 출력이 창 크기·제목 보고 같은 창 조작을 요청해도 따르지 않는다 (GAP-04). 기본값이지만 명시한다.
    windowOptions: {},
    allowProposedApi: false,
    // OSC 8 하이퍼링크: 보이는 글자와 실제 주소가 다를 수 있어 확인 창에서 둘 다 보여 준다.
    linkHandler: {
      allowNonHttpProtocols: false,
      activate: (e, uri, range) => {
        if (!modifierHeld(e) || !parseSafeUrl(uri)) return;
        requestOpenLink({ tabKey: key, url: uri, shownText: textInRange(term, range) });
      },
    },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  // 출력 속의 일반 주소 글자
  term.loadAddon(
    new WebLinksAddon((e, uri) => {
      if (modifierHeld(e) && parseSafeUrl(uri)) requestOpenLink({ tabKey: key, url: uri });
    }),
  );
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

function textInRange(term: Terminal, range: IBufferRange): string {
  const buf = term.buffer.active;
  const parts: string[] = [];
  for (let y = range.start.y; y <= range.end.y; y++) {
    const line = buf.getLine(y - 1);
    if (!line) continue;
    const from = y === range.start.y ? range.start.x - 1 : 0;
    const to = y === range.end.y ? range.end.x : undefined;
    parts.push(line.translateToString(true, from, to));
  }
  return parts.join("").trim();
}
