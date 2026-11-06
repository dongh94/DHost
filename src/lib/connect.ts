import { isTauri } from "@tauri-apps/api/core";
import { api, type ConnectRequest, type Diagnosis, type Server } from "./api";
import { createTerminal, getTerminal, disposeTerminal } from "./terminals";
import { analyzePaste } from "./paste";
import { useSessions, type SessionSource } from "../stores/sessions";
import { useSettings } from "../stores/settings";
import { useCatalog } from "../stores/catalog";
import { useUi } from "../stores/ui";

/** 저장된 서버로 접속한다. 사용자가 연결을 눌렀을 때만 호출된다 (POL-06). */
export function connectServer(server: Server) {
  const jump = server.jumpServerId
    ? useCatalog.getState().servers.find((s) => s.id === server.jumpServerId)
    : undefined;
  openTab({
    title: server.name,
    subtitle: `${server.username}@${server.host}:${server.port}${jump ? ` · ${jump.name} 경유` : ""}`,
    source: { type: "server", serverId: server.id },
    production: server.isProduction,
  });
}

/** 프로필 없이 바로 접속한다. */
export function quickConnect(request: ConnectRequest) {
  const t = request.target;
  openTab({
    title: `${t.user}@${t.host}`,
    subtitle: `${t.host}:${t.port}${request.jump ? ` · ${request.jump.host} 경유` : ""}`,
    source: { type: "quick", request },
    production: false,
  });
}

function openTab(meta: { title: string; subtitle: string; source: SessionSource; production: boolean }) {
  const key = crypto.randomUUID();
  const entry = createTerminal(key, resolveTheme(), useSettings.getState().fontSize);

  // 입력과 크기 변경은 현재 연결된 백엔드 세션으로 보낸다.
  entry.term.onData((data) => {
    const tab = findTab(key);
    if (tab?.sessionId && tab.status !== "closed") void api.sessionWrite(tab.sessionId, data);
  });
  entry.term.onResize(({ cols, rows }) => {
    const tab = findTab(key);
    if (tab?.sessionId && tab.status !== "closed") void api.sessionResize(tab.sessionId, cols, rows);
  });

  // 붙여넣기는 xterm보다 먼저 가로챈다. 위험 신호가 있으면 사용자가 확인하기 전까지 보내지 않는다 (FUN-08).
  entry.el.addEventListener(
    "paste",
    (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (text) requestPaste(key, text);
    },
    true,
  );

  useSessions.getState().addTab({ key, ...meta, sessionId: null, status: "connecting", exitCode: null });
  useUi.getState().setPage("sessions");
  void start(key);
}

function requestPaste(key: string, text: string) {
  const tab = findTab(key);
  if (!tab || tab.status !== "connected") return;
  const analysis = analyzePaste(text);
  if (!analysis.needsConfirm) {
    getTerminal(key)?.term.paste(text);
    return;
  }
  useSessions.getState().pushPrompt({ kind: "paste", data: { tabKey: key, text, analysis } });
}

/** 확인 대화상자에서 승인한 텍스트를 보낸다. 그 사이 연결이 끊겼으면 보내지 않는다. */
export function commitPaste(key: string, text: string) {
  const tab = findTab(key);
  const entry = getTerminal(key);
  if (!tab || !entry || tab.status !== "connected") return false;
  entry.term.paste(text);
  entry.term.focus();
  return true;
}

/** 인증 창에서 취소: 그 접속 시도를 끝낸다. ssh가 다시 묻지 않는다. */
export function cancelAuth(sessionId: string) {
  const tab = useSessions.getState().tabs.find((t) => t.sessionId === sessionId);
  if (tab) useSessions.getState().updateTab(tab.key, { authCancelled: true });
  void api.sessionClose(sessionId);
}

export function focusTerminal(key: string) {
  getTerminal(key)?.term.focus();
}

/** 끊어진 탭을 사용자가 직접 다시 연결한다 (FUN-07). 이전 출력과 구분선을 넣는다. */
export function reconnect(key: string) {
  getTerminal(key)?.term.write("\r\n\x1b[2m──────── 재접속 ────────\x1b[0m\r\n");
  useSessions.getState().updateTab(key, {
    status: "connecting",
    sessionId: null,
    exitCode: null,
    authCancelled: false,
    diagnosis: null,
  });
  void start(key);
}

export function closeTab(key: string) {
  const tab = findTab(key);
  if (tab?.sessionId && tab.status !== "closed") void api.sessionClose(tab.sessionId);
  useSessions.getState().removeTab(key);
  disposeTerminal(key);
}

/** 세션 ID를 받기 전에 도착한 종료 이벤트 */
const earlyExits = new Map<string, { exitCode: number | null; diagnosis: Diagnosis | null }>();

export function markExited(sessionId: string, exitCode: number | null, diagnosis: Diagnosis | null = null) {
  const tab = useSessions.getState().tabs.find((t) => t.sessionId === sessionId);
  if (!tab) {
    earlyExits.set(sessionId, { exitCode, diagnosis });
    return;
  }
  useSessions.getState().updateTab(tab.key, { status: "closed", exitCode, diagnosis });
  getTerminal(tab.key)?.term.write(
    tab.authCancelled
      ? "\r\n\x1b[2m[인증을 취소해 연결하지 않았습니다]\x1b[0m\r\n"
      : `\r\n\x1b[2m[연결 종료${exitCode !== null ? ` · 코드 ${exitCode}` : ""}]\x1b[0m\r\n`,
  );
}

async function start(key: string) {
  const tab = findTab(key);
  const entry = getTerminal(key);
  if (!tab || !entry) return;
  if (!isTauri()) {
    entry.term.write(
      "\r\n\x1b[33m브라우저 미리보기에서는 접속할 수 없습니다. 터미널에서 `pnpm tauri dev`로 실행한 앱 창을 사용하세요.\x1b[0m\r\n",
    );
    useSessions.getState().updateTab(key, { status: "closed" });
    return;
  }
  const write = (bytes: Uint8Array) => entry.term.write(bytes);
  try {
    const { cols, rows } = entry.term;
    const sessionId =
      tab.source.type === "server"
        ? await api.serverConnect(tab.source.serverId, cols, rows, write)
        : await api.sessionOpen(tab.source.request, cols, rows, write);
    if (tab.source.type === "server") void useCatalog.getState().reload(); // 최근 접속 시각 갱신
    // 세션이 열리기 전에 이미 종료 이벤트가 왔을 수 있다.
    const current = findTab(key);
    if (current && current.status === "connecting") {
      useSessions.getState().updateTab(key, { sessionId, status: "connected" });
      const early = earlyExits.get(sessionId);
      if (early) {
        earlyExits.delete(sessionId);
        markExited(sessionId, early.exitCode, early.diagnosis);
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
