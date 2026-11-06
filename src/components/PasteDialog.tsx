import { AlertTriangle, ShieldAlert } from "lucide-react";
import { commitPaste, focusTerminal } from "../lib/connect";
import { stripControls, stripTrailingNewline, visualize, type PasteAnalysis } from "../lib/paste";
import { useSessions } from "../stores/sessions";
import { Button, Modal } from "./ui";

const PREVIEW_LINES = 12;

/** 위험 신호가 있는 붙여넣기를 보내기 전에 확인한다 (FUN-08, SEC-05). 기본 선택은 취소다. */
export function PasteDialog({
  tabKey,
  text,
  analysis: a,
  onDone,
}: {
  tabKey: string;
  text: string;
  analysis: PasteAnalysis;
  onDone: () => void;
}) {
  const tab = useSessions((s) => s.tabs.find((t) => t.key === tabKey));
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  const shown = lines.slice(0, PREVIEW_LINES);
  const hidden = lines.length - shown.length;
  const hasControls = a.controls.length > 0;

  const finish = (value: string | null) => {
    if (value !== null) commitPaste(tabKey, value);
    else focusTerminal(tabKey);
    onDone();
  };

  return (
    <Modal title="붙여넣기 전에 확인하세요" onClose={() => finish(null)} width="max-w-2xl" tone={tab?.production ? "danger" : undefined}>
      <div className="space-y-3 text-sm">
        {tab?.production && (
          <p className="flex items-center gap-1.5 rounded-md bg-red-50 px-3 py-2 font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            운영 서버 <b>{tab.title}</b>에 붙여넣습니다.
          </p>
        )}
        <ul className="space-y-1">
          {a.hasNewline && (
            <li className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              {a.onlyTrailingNewline
                ? "끝에 줄바꿈이 있어서 붙여넣자마자 명령이 실행됩니다."
                : `${a.lines}줄입니다. 붙여넣는 즉시 여러 명령이 차례로 실행될 수 있습니다.`}
            </li>
          )}
          {hasControls && (
            <li className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <span>
                보이지 않는 제어문자가 있습니다: {a.controls.map((c) => `${c.name} ×${c.count}`).join(", ")}
                {a.bracketEscape && (
                  <b className="block text-red-600">붙여넣기 보호를 빠져나가는 시퀀스가 들어 있습니다. 그대로 보내지 마세요.</b>
                )}
              </span>
            </li>
          )}
          {a.large && (
            <li className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              {a.chars.toLocaleString()}자로 내용이 깁니다.
            </li>
          )}
        </ul>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md border border-line bg-canvas p-3 font-mono text-xs text-fg select-text">
          {shown.map((l, i) => (
            <div key={i} className="flex gap-3">
              <span className="w-6 shrink-0 select-none text-right text-fg-subtle">{i + 1}</span>
              <span>{visualize(l) || " "}</span>
            </div>
          ))}
          {hidden > 0 && <div className="pl-9 text-fg-subtle">… {hidden}줄 더 있음</div>}
        </pre>
      </div>
      <div className="-mx-5 -mb-4 mt-4 flex flex-wrap justify-end gap-2 border-t border-line bg-canvas px-5 py-3">
        <Button autoFocus onClick={() => finish(null)}>
          취소
        </Button>
        {a.onlyTrailingNewline && !hasControls && (
          <Button variant="primary" onClick={() => finish(stripTrailingNewline(text))}>
            줄바꿈 빼고 붙여넣기
          </Button>
        )}
        {hasControls && (
          <Button variant="primary" onClick={() => finish(stripControls(text))}>
            제어문자 지우고 붙여넣기
          </Button>
        )}
        <Button variant={hasControls || tab?.production ? "danger" : a.onlyTrailingNewline ? "secondary" : "primary"} onClick={() => finish(text)}>
          그대로 붙여넣기
        </Button>
      </div>
    </Modal>
  );
}
