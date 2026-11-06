import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  FolderClosed,
  FileDown,
  FileUp,
  FileCode2,
  Archive,
  FolderPlus,
  KeyRound,
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
import { Badge, Button, DropdownButton, HoverLabel, IconButton, Modal, PageHeader } from "../components/ui";
import { ExportDialog, pickBackup, RestoreDialog } from "../components/BackupSection";
import { ServerDialog } from "../components/ServerDialog";
import { QuickConnectDialog } from "../components/QuickConnectDialog";
import { ConfirmDialog, NameDialog } from "../components/dialogs";
import { SshConfigImportDialog } from "../components/ImportDialogs";

type Filter = "all" | "favorite" | "production";

type Dialog =
  | { kind: "server"; server?: Server; customerId?: string | null; folderId?: string | null }
  | { kind: "quick" }
  | { kind: "importConfig" }
  | { kind: "export" }
  | { kind: "restore"; path: string; preview: BackupPreview }
  | { kind: "error"; message: string }
  | { kind: "deleteServer"; server: Server }
  | { kind: "customer"; id?: string; name?: string }
  | { kind: "deleteCustomer"; id: string; name: string }
  | { kind: "folder"; customerId: string; id?: string; name?: string }
  | { kind: "deleteFolder"; id: string; name: string };

/** 버튼 글자가 보이는 넓은 폭에서는 말풍선을 띄우지 않는다 (아이콘만 남았을 때만) */
const tipWhenCompact = "@min-[851px]:hidden";

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
        <td className="w-10 min-w-10 py-2 pl-3">
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
        {/* 이름 열이 남는 폭을 모두 쓰고, 넘치면 말줄임표로 자른다 (w-full + max-w-0) */}
        <td className="w-full max-w-0 py-2" style={{ paddingLeft: depth * 20 }}>
          <div className="flex min-w-0 items-center gap-2">
            <span
              title={connectedIds.has(s.id) ? "연결된 세션 있음" : "연결 안 됨"}
              className={`h-2 w-2 shrink-0 rounded-full ${connectedIds.has(s.id) ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"}`}
            />
            <span className="truncate font-medium text-fg" title={`${s.name} · 최근 접속 ${ago(s.lastConnectedAt)}`}>
              {s.name}
            </span>
            {s.isProduction && <Badge tone="danger">운영</Badge>}
          </div>
          {s.note && (
            <div className="ml-4 mt-0.5 truncate text-xs text-fg-subtle" title={s.note}>
              {s.note}
            </div>
          )}
        </td>
        <td className="py-2 pl-3 font-mono text-xs text-fg-muted">
          <span className="flex items-center gap-1">
            <span
              className="block max-w-[18rem] truncate @max-3xl:max-w-[13rem]"
              title={`${s.username}@${s.host}:${s.port}`}
            >
              {s.username}@{s.host}:{s.port}
            </span>
            {s.identityFile && (
              <span title={`개인키: ${s.identityFile}`} className="shrink-0 text-fg-subtle">
                <KeyRound className="h-3.5 w-3.5" />
              </span>
            )}
            {/* 좁은 폭: 경유 열 대신 주소 옆에 짧게 (한 줄 유지) */}
            {jump && (
              <span
                className="flex min-w-0 items-center gap-0.5 font-sans text-fg-subtle @3xl:hidden"
                title={`${jump.name} 경유`}
              >
                <Route className="h-3.5 w-3.5 shrink-0" />
                <span className="block max-w-[6rem] truncate">{jump.name}</span>
              </span>
            )}
          </span>
        </td>
        <td className="py-2 pl-3 text-xs text-fg-muted @max-3xl:hidden">
          {jump ? (
            <span className="flex items-center gap-1">
              <Route className="h-3.5 w-3.5 shrink-0" />
              <span className="block max-w-[10rem] truncate" title={jump.name}>
                {jump.name}
              </span>
            </span>
          ) : (
            "—"
          )}
        </td>
        <td className="py-2 pl-3 text-xs text-fg-muted @max-3xl:hidden">{ago(s.lastConnectedAt)}</td>
        <td className="w-32 py-2 pl-3 pr-3">
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
      />

      {/* 필터(왼쪽)와 작업 버튼(오른쪽)을 한 줄에 둔다. 창이 좁으면 버튼이 다음 줄로 내려간다. */}
      <div className="@container flex flex-wrap items-center gap-x-1.5 gap-y-2 px-6 pb-3">
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

        <div className="ml-auto flex flex-wrap justify-end gap-2">
          {/* 이 줄의 폭이 850px 이하이면(앱 창 약 1100px 이하) 모든 버튼을 아이콘만 남기고, 마우스를 올리면 이름을 띄운다 */}
          <HoverLabel text="내보내기" className={tipWhenCompact}>
            <DropdownButton
              label="내보내기"
              labelClassName="@max-[850px]:hidden"
              icon={<FileUp className="h-4 w-4" />}
              options={[
                {
                  label: "백업 파일 내보내기",
                  description: "서버 목록과 설정을 .dhost-backup 파일로 저장",
                  icon: <Archive className="h-4 w-4" />,
                  onSelect: () => setDialog({ kind: "export" }),
                },
              ]}
            />
          </HoverLabel>
          <HoverLabel text="가져오기" className={tipWhenCompact}>
            <DropdownButton
              label="가져오기"
              labelClassName="@max-[850px]:hidden"
              icon={<FileDown className="h-4 w-4" />}
              options={[
                {
                  label: "SSH 설정 가져오기",
                  description: "~/.ssh/config의 Host 항목을 서버로 추가",
                  icon: <FileCode2 className="h-4 w-4" />,
                  onSelect: () => setDialog({ kind: "importConfig" }),
                },
                {
                  label: "백업 파일 가져오기",
                  description: ".dhost-backup 파일에서 서버 목록과 설정을 불러오기",
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
          </HoverLabel>
          <HoverLabel text="고객사 추가" className={tipWhenCompact}>
            <Button onClick={() => setDialog({ kind: "customer" })} aria-label="고객사 추가">
              <Building2 className="h-4 w-4" />
              <span className="@max-[850px]:hidden">고객사 추가</span>
            </Button>
          </HoverLabel>
          <HoverLabel text="빠른 접속" className={tipWhenCompact}>
            <Button onClick={() => setDialog({ kind: "quick" })} aria-label="빠른 접속">
              <Zap className="h-4 w-4" />
              <span className="@max-[850px]:hidden">빠른 접속</span>
            </Button>
          </HoverLabel>
          <HoverLabel text="서버 추가" className={tipWhenCompact}>
            <Button variant="primary" onClick={() => setDialog({ kind: "server" })} aria-label="서버 추가">
              <Plus className="h-4 w-4" />
              <span className="@max-[850px]:hidden">서버 추가</span>
            </Button>
          </HoverLabel>
        </div>
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
          // 표 폭이 48rem보다 좁으면 경유·최근 접속 열을 숨기고 이름 아래 작은 글씨로 옮긴다 (컨테이너 쿼리).
          <div className="@container overflow-hidden rounded-lg border border-line bg-surface">
            <table className="w-full whitespace-nowrap text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-medium text-fg-subtle">
                  <th className="w-10 min-w-10 py-2 pl-3" />
                  <th className="py-2 font-medium">이름</th>
                  <th className="py-2 pl-3 font-medium">주소</th>
                  <th className="py-2 pl-3 font-medium @max-3xl:hidden">경유</th>
                  <th className="py-2 pl-3 font-medium @max-3xl:hidden">최근 접속</th>
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
      {dialog?.kind === "export" && <ExportDialog onClose={() => setDialog(null)} />}
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
