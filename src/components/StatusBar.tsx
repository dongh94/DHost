import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { api, type EngineInfo } from "../lib/api";
import { useSessions } from "../stores/sessions";
import { useUpdate } from "../stores/update";

/** 하단 상태바: SSH 엔진 상태와 세션 수 */
export function StatusBar() {
  const [engine, setEngine] = useState<EngineInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tabs = useSessions((s) => s.tabs);
  const connected = tabs.filter((t) => t.status === "connected").length;
  const update = useUpdate((s) => (s.status === "available" || s.status === "error" ? s.info : null));
  const openUpdate = useUpdate((s) => s.openDialog);
  const version = useUpdate((s) => s.currentVersion);

  useEffect(() => {
    if (!isTauri()) {
      setError("브라우저 미리보기: 백엔드 없음 (pnpm tauri dev로 실행)");
      return;
    }
    api.sshEngineInfo().then(setEngine).catch((e) => setError(String(e)));
  }, []);

  const ok = engine?.supported && !error;
  const label = error ?? (engine ? `OpenSSH 사용 가능 · ${engine.version.split(",")[0]}` : "SSH 엔진 확인 중…");

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-line bg-chrome px-3 text-xs text-fg-muted">
      <span className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-500" : error ? "bg-red-500" : "bg-amber-400"}`} />
        {engine && !engine.supported ? `${label} (지원하지 않는 버전, 8.5 이상 필요)` : label}
      </span>
      {update && (
        <button
          onClick={openUpdate}
          className="ml-auto rounded-full bg-brand-600 px-2 py-0.5 font-medium text-white hover:bg-brand-700"
        >
          새 버전 {update.version} 업데이트
        </button>
      )}
      <span className={update ? "" : "ml-auto"}>
        세션 {connected}개 연결됨{tabs.length > connected ? ` · 끊김 ${tabs.length - connected}개` : ""}
      </span>
      {version && (
        <span className="border-l border-line pl-3 font-mono text-fg-subtle" title="DHost 버전">
          v{version}
        </span>
      )}
    </footer>
  );
}
