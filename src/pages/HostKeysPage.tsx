import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { KeyRound, Trash2 } from "lucide-react";
import { api, type HostKey } from "../lib/api";
import { IconButton, PageHeader } from "../components/ui";
import { ConfirmDialog } from "../components/dialogs";

/** 사용자가 승인한 호스트 키 목록. 키가 바뀐 서버는 관리자 확인 후 여기서 기존 키를 지운다. */
export function HostKeysPage() {
  const [keys, setKeys] = useState<HostKey[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<HostKey | null>(null);

  const load = async () => {
    if (!isTauri()) return setError("브라우저 미리보기에서는 저장소를 쓸 수 없습니다");
    try {
      setKeys(await api.hostKeyList());
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="호스트 키"
        description="접속할 때 직접 승인한 서버의 호스트 키입니다. 저장된 키와 다른 키를 보내는 서버에는 연결하지 않습니다."
      />
      <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
        {error ? (
          <div className="rounded-lg border border-line bg-surface p-8 text-center text-sm text-fg-muted">{error}</div>
        ) : keys.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line bg-surface p-12 text-center">
            <KeyRound className="h-8 w-8 text-fg-subtle" />
            <p className="text-sm text-fg-muted">아직 승인한 호스트 키가 없습니다.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-fg-subtle">
                  <th className="py-2 pl-4 font-medium">호스트</th>
                  <th className="py-2 font-medium">종류</th>
                  <th className="py-2 font-medium">지문</th>
                  <th className="py-2 font-medium">승인일</th>
                  <th className="w-12 py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className="border-b border-line last:border-0 hover:bg-canvas">
                    <td className="py-2 pl-4 font-mono text-xs text-fg">{k.host}</td>
                    <td className="py-2 text-xs text-fg-muted">{k.keyType}</td>
                    <td className="py-2 font-mono text-xs text-fg-muted">{k.fingerprint}</td>
                    <td className="py-2 text-xs text-fg-muted">{new Date(k.addedAt * 1000).toLocaleString("ko-KR")}</td>
                    <td className="py-2 pr-3">
                      <IconButton label="삭제" tone="danger" onClick={() => setRemoving(k)}>
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {removing && (
        <ConfirmDialog
          title="호스트 키 삭제"
          message={`${removing.host}의 키를 삭제하면 다음 접속 때 다시 승인해야 합니다. 키가 바뀐 이유를 서버 관리자에게 확인한 뒤에만 삭제하세요.`}
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await api.hostKeyDelete(removing.id);
            await load();
          }}
        />
      )}
    </div>
  );
}
