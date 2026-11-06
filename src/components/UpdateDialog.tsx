import { Download, RotateCw } from "lucide-react";
import { useSessions } from "../stores/sessions";
import { useUpdate } from "../stores/update";
import { Button, Modal } from "./ui";

function mb(n: number) {
  return `${(n / 1_000_000).toFixed(1)}MB`;
}

/** 새 버전 안내와 설치 진행. 설치하면 앱이 다시 시작되어 열린 세션이 끊긴다. */
export function UpdateDialog() {
  const { dialogOpen, status, info, currentVersion, progress, error, install, closeDialog } = useUpdate();
  const openSessions = useSessions((s) => s.tabs.filter((t) => t.status !== "closed").length);
  if (!dialogOpen || !info) return null;

  const busy = status === "downloading" || status === "installing";
  const pct = progress?.total ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100)) : null;

  return (
    <Modal
      title="새 버전이 있습니다"
      onClose={busy ? undefined : closeDialog}
      footer={
        busy ? undefined : (
          <>
            <Button autoFocus onClick={closeDialog}>
              나중에
            </Button>
            <Button variant={openSessions ? "danger" : "primary"} onClick={() => void install()}>
              <Download className="h-4 w-4" />
              업데이트하고 다시 시작
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-fg">
          <span className="font-mono">{currentVersion ?? "?"}</span> → <b className="font-mono">{info.version}</b>
          {info.date && (
            <span className="ml-2 text-xs text-fg-muted">{new Date(info.date).toLocaleDateString("ko-KR")} 배포</span>
          )}
        </p>
        {info.notes && (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-canvas p-3 font-sans text-xs text-fg">
            {info.notes}
          </pre>
        )}
        {openSessions > 0 && !busy && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            열린 세션 {openSessions}개가 끊깁니다. 실행 중인 작업을 먼저 마무리하세요.
          </p>
        )}
        {busy && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-fg">
              <RotateCw className="h-4 w-4 animate-spin" />
              {status === "downloading" ? "내려받는 중…" : "설치하고 다시 시작하는 중…"}
              {progress && status === "downloading" && (
                <span className="ml-auto font-mono text-xs text-fg-muted">
                  {mb(progress.downloaded)}
                  {progress.total ? ` / ${mb(progress.total)}` : ""}
                </span>
              )}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full bg-brand-600 transition-all ${pct === null ? "w-1/3 animate-pulse" : ""}`}
                style={pct === null ? undefined : { width: `${pct}%` }}
              />
            </div>
          </div>
        )}
        {status === "error" && error && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
            <p className="font-medium">업데이트하지 못했습니다. {error.message}</p>
            <details className="mt-1">
              <summary className="cursor-pointer text-red-600/80">자세한 오류 (관리자에게 전달)</summary>
              <code className="mt-1 block break-all font-mono select-text">{error.detail}</code>
            </details>
          </div>
        )}
        <p className="text-xs text-fg-muted">서버 목록, 설정, 저장한 비밀번호는 그대로 유지됩니다.</p>
      </div>
    </Modal>
  );
}
