import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  FolderClosed,
  FileDown,
  FileCode2,
  Archive,
  FolderPlus,
  Pencil,
  Play,
  Plus,
  Route,
  Star,
  Trash2,
  Zap,
} from "lucide-react";
import { api, type BackupPreview, type Server } from "../lib/api";
import { connectServer } from "../lib/connect";
import { useCatalog } from "../stores/catalog";
import { useSessions } from "../stores/sessions";
import { useUi } from "../stores/ui";
import { Badge, Button, DropdownButton, IconButton, Modal, PageHeader } from "../components/ui";
import { pickBackup, RestoreDialog } from "../components/BackupSection";
import { ServerDialog } from "../components/ServerDialog";
import { QuickConnectDialog } from "../components/QuickConnectDialog";
import { ConfirmDialog, NameDialog } from "../components/dialogs";
import { SshConfigImportDialog } from "../components/ImportDialogs";

type Filter = "all" | "favorite" | "production";

type Dialog =
  | { kind: "server"; server?: Server; customerId?: string | null; folderId?: string | null }
  | { kind: "quick" }
  | { kind: "importConfig" }
  | { kind: "restore"; path: string; preview: BackupPreview }
  | { kind: "error"; message: string }
  | { kind: "deleteServer"; server: Server }
  | { kind: "customer"; id?: string; name?: string }
  | { kind: "deleteCustomer"; id: string; name: string }
  | { kind: "folder"; customerId: string; id?: string; name?: string }
  | { kind: "deleteFolder"; id: string; name: string };

const rtf = new Intl.RelativeTimeFormat("ko", { numeric: "auto" });
function ago(ts: number | null) {
  if (!ts) return "—";
  const s = ts - Date.now() / 1000;
  const abs = Math.abs(s);
  if (abs < 60) return "방금";
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}

