import { CircleAlert, RotateCw, X } from "lucide-react";
import type { Diagnosis } from "../lib/api";
import { Badge, Button } from "./ui";

/** 연결 실패 원인과 해결 방법 (FUN-16). 터미널 위에 띄운다. */
export function DiagnosisPanel({
  diagnosis: d,
  onReconnect,
  onDismiss,
}: {
  diagnosis: Diagnosis;
  onReconnect: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="absolute inset-x-0 top-0 z-10 flex justify-center p-4">
      <div className="w-full max-w-xl rounded-lg border border-red-200 bg-surface shadow-xl dark:border-red-900">
        <div className="flex items-start gap-3 p-4">
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-fg">{d.title}</h3>
              {d.hop && <Badge tone="danger">{d.hop}</Badge>}
            </div>
            <p className="break-words font-mono text-xs text-fg-muted">{d.detail}</p>
            {d.hints.length > 0 && (
              <ul className="space-y-1 text-sm text-fg">
                {d.hints.map((h, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="text-fg-subtle">·</span>
                    {h}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button onClick={onDismiss} className="rounded p-1 text-fg-subtle hover:bg-muted hover:text-fg" aria-label="닫기">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex justify-end gap-2 border-t border-line bg-canvas px-4 py-2.5">
          <Button onClick={onDismiss}>터미널 보기</Button>
          <Button variant="primary" onClick={onReconnect}>
            <RotateCw className="h-4 w-4" />
            재접속
          </Button>
        </div>
      </div>
    </div>
  );
}
