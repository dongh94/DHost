import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { closeTab, reconnect, resetTerminal } from "./connect";
import { useSessions } from "../stores/sessions";
import { useUi, type Page } from "../stores/ui";

/**
 * 단축키 (GAP-06). 앱에서는 macOS 메뉴가 단축키를 받아 `menu` 이벤트로 보내고,
 * 브라우저 미리보기에서는 keydown으로 받는다. 웹뷰가 두 경로를 모두 보내는 경우가 있어
 * 같은 동작이 짧은 시간 안에 두 번 오면 한 번만 처리한다.
 */
export type Action =
  | "search"
  | "tab.new"
  | "tab.close"
  | "tab.next"
  | "tab.prev"
  | "tab.reconnect"
  | "term.reset"
  | `tab.${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
  | `page.${Page}`;

const last = new Map<string, number>();

export function runAction(action: string) {
  const now = performance.now();
  if (now - (last.get(action) ?? -1e9) < 150) return;
  last.set(action, now);

  const ui = useUi.getState();
  const sessions = useSessions.getState();
  // 확인 창이 떠 있으면 뒤에 있는 화면을 건드리지 않는다.
  if (sessions.prompts.length > 0) return;
  const { tabs, activeKey } = sessions;
  const onSessions = ui.page === "sessions";
  const activeIndex = tabs.findIndex((t) => t.key === activeKey);
  const active = tabs[activeIndex];

  if (action === "search" || action === "tab.new") {
    ui.focusSearch();
    return;
  }
  if (action.startsWith("page.")) {
    ui.setPage(action.slice(5) as Page);
    return;
  }
  const n = /^tab\.(\d)$/.exec(action);
  if (n) {
    // ⌘9는 브라우저처럼 마지막 탭
    const target = n[1] === "9" ? tabs[tabs.length - 1] : tabs[Number(n[1]) - 1];
    if (target) {
      sessions.setActive(target.key);
      ui.setPage("sessions");
    }
    return;
  }
  if ((action === "tab.next" || action === "tab.prev") && tabs.length > 0) {
    const step = action === "tab.next" ? 1 : -1;
    const next = tabs[(Math.max(activeIndex, 0) + step + tabs.length) % tabs.length];
    sessions.setActive(next.key);
    ui.setPage("sessions");
    return;
  }
  // 아래 동작은 세션 화면에서 보고 있는 탭에만 적용한다.
  if (!onSessions || !active) return;
  if (action === "tab.close") {
    // 연결 중인 세션은 실수로 끊지 않도록 한 번 묻는다.
    if (active.status === "closed") closeTab(active.key);
    else if (!sessions.prompts.some((p) => p.kind === "closeTab")) sessions.pushPrompt({ kind: "closeTab", data: { tabKey: active.key } });
  } else if (action === "tab.reconnect") {
    if (active.status === "closed") reconnect(active.key);
  } else if (action === "term.reset") {
    resetTerminal(active.key);
  }
}

const keyMap: Record<string, Action> = {
  k: "search",
  t: "tab.new",
  w: "tab.close",
  r: "tab.reconnect",
  "}": "tab.next",
  "]": "tab.next",
  "{": "tab.prev",
  "[": "tab.prev",
};

function onKeyDown(e: KeyboardEvent) {
  if (!e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.toLowerCase();
  let action: string | undefined;
  if (/^[1-9]$/.test(key)) action = `tab.${key}`;
  else if (key === "]" || key === "[" || key === "}" || key === "{") action = e.shiftKey ? keyMap[key] : undefined;
  else if (!e.shiftKey) action = keyMap[key];
  if (key === "," && !e.shiftKey) action = "page.settings";
  if (!action) return;
  e.preventDefault();
  e.stopPropagation();
  runAction(action);
}

/** 앱 시작 시 한 번 호출한다. 정리 함수를 돌려준다. */
export function installShortcuts() {
  // xterm보다 먼저 받도록 캡처 단계에서 듣는다.
  window.addEventListener("keydown", onKeyDown, true);
  let unlisten: (() => void) | undefined;
  let disposed = false;
  if (isTauri()) {
    void listen<string>("menu", (e) => runAction(e.payload))
      .then((u) => (disposed ? u() : (unlisten = u)))
      .catch(() => {});
  }
  return () => {
    disposed = true;
    window.removeEventListener("keydown", onKeyDown, true);
    unlisten?.();
  };
}
