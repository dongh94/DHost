import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Download, ShieldAlert, Upload } from "lucide-react";
import { api, type BackupPreview, type RestoreOptions, type RestoreReport } from "../lib/api";
import { useCatalog } from "../stores/catalog";
import { useSettings } from "../stores/settings";
import { Button, Modal } from "./ui";

const FILTERS = [{ name: "DHost 백업", extensions: ["dhost-backup"] }];

function today() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/** 설정 화면의 백업·복원 (POL-05, FUN-12). 비밀번호·개인키·접속 이력은 백업하지 않는다. */
export function BackupSection() {
  const [includeHostKeys, setIncludeHostKeys] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restore, setRestore] = useState<{ path: string; preview: BackupPreview } | null>(null);

  const doExport = async () => {
    setError(null);
    setNotice(null);
    try {
      const path = await save({ defaultPath: `DHost-${today()}.dhost-backup`, filters: FILTERS });
      if (!path) return;
      const n = await api.backupExport(path, includeHostKeys);
      setNotice(`서버 ${n}개를 백업했습니다: ${path}`);
    } catch (e) {
      setError(String(e));
    }
  };

  const doOpen = async () => {
    setError(null);
    setNotice(null);
    try {
      const path = await open({ multiple: false, directory: false, filters: FILTERS });
      if (!path || Array.isArray(path)) return;
      setRestore({ path, preview: await api.backupPreview(path) });
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="border-b border-line px-5 py-4">
        <h2 className="text-sm font-semibold text-fg">백업 및 복원</h2>
        <p className="mt-0.5 text-xs text-fg-muted">
          고객사·폴더·서버 목록과 설정을 파일로 저장합니다. <b>비밀번호, 개인키, 접속 이력은 넣지 않습니다.</b>
        </p>
      </div>
      <div className="space-y-3 px-5 py-4">
        <p className="flex items-start gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          백업 파일에는 서버 주소와 계정 이름이 들어 있습니다. 공유 폴더나 메신저에 올리지 말고 안전한 곳에 보관하세요.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={doExport}>
            <Download className="h-4 w-4" />
            백업 파일 만들기
          </Button>
          <label className="flex items-center gap-1.5 text-xs text-fg-muted">
            <input type="checkbox" checked={includeHostKeys} onChange={(e) => setIncludeHostKeys(e.target.checked)} />
            신뢰한 호스트 키 포함 (새 Mac에서 다시 승인하지 않아도 됨)
          </label>
          <div className="flex-1" />
          <Button onClick={doOpen}>
            <Upload className="h-4 w-4" />
            백업에서 복원
          </Button>
        </div>
        {notice && <p className="break-all text-xs text-emerald-700 dark:text-emerald-400">{notice}</p>}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
      {restore && (
        <RestoreDialog
          path={restore.path}
          preview={restore.preview}
          onClose={() => setRestore(null)}
          onDone={(r) =>
            setNotice(
              `복원했습니다: 서버 ${r.servers}개, 고객사 ${r.customers}개, 폴더 ${r.folders}개, 호스트 키 ${r.hostKeys}개, 설정 ${r.settings}개` +
                (r.skipped.length ? ` · 건너뜀 ${r.skipped.length}개` : ""),
            )
          }
        />
      )}
    </div>
  );
}

function RestoreDialog({
  path,
  preview: p,
  onClose,
  onDone,
}: {
  path: string;
  preview: BackupPreview;
  onClose: () => void;
  onDone: (r: RestoreReport) => void;
}) {
  const [opts, setOpts] = useState<RestoreOptions>({ mode: "merge", hostKeys: true, settings: true });
  const [report, setReport] = useState<RestoreReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const replace = opts.mode === "replace";

  if (report) {
    return (
      <Modal title="복원 결과" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>확인</Button>}>
        <div className="space-y-2 text-sm">
          <p className="text-fg">
            서버 {report.servers}개, 고객사 {report.customers}개, 폴더 {report.folders}개, 호스트 키 {report.hostKeys}개,
            설정 {report.settings}개를 복원했습니다. 자동으로 접속하지 않습니다.
          </p>
          {report.skipped.length > 0 && (
            <ul className="max-h-48 space-y-0.5 overflow-auto text-xs text-fg-muted">
              {report.skipped.map((m, i) => (
                <li key={i}>· {m}</li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="백업에서 복원"
      onClose={onClose}
      tone={replace ? "danger" : undefined}
      footer={
        <>
          <Button autoFocus onClick={onClose}>
            취소
          </Button>
          <Button
            variant={replace ? "danger" : "primary"}
            onClick={async () => {
              try {
                const r = await api.backupRestore(path, opts);
                await useCatalog.getState().reload();
                await useSettings.getState().load();
                setReport(r);
                onDone(r);
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            {replace ? "지우고 복원" : "복원"}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="rounded-md border border-line bg-canvas p-3 text-xs text-fg-muted">
          <div className="break-all font-mono text-fg">{path}</div>
          <div className="mt-1">
            {new Date(p.exportedAt * 1000).toLocaleString("ko-KR")}에 DHost {p.appVersion}에서 만든 백업 · 서버 {p.servers}개
            (운영 {p.productionServers}개) · 고객사 {p.customers}개 · 폴더 {p.folders}개 · 호스트 키 {p.hostKeys}개 · 설정{" "}
            {p.settings}개
          </div>
        </div>

        <fieldset className="space-y-2">
          <label className="flex items-start gap-2">
            <input type="radio" className="mt-1" checked={!replace} onChange={() => setOpts({ ...opts, mode: "merge" })} />
            <span>
              <span className="font-medium text-fg">기존 목록에 합치기</span>
              <span className="block text-xs text-fg-muted">
                같은 주소·포트·사용자의 서버는 건너뜁니다{p.duplicates ? ` (${p.duplicates}개)` : ""}. 이름이 같은 고객사·폴더는
                합칩니다.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" className="mt-1" checked={replace} onChange={() => setOpts({ ...opts, mode: "replace" })} />
            <span>
              <span className="font-medium text-fg">전체 교체</span>
              <span className="block text-xs text-fg-muted">
                지금 있는 고객사·폴더·서버를 모두 지우고 백업 내용으로 바꿉니다.
                {replace && <b className="block text-red-600">키체인에 저장한 서버 비밀번호도 함께 지워집니다.</b>}
              </span>
            </span>
          </label>
        </fieldset>

        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={opts.hostKeys}
              disabled={p.hostKeys === 0}
              onChange={(e) => setOpts({ ...opts, hostKeys: e.target.checked })}
            />
            호스트 키 {p.hostKeys}개 가져오기
            <span className="text-xs text-fg-muted">(이미 다른 키를 신뢰하는 호스트는 덮어쓰지 않음)</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={opts.settings}
              disabled={p.settings === 0}
              onChange={(e) => setOpts({ ...opts, settings: e.target.checked })}
            />
            설정 {p.settings}개 적용
          </label>
        </div>

        {p.problems.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <div className="mb-1 font-semibold">복원하지 않는 항목 {p.problems.length}개</div>
            <ul className="max-h-32 space-y-0.5 overflow-auto">
              {p.problems.map((m, i) => (
                <li key={i}>· {m}</li>
              ))}
            </ul>
          </div>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}
