import { api, type ConnectRequest } from "./api";
import { createTerminal, getTerminal, disposeTerminal } from "./terminals";
import { useSessions } from "../stores/sessions";
import { useSettings } from "../stores/settings";

function titleOf(req: ConnectRequest) {
  const t = `${req.target.user}@${req.target.host}`;
  return req.jump ? `${t} (경유 ${req.jump.host})` : t;
}

/** 새 탭을 만들고 연결한다. 사용자가 연결 버튼을 눌렀을 때만 호출된다. */
export function openSession(request: ConnectRequest) {
  const key = crypto.randomUUID();
  const theme = resolveTheme();
  const entry = createTerminal(key, theme);

  // 입력과 크기 변경은 현재 연결된 백엔드 세션으로 보낸다.
  entry.term.onData((data) => {
    const tab = findTab(key);
    if (tab?.sessionId && tab.status !== "closed") void api.sessionWrite(tab.sessionId, data);
  });
  entry.term.onResize(({ cols, rows }) => {
    const tab = findTab(key);
    if (tab?.sessionId && tab.status !== "closed") void api.sessionResize(tab.sessionId, cols, rows);
  });

  useSessions.getState().addTab({
    key,
    title: titleOf(request),
    request,
    sessionId: null,
    status: "connecting",
    exitCode: null,
  });
  void start(key);
}

/** 끊어진 탭을 사용자가 직접 다시 연결한다 (FUN-07). 이전 출력과 구분선을 넣는다. */
export function reconnect(key: string) {
  const entry = getTerminal(key);
  entry?.term.write("\r\n\x1b[2m──────── 재접속 ────────\x1b[0m\r\n");
  useSessions.getState().updateTab(key, { status: "connecting", sessionId: null, exitCode: null });
  void start(key);
}

export function closeTab(key: string) {
  const tab = findTab(key);
  if (tab?.sessionId && tab.status !== "closed") void api.sessionClose(tab.sessionId);
  useSessions.getState().removeTab(key);
  disposeTerminal(key);
}

/** 세션 ID를 받기 전에 도착한 종료 이벤트 */
const earlyExits = new Map<string, number | null>();

export function markExited(sessionId: string, exitCode: number | null) {
  const tab = useSessions.getState().tabs.find((t) => t.sessionId === sessionId);
  if (!tab) {
    earlyExits.set(sessionId, exitCode);
    return;
  }
  useSessions.getState().updateTab(tab.key, { status: "closed", exitCode });
  getTerminal(tab.key)?.term.write(
    `\r\n\x1b[2m[연결 종료${exitCode !== null ? ` · 코드 ${exitCode}` : ""}]\x1b[0m\r\n`,
  );
}

async function start(key: string) {
  const tab = findTab(key);
  const entry = getTerminal(key);
  if (!tab || !entry) return;
  try {
    const sessionId = await api.sessionOpen(tab.request, entry.term.cols, entry.term.rows, (bytes) =>
      entry.term.write(bytes),
    );
    // 세션이 열리기 전에 이미 종료 이벤트가 왔을 수 있다.
    const current = findTab(key);
    if (current && current.status === "connecting") {
      useSessions.getState().updateTab(key, { sessionId, status: "connected" });
      if (earlyExits.has(sessionId)) {
        const code = earlyExits.get(sessionId) ?? null;
        earlyExits.delete(sessionId);
        markExited(sessionId, code);
      }
    }
  } catch (e) {
    entry.term.write(`\r\n\x1b[31m연결할 수 없습니다: ${String(e)}\x1b[0m\r\n`);
    useSessions.getState().updateTab(key, { status: "closed" });
  }
}

function findTab(key: string) {
  return useSessions.getState().tabs.find((t) => t.key === key);
}

function resolveTheme(): "light" | "dark" {
  const t = useSettings.getState().theme;
  if (t !== "system") return t;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
