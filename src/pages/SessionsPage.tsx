import { Eraser, RotateCw, ShieldAlert, SquareTerminal, X } from "lucide-react";
import { closeTab, reconnect, resetTerminal } from "../lib/connect";
import { useSessions, type SessionStatus } from "../stores/sessions";
import { useUi } from "../stores/ui";
import { Button } from "../components/ui";
import { TerminalView } from "../components/TerminalView";
import { DiagnosisPanel } from "../components/DiagnosisPanel";

const dot: Record<SessionStatus, string> = {
  connecting: "bg-amber-400",
  connected: "bg-emerald-500",
  closed: "bg-zinc-400",
};

const statusLabel: Record<SessionStatus, string> = {
  connecting: "연결 중",
  connected: "연결됨",
  closed: "연결 끊김",
};

/** 열린 SSH 세션 탭과 터미널 (FUN-05, FUN-06) */
export function SessionsPage({ visible }: { visible: boolean }) {
  const { tabs, activeKey, setActive, updateTab } = useSessions();
  const setPage = useUi((s) => s.setPage);
  const active = tabs.find((t) => t.key === activeKey);

  return (
    <div className={`h-full flex-col ${visible ? "flex" : "hidden"}`}>
      {tabs.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
          <SquareTerminal className="h-10 w-10 text-fg-subtle" />
          <div>
            <p className="text-sm font-medium text-fg">열린 세션이 없습니다</p>
            <p className="mt-1 text-sm text-fg-muted">서버 목록에서 서버를 골라 연결하세요.</p>
          </div>
          <Button variant="primary" onClick={() => setPage("servers")}>
            서버 목록으로
          </Button>
        </div>
      ) : (
        <>
          <div className="flex h-10 shrink-0 items-stretch border-b border-line bg-chrome">
            <div className="flex min-w-0 flex-1 overflow-x-auto">
              {tabs.map((t, i) => (
                <div
                  key={t.key}
                  onClick={() => setActive(t.key)}
                  title={`${t.subtitle}${i < 8 ? ` · ⌘${i + 1}` : ""}`}
                  className={`group relative flex max-w-64 shrink-0 cursor-default items-center gap-2 border-r border-line px-3 text-sm ${
                    t.key === activeKey ? "bg-surface text-fg" : "text-fg-muted hover:bg-muted"
                  }`}
                >
                  {t.key === activeKey && (
                    <span className={`absolute inset-x-0 top-0 h-0.5 ${t.production ? "bg-red-500" : "bg-brand-600"}`} />
                  )}
                  <span className={`h-2 w-2 shrink-0 rounded-full ${dot[t.status]}`} />
                  <span className="truncate">{t.title}</span>
                  {t.production && (
                    <span className="rounded bg-red-600 px-1 text-[10px] font-bold leading-4 text-white">운영</span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(t.key);
                    }}
                    className="rounded p-0.5 text-fg-subtle opacity-0 hover:bg-muted hover:text-fg group-hover:opacity-100"
                    aria-label="탭 닫기"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {active && (
            <div
              className={`flex h-8 shrink-0 items-center gap-3 border-b px-3 text-xs ${
                active.production
                  ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
                  : "border-line bg-surface text-fg-muted"
              }`}
            >
              {active.production && (
                <span className="flex items-center gap-1 font-semibold">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  운영 서버입니다. 명령을 실행하기 전에 대상을 다시 확인하세요.
                </span>
              )}
              <span className="font-mono">{active.subtitle}</span>
              <span className="ml-auto">
                {statusLabel[active.status]}
                {active.status === "closed" && active.exitCode !== null ? ` (코드 ${active.exitCode})` : ""}
              </span>
              <button
                onClick={() => resetTerminal(active.key)}
                title="원격 출력 때문에 글자가 깨지거나 화면이 이상할 때 터미널을 처음 상태로 되돌립니다. 연결은 유지됩니다."
                className="flex items-center gap-1 rounded px-2 py-0.5 hover:bg-muted hover:text-fg"
              >
                <Eraser className="h-3.5 w-3.5" />
                화면 초기화
              </button>
              {active.status === "closed" && (
                <button
                  onClick={() => reconnect(active.key)}
                  title="재접속 (⌘R)"
                  className="flex items-center gap-1 rounded px-2 py-0.5 font-medium text-brand-600 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-950"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                  재접속
                </button>
              )}
            </div>
          )}

          <div className={`relative min-h-0 flex-1 ${active?.production ? "border-l-4 border-red-500" : ""}`}>
            {active?.status === "closed" && active.diagnosis && (
              <DiagnosisPanel
                diagnosis={active.diagnosis}
                onReconnect={() => reconnect(active.key)}
                onDismiss={() => updateTab(active.key, { diagnosis: null })}
              />
            )}
            {tabs.map((t) => (
              <TerminalView key={t.key} termKey={t.key} active={visible && t.key === activeKey} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
