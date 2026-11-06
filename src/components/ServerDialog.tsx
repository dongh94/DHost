import { useEffect, useMemo, useState, type FormEvent } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { KeyRound, ListTree, Plus } from "lucide-react";
import { api, type Server, type ServerInput } from "../lib/api";
import { useCatalog } from "../stores/catalog";
import { Button, Field, Input, Modal, Select, inputCls } from "./ui";
import { NameDialog } from "./dialogs";
import { EffectiveConfigDialog } from "./ImportDialogs";

const empty: ServerInput = {
  name: "",
  host: "",
  port: 22,
  username: "",
  customerId: null,
  folderId: null,
  jumpServerId: null,
  isProduction: false,
  favorite: false,
  note: "",
};

/** 서버 등록·수정 (FUN-01) */
export function ServerDialog({
  server,
  defaults,
  onClose,
}: {
  server?: Server;
  defaults?: Partial<ServerInput>;
  onClose: () => void;
}) {
  const { customers, folders, servers, reload } = useCatalog();
  const [v, setV] = useState<ServerInput>(() => (server ? { ...server } : { ...empty, ...defaults }));
  const [port, setPort] = useState(String(v.port));
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<"customer" | "folder" | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  useEffect(() => {
    if (server && isTauri()) api.serverPasswordSaved(server.id).then(setPasswordSaved).catch(() => {});
  }, [server]);
  const targetChanged =
    !!server && (v.host !== server.host || Number(port) !== server.port || v.username !== server.username);

  const set = <K extends keyof ServerInput>(k: K, val: ServerInput[K]) => setV((p) => ({ ...p, [k]: val }));
  const customerFolders = folders.filter((f) => f.customerId === v.customerId);
  // 경유 서버 후보: 자기 자신과, 이미 다른 서버를 경유하는 서버는 제외 (단일 Jump Host)
  const jumpCandidates = useMemo(
    () => servers.filter((s) => s.id !== server?.id && !s.jumpServerId),
    [servers, server],
  );
  const usedAsJump = !!server && servers.some((s) => s.jumpServerId === server.id);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const input = { ...v, port: Number(port) };
    try {
      if (server) await api.serverUpdate(server.id, input);
      else await api.serverCreate(input);
      await reload();
      onClose();
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <>
      <Modal title={server ? "서버 편집" : "서버 추가"} onClose={onClose}>
        <form id="server-form" onSubmit={submit} className="space-y-4">
          <Field label="이름">
            <Input autoFocus value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="예: web-01" required />
          </Field>

          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <Field label="호스트">
              <Input value={v.host} onChange={(e) => set("host", e.target.value.trim())} placeholder="192.0.2.10 또는 host.example.com" required />
            </Field>
            <Field label="포트">
              <Input value={port} inputMode="numeric" onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} required />
            </Field>
          </div>
          <Field label="사용자">
            <Input value={v.username} onChange={(e) => set("username", e.target.value.trim())} placeholder="예: ops" required />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="고객사">
              <div className="flex gap-1">
                <Select
                  value={v.customerId ?? ""}
                  onChange={(e) => setV((p) => ({ ...p, customerId: e.target.value || null, folderId: null }))}
                >
                  <option value="">미분류</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                <Button type="button" className="px-2" title="고객사 추가" onClick={() => setAdding("customer")}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </Field>
            <Field label="폴더">
              <div className="flex gap-1">
                <Select
                  value={v.folderId ?? ""}
                  disabled={!v.customerId}
                  onChange={(e) => set("folderId", e.target.value || null)}
                >
                  <option value="">없음</option>
                  {customerFolders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
                <Button
                  type="button"
                  className="px-2"
                  title="폴더 추가"
                  disabled={!v.customerId}
                  onClick={() => setAdding("folder")}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </Field>
          </div>

          <Field
            label="Jump Host 경유"
            hint={usedAsJump ? "다른 서버의 경유 서버로 쓰이고 있어서 경유를 설정할 수 없습니다." : "경유 서버도 등록된 서버 중에서 고릅니다. 한 단계만 지원합니다."}
          >
            <Select
              value={v.jumpServerId ?? ""}
              disabled={usedAsJump}
              onChange={(e) => set("jumpServerId", e.target.value || null)}
            >
              <option value="">직접 연결</option>
              {jumpCandidates.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.username}@{s.host}:{s.port})
                </option>
              ))}
            </Select>
          </Field>

          <label className="flex items-start gap-2 rounded-md border border-line p-3">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={v.isProduction}
              onChange={(e) => set("isProduction", e.target.checked)}
            />
            <span>
              <span className="block text-sm font-medium text-fg">운영 서버</span>
              <span className="block text-xs text-fg-muted">탭과 터미널에 빨간색으로 표시해 실수를 막습니다.</span>
            </span>
          </label>

          {server && passwordSaved && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-line p-3">
              <span className="flex items-center gap-2 text-sm text-fg">
                <KeyRound className="h-4 w-4 text-fg-subtle" />
                {targetChanged
                  ? "접속 대상이 바뀌어 저장하면 키체인의 비밀번호가 지워집니다."
                  : "비밀번호가 macOS 키체인에 저장되어 있습니다."}
              </span>
              {!targetChanged && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={async () => {
                    await api.serverPasswordDelete(server.id);
                    setPasswordSaved(false);
                  }}
                >
                  삭제
                </Button>
              )}
            </div>
          )}

          <Field label="메모">
            <textarea
              className={`${inputCls} h-16 resize-none`}
              value={v.note}
              maxLength={2000}
              onChange={(e) => set("note", e.target.value)}
              placeholder="비밀번호나 키는 적지 마세요"
            />
          </Field>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </form>
        <div className="-mx-5 -mb-4 mt-4 flex justify-end gap-2 border-t border-line bg-canvas px-5 py-3">
          {server && (
            <Button type="button" variant="ghost" className="mr-auto" onClick={() => setShowConfig(true)}>
              <ListTree className="h-4 w-4" />
              실제 적용값 보기
            </Button>
          )}
          <Button type="button" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" form="server-form" variant="primary">
            저장
          </Button>
        </div>
      </Modal>

      {showConfig && server && (
        <EffectiveConfigDialog serverId={server.id} name={server.name} onClose={() => setShowConfig(false)} />
      )}
      {adding === "customer" && (
        <NameDialog
          title="고객사 추가"
          label="고객사 이름"
          onClose={() => setAdding(null)}
          onSubmit={async (name) => {
            const c = await api.customerCreate(name);
            await reload();
            setV((p) => ({ ...p, customerId: c.id, folderId: null }));
          }}
        />
      )}
      {adding === "folder" && v.customerId && (
        <NameDialog
          title="폴더 추가"
          label="폴더 이름"
          onClose={() => setAdding(null)}
          onSubmit={async (name) => {
            const f = await api.folderCreate(v.customerId!, name);
            await reload();
            set("folderId", f.id);
          }}
        />
      )}
    </>
  );
}