/** 서버 목록 (FUN-01, FUN-02): 고객사 > 폴더로 묶고 검색·즐겨찾기·운영 필터를 제공한다. */
export function ServersPage() {
  const { customers, folders, servers, loaded, error, reload } = useCatalog();
  const search = useUi((s) => s.search).trim().toLowerCase();
  const [filter, setFilter] = useState<Filter>("all");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const tabs = useSessions((s) => s.tabs);
  const connectedIds = useMemo(
    () =>
      new Set(
        tabs.filter((t) => t.status === "connected" && t.source.type === "server").map((t) =>
          t.source.type === "server" ? t.source.serverId : "",
        ),
      ),
    [tabs],
  );

  const byId = useMemo(() => new Map(servers.map((s) => [s.id, s])), [servers]);
  const customerName = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers]);
  const folderName = useMemo(() => new Map(folders.map((f) => [f.id, f.name])), [folders]);

  const visible = servers.filter((s) => {
    if (filter === "favorite" && !s.favorite) return false;
    if (filter === "production" && !s.isProduction) return false;
    if (!search) return true;
    const hay = [s.name, s.host, s.username, s.note, customerName.get(s.customerId ?? ""), folderName.get(s.folderId ?? "")]
      .join(" ")
      .toLowerCase();
    return hay.includes(search);
  });

  // 검색 중이거나 필터를 걸었을 때는 빈 고객사·폴더를 숨긴다.
  const narrowing = !!search || filter !== "all";
  const groups = [
    ...customers.map((c) => ({ id: c.id, name: c.name })),
    { id: "", name: "미분류" },
  ]
    .map((g) => {
      const mine = visible.filter((s) => (s.customerId ?? "") === g.id);
      const gFolders = g.id ? folders.filter((f) => f.customerId === g.id) : [];
      return {
        ...g,
        loose: mine.filter((s) => !s.folderId),
        folders: gFolders
          .map((f) => ({ ...f, servers: mine.filter((s) => s.folderId === f.id) }))
          .filter((f) => !narrowing || f.servers.length > 0),
        count: mine.length,
      };
    })
    .filter((g) => (g.id === "" ? g.count > 0 : !narrowing || g.count > 0));

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // 화면에 보이는 순서대로 검색창 ↑↓ 선택 대상을 알린다 (GAP-06).
  const ordered = groups.flatMap((g) =>
    collapsed.has(g.id || "none")
      ? []
      : [...g.folders.flatMap((f) => (collapsed.has(f.id) ? [] : f.servers.map((s) => s.id))), ...g.loose.map((s) => s.id)],
  );
  const orderedKey = ordered.join(",");
  const setResults = useUi((s) => s.setResults);
  useEffect(() => setResults(orderedKey ? orderedKey.split(",") : []), [orderedKey, setResults]);
  const selectedId = useUi((s) => (s.search.trim() ? s.results[s.cursor] : undefined));
  useEffect(() => {
    if (selectedId) document.getElementById(`server-row-${selectedId}`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const counts = {
    all: servers.length,
    favorite: servers.filter((s) => s.favorite).length,
    production: servers.filter((s) => s.isProduction).length,
  };

  const row = (s: Server, depth: number) => {
    const jump = s.jumpServerId ? byId.get(s.jumpServerId) : undefined;
    return (
      <tr
        key={s.id}
        id={`server-row-${s.id}`}
        onDoubleClick={() => connectServer(s)}
        aria-selected={s.id === selectedId}
        className={`group border-b border-line last:border-0 ${
          s.id === selectedId ? "bg-brand-50 dark:bg-brand-950" : "hover:bg-canvas"
        }`}
      >
        <td className="w-8 py-2 pl-3">
          <IconButton
            label={s.favorite ? "즐겨찾기 해제" : "즐겨찾기"}
            onClick={async () => {
              await api.serverSetFavorite(s.id, !s.favorite);
              await reload();
            }}
          >
            <Star className={`h-4 w-4 ${s.favorite ? "fill-amber-400 text-amber-400" : ""}`} />
          </IconButton>
        </td>
        <td className="py-2" style={{ paddingLeft: depth * 20 }}>
          <div className="flex items-center gap-2">
            <span
              title={connectedIds.has(s.id) ? "연결된 세션 있음" : "연결 안 됨"}
              className={`h-2 w-2 shrink-0 rounded-full ${connectedIds.has(s.id) ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"}`}
            />
            <span className="font-medium text-fg">{s.name}</span>
            {s.isProduction && <Badge tone="danger">운영</Badge>}
          </div>
          {s.note && <div className="ml-4 mt-0.5 max-w-md truncate text-xs text-fg-subtle">{s.note}</div>}
        </td>
        <td className="py-2 font-mono text-xs text-fg-muted">
          {s.username}@{s.host}:{s.port}
        </td>
        <td className="py-2 text-xs text-fg-muted">
          {jump ? (
            <span className="inline-flex items-center gap-1">
              <Route className="h-3.5 w-3.5" />
              {jump.name}
            </span>
          ) : (
            "—"
          )}
        </td>
        <td className="py-2 text-xs text-fg-muted">{ago(s.lastConnectedAt)}</td>
        <td className="w-32 py-2 pr-3">
          <div className="flex justify-end gap-0.5">
            <IconButton label="연결" tone="brand" onClick={() => connectServer(s)}>
              <Play className="h-4 w-4" />
            </IconButton>
            <IconButton label="편집" onClick={() => setDialog({ kind: "server", server: s })}>
              <Pencil className="h-4 w-4" />
            </IconButton>
            <IconButton label="삭제" tone="danger" onClick={() => setDialog({ kind: "deleteServer", server: s })}>
              <Trash2 className="h-4 w-4" />
            </IconButton>
          </div>
        </td>
      </tr>
    );
  };

  const groupRow = (opts: {
    id: string;
    icon: React.ReactNode;
    name: string;
    count: number;
    depth: number;
    actions?: React.ReactNode;
  }) => (
    <tr key={`g-${opts.id}`} className="group border-b border-line bg-canvas/60">
      <td colSpan={6} className="py-1.5 pl-3 pr-3" style={{ paddingLeft: 12 + opts.depth * 20 }}>
        <div className="flex items-center gap-1.5">
          <button onClick={() => toggle(opts.id)} className="flex items-center gap-1.5 text-sm font-semibold text-fg">
            {collapsed.has(opts.id) ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {opts.icon}
            {opts.name}
          </button>
          <span className="text-xs text-fg-subtle">{opts.count}</span>
          <div className="ml-auto flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">{opts.actions}</div>
        </div>
      </td>
    </tr>
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="서버"
        description="고객사와 폴더별로 서버를 관리합니다. 행을 더블클릭하거나 ▶를 누르면 연결합니다."
        actions={
          <>
            <DropdownButton
              label="가져오기"
              icon={<FileDown className="h-4 w-4" />}
              options={[
                {
                  label: "SSH 설정에서 가져오기",
                  description: "~/.ssh/config의 Host 항목을 서버로 추가",
                  icon: <FileCode2 className="h-4 w-4" />,
                  onSelect: () => setDialog({ kind: "importConfig" }),
                },
                {
                  label: "백업 파일에서 가져오기",
                  description: "DHost 백업(.dhost-backup)에서 복원",
                  icon: <Archive className="h-4 w-4" />,
                  onSelect: async () => {
                    try {
                      const picked = await pickBackup();
                      if (picked) setDialog({ kind: "restore", ...picked });
                    } catch (e) {
                      setDialog({ kind: "error", message: String(e) });
                    }
                  },
                },
              ]}
            />
            <Button onClick={() => setDialog({ kind: "customer" })}>
              <Building2 className="h-4 w-4" />
              고객사 추가
            </Button>
            <Button onClick={() => setDialog({ kind: "quick" })}>
              <Zap className="h-4 w-4" />
              빠른 접속
            </Button>
            <Button variant="primary" onClick={() => setDialog({ kind: "server" })}>
              <Plus className="h-4 w-4" />
              서버 추가
            </Button>
          </>
        }
      />

      <div className="flex items-center gap-1.5 px-6 pb-3">
        {(
          [
            ["all", "전체"],
            ["favorite", "즐겨찾기"],
            ["production", "운영"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              filter === k
                ? "border-brand-600 bg-brand-600 text-white"
                : "border-line bg-surface text-fg-muted hover:text-fg"
            }`}
          >
            {label} <span className="opacity-70">{counts[k]}</span>
          </button>
        ))}
        {search && <span className="ml-2 text-xs text-fg-subtle">“{search}” 검색 결과 {visible.length}개</span>}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
        {error ? (
          <div className="rounded-lg border border-line bg-surface p-8 text-center text-sm text-fg-muted">{error}</div>
        ) : loaded && servers.length === 0 && customers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line bg-surface p-12 text-center">
            <p className="text-sm font-medium text-fg">등록된 서버가 없습니다</p>
            <p className="mt-1 text-sm text-fg-muted">서버를 추가하거나 빠른 접속으로 바로 연결해 보세요.</p>
            <div className="mt-4 flex justify-center gap-2">
              <Button onClick={() => setDialog({ kind: "quick" })}>
                <Zap className="h-4 w-4" />
                빠른 접속
              </Button>
              <Button variant="primary" onClick={() => setDialog({ kind: "server" })}>
                <Plus className="h-4 w-4" />
                서버 추가
              </Button>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-medium text-fg-subtle">
                  <th className="w-8 py-2 pl-3" />
                  <th className="py-2 font-medium">이름</th>
                  <th className="py-2 font-medium">주소</th>
                  <th className="py-2 font-medium">경유</th>
                  <th className="py-2 font-medium">최근 접속</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <GroupRows key={g.id || "none"}>
                    {groupRow({
                      id: g.id || "none",
                      icon: <Building2 className="h-4 w-4 text-fg-subtle" />,
                      name: g.name,
                      count: g.count,
                      depth: 0,
                      actions: g.id ? (
                        <>
                          <IconButton label="서버 추가" onClick={() => setDialog({ kind: "server", customerId: g.id })}>
                            <Plus className="h-4 w-4" />
                          </IconButton>
                          <IconButton label="폴더 추가" onClick={() => setDialog({ kind: "folder", customerId: g.id })}>
                            <FolderPlus className="h-4 w-4" />
                          </IconButton>
                          <IconButton label="이름 변경" onClick={() => setDialog({ kind: "customer", id: g.id, name: g.name })}>
                            <Pencil className="h-4 w-4" />
                          </IconButton>
                          <IconButton
                            label="고객사 삭제"
                            tone="danger"
                            onClick={() => setDialog({ kind: "deleteCustomer", id: g.id, name: g.name })}
                          >
                            <Trash2 className="h-4 w-4" />
                          </IconButton>
                        </>
                      ) : undefined,
                    })}
                    {!collapsed.has(g.id || "none") && (
                      <>
                        {g.folders.map((f) => (
                          <GroupRows key={f.id}>
                            {groupRow({
                              id: f.id,
                              icon: <FolderClosed className="h-4 w-4 text-fg-subtle" />,
                              name: f.name,
                              count: f.servers.length,
                              depth: 1,
                              actions: (
                                <>
                                  <IconButton
                                    label="서버 추가"
                                    onClick={() => setDialog({ kind: "server", customerId: g.id, folderId: f.id })}
                                  >
                                    <Plus className="h-4 w-4" />
                                  </IconButton>
                                  <IconButton
                                    label="이름 변경"
                                    onClick={() => setDialog({ kind: "folder", customerId: g.id, id: f.id, name: f.name })}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </IconButton>
                                  <IconButton
                                    label="폴더 삭제"
                                    tone="danger"
                                    onClick={() => setDialog({ kind: "deleteFolder", id: f.id, name: f.name })}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </IconButton>
                                </>
                              ),
                            })}
                            {!collapsed.has(f.id) && f.servers.map((s) => row(s, 2))}
                          </GroupRows>
                        ))}
                        {g.loose.map((s) => row(s, g.id ? 1 : 1))}
                        {g.count === 0 && g.folders.length === 0 && (
                          <tr className="border-b border-line">
                            <td colSpan={6} className="py-2 pl-14 text-xs text-fg-subtle">
                              서버가 없습니다
                            </td>
                          </tr>
                        )}
                      </>
                    )}
                  </GroupRows>
                ))}
                {groups.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-sm text-fg-muted">
                      조건에 맞는 서버가 없습니다
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dialog?.kind === "server" && (
        <ServerDialog
          server={dialog.server}
          defaults={{ customerId: dialog.customerId ?? null, folderId: dialog.folderId ?? null }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "quick" && <QuickConnectDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === "importConfig" && <SshConfigImportDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === "restore" && (
        <RestoreDialog path={dialog.path} preview={dialog.preview} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "error" && (
        <Modal
          title="백업 파일을 열 수 없습니다"
          onClose={() => setDialog(null)}
          footer={<Button variant="primary" onClick={() => setDialog(null)}>확인</Button>}
        >
          <p className="break-all text-sm text-fg">{dialog.message}</p>
        </Modal>
      )}
      {dialog?.kind === "deleteServer" && (
        <ConfirmDialog
          title="서버 삭제"
          message={`'${dialog.server.name}' 서버를 삭제합니다. 저장된 호스트 키는 그대로 남습니다.`}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api.serverDelete(dialog.server.id);
            await reload();
          }}
        />
      )}
      {dialog?.kind === "customer" && (
        <NameDialog
          title={dialog.id ? "고객사 이름 변경" : "고객사 추가"}
          label="고객사 이름"
          initial={dialog.name}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            if (dialog.id) await api.customerRename(dialog.id, name);
            else await api.customerCreate(name);
            await reload();
          }}
        />
      )}
      {dialog?.kind === "deleteCustomer" && (
        <ConfirmDialog
          title="고객사 삭제"
          message={`'${dialog.name}' 고객사를 삭제합니다. 안에 서버나 폴더가 있으면 먼저 옮기거나 지워야 합니다.`}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api.customerDelete(dialog.id);
            await reload();
          }}
        />
      )}
      {dialog?.kind === "folder" && (
        <NameDialog
          title={dialog.id ? "폴더 이름 변경" : "폴더 추가"}
          label="폴더 이름"
          initial={dialog.name}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            if (dialog.id) await api.folderRename(dialog.id, name);
            else await api.folderCreate(dialog.customerId, name);
            await reload();
          }}
        />
      )}
      {dialog?.kind === "deleteFolder" && (
        <ConfirmDialog
          title="폴더 삭제"
          message={`'${dialog.name}' 폴더를 삭제합니다. 안에 서버가 있으면 먼저 옮기거나 지워야 합니다.`}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api.folderDelete(dialog.id);
            await reload();
          }}
        />
      )}
    </div>
  );
}

function GroupRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
