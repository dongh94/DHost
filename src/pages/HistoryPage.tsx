import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { History, Trash2 } from "lucide-react";
import { api, reasonLabels, type HistoryEntry, type HistoryResult } from "../lib/api";
import { useUi } from "../stores/ui";
import { Badge, Button, PageHeader } from "../components/ui";
import { fullTime, shortTime } from "../lib/format";
import { ConfirmDialog } from "../components/dialogs";

const results: Record<HistoryResult, { label: string; tone: "neutral" | "danger" | "brand" }> = {
  connecting: { label: "연결 중", tone: "brand" },
  closed: { label: "정상 종료", tone: "neutral" },
  auth_failed: { label: "인증 실패", tone: "danger" },
  hostkey_rejected: { label: "호스트 키 거절", tone: "danger" },
  hostkey_changed: { label: "키 변경 차단", tone: "danger" },
  cancelled: { label: "취소", tone: "neutral" },
  error: { label: "연결 오류", tone: "danger" },
  interrupted: { label: "앱 종료로 중단", tone: "neutral" },
};

function duration(e: HistoryEntry) {
  if (!e.endedAt) return "—";
  const s = e.endedAt - e.startedAt;
  if (s < 60) return `${s}초`;
  if (s < 3600) return `${Math.floor(s / 60)}분`;
  return `${Math.floor(s / 3600)}시간 ${Math.floor((s % 3600) / 60)}분`;
}

/** 접속 이력 (FUN-15). 명령과 출력은 기록하지 않는다. */
export function HistoryPage() {
  const [items, setItems] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const search = useUi((s) => s.search).trim().toLowerCase();

  const load = async () => {
    if (!isTauri()) return setError("브라우저 미리보기에서는 저장소를 쓸 수 없습니다");
    try {
      setItems(await api.historyList());
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const visible = search
    ? items.filter((e) => [e.title, e.target, e.via ?? ""].join(" ").toLowerCase().includes(search))
    : items;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="접속 이력"
        description="언제 어느 서버에 접속했는지와 결과만 30일 동안 보관합니다. 입력한 명령과 출력은 기록하지 않습니다."
      />
      <div className="flex flex-wrap items-center gap-2 px-6 pb-3">
        <span className="text-xs text-fg-subtle">
          {search ? `“${search}” 검색 결과 ${visible.length}건` : `최근 30일 ${items.length}건`}
        </span>
        <div className="ml-auto flex gap-2">
          <Button onClick={() => setConfirmClear(true)} disabled={items.length === 0}>
            <Trash2 className="h-4 w-4" />
            전체 삭제
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
        {error ? (
          <div className="rounded-lg border border-line bg-surface p-8 text-center text-sm text-fg-muted">{error}</div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line bg-surface p-12 text-center">
            <History className="h-8 w-8 text-fg-subtle" />
            <p className="text-sm text-fg-muted">{search ? "검색 결과가 없습니다." : "아직 접속 기록이 없습니다."}</p>
          </div>
        ) : (
          // 표 폭이 좁으면 경유·접속 시간·원인 글자를 숨기고 한 줄을 유지한다. 숨긴 값은 행에 마우스를 올리면 보인다.
          <div className="@container overflow-hidden rounded-lg border border-line bg-surface">
            <table className="w-full whitespace-nowrap text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-fg-subtle">
                  <th className="py-2 pl-4 font-medium">시작</th>
                  <th className="py-2 pl-3 font-medium">서버</th>
                  <th className="py-2 pl-3 font-medium">대상</th>
                  <th className="py-2 pl-3 font-medium @max-3xl:hidden">경유</th>
                  <th className="py-2 pl-3 font-medium">결과</th>
                  <th className="py-2 pl-3 pr-4 text-right font-medium @max-3xl:hidden">접속 시간</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => {
                  const r = results[e.result] ?? { label: e.result, tone: "neutral" as const };
                  const reason =
                    e.reason && !["hostkey_rejected", "hostkey_changed"].includes(e.reason)
                      ? (reasonLabels[e.reason] ?? e.reason)
                      : null;
                  return (
                    <tr
                      key={e.id}
                      className="border-b border-line last:border-0 hover:bg-canvas"
                      title={`${e.via ? `${e.via} 경유 · ` : ""}접속 시간 ${duration(e)}${reason ? ` · ${reason}` : ""}`}
                    >
                      <td className="py-2 pl-4 text-xs text-fg-muted" title={fullTime(e.startedAt)}>
                        {shortTime(e.startedAt)}
                      </td>
                      <td className="py-2 pl-3 font-medium text-fg">
                        <span className="block max-w-[12rem] truncate" title={e.title}>
                          {e.title}
                        </span>
                      </td>
                      <td className="w-full max-w-0 py-2 pl-3 font-mono text-xs text-fg-muted">
                        <span className="block truncate" title={e.target}>
                          {e.target}
                        </span>
                      </td>
                      <td className="py-2 pl-3 text-xs text-fg-muted @max-3xl:hidden">
                        <span className="block max-w-[10rem] truncate" title={e.via ?? undefined}>
                          {e.via ?? "—"}
                        </span>
                      </td>
                      <td className="py-2 pl-3">
                        <span className="flex items-center gap-1.5" title={reason ? `${r.label} · ${reason}` : r.label}>
                          <Badge tone={r.tone}>{r.label}</Badge>
                          {reason && <span className="text-xs text-fg-muted @max-3xl:hidden">{reason}</span>}
                        </span>
                      </td>
                      <td className="py-2 pl-3 pr-4 text-right text-xs text-fg-muted @max-3xl:hidden">{duration(e)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {confirmClear && (
        <ConfirmDialog
          title="접속 이력 삭제"
          message="모든 접속 이력을 지웁니다. 서버 목록과 호스트 키는 그대로 남습니다."
          onClose={() => setConfirmClear(false)}
          onConfirm={async () => {
            await api.historyClear();
            await load();
          }}
        />
      )}
    </div>
  );
}
