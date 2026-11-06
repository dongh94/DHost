import { useEffect, useMemo, useState } from "react";
import { api, type ConfigCandidate, type ConfigEntry, type ImportSummary, type KnownHostsScan } from "../lib/api";
import { useCatalog } from "../stores/catalog";
import { Badge, Button, Field, Input, Modal, Select } from "./ui";
import { shortKeyType } from "../lib/format";

function useToggleSet(initial: string[] = []) {
  const [set, setSet] = useState(new Set(initial));
  const toggle = (k: string) =>
    setSet((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  return [set, toggle, setSet] as const;
}

/** ~/.ssh/known_hosts에서 고른 키만 가져온다 (계속 함께 읽지는 않는다). */
export function KnownHostsImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [scan, setScan] = useState<KnownHostsScan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, toggle, setSelected] = useToggleSet();
  const keyOf = (c: { host: string; key: string }) => `${c.host} ${c.key}`;

  useEffect(() => {
    api.knownHostsScan().then(setScan).catch((e) => setError(String(e)));
  }, []);

  const all = scan?.candidates ?? [];
  const q = filter.trim().toLowerCase();
  const shown = q ? all.filter((c) => `${c.host} ${c.keyType} ${c.fingerprint}`.toLowerCase().includes(q)) : all;
  const importable = all.filter((c) => !c.alreadyTrusted);
  const shownImportable = shown.filter((c) => !c.alreadyTrusted);
  const allShownSelected = shownImportable.length > 0 && shownImportable.every((c) => selected.has(keyOf(c)));
  const unusable = (scan?.hashed ?? 0) + (scan?.skipped ?? 0);

  const toggleAllShown = (on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of shownImportable) {
        if (on) next.add(keyOf(c));
        else next.delete(keyOf(c));
      }
      return next;
    });

  return (
    <Modal
      title="SSH 호스트 키 가져오기"
      subtitle={<span className="font-mono">~/.ssh/known_hosts</span>}
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button
            variant="primary"
            disabled={selected.size === 0 || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const items = importable.filter((c) => selected.has(keyOf(c)));
                await api.knownHostsImport(items.map(({ host, keyType, key }) => ({ host, keyType, key })));
                onDone();
                onClose();
              } catch (e) {
                setError(String(e));
                setBusy(false);
              }
            }}
          >
            {selected.size}개 가져오기
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-fg-muted">
          터미널에서 ssh로 접속하며 이미 신뢰한 서버 키입니다. 서버 관리자에게 받은 지문과 같은지 확인한 것만 골라
          가져오세요. 원본 파일은 바꾸지 않습니다.
        </p>

        {scan && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <Badge tone="brand">가져올 수 있음 {importable.length}</Badge>
            <Badge>이미 신뢰함 {all.length - importable.length}</Badge>
            {unusable > 0 && (
              <span
                className="cursor-help"
                title={[
                  scan.hashed > 0 ? `호스트 이름이 해시로 저장된 항목 ${scan.hashed}개 (HashKnownHosts): 어떤 서버인지 알 수 없어 가져올 수 없습니다.` : "",
                  scan.skipped > 0 ? `와일드카드·인증서(@cert-authority)·폐기(@revoked) 항목 ${scan.skipped}개.` : "",
                ]
                  .filter(Boolean)
                  .join("\n")}
              >
                <Badge>가져올 수 없음 {unusable}</Badge>
              </span>
            )}
            {all.length > 6 && (
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="호스트·지문 검색"
                className="ml-auto w-48 py-1 text-xs"
              />
            )}
          </div>
        )}

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>
        )}

        {!scan ? (
          !error && <p className="rounded-md border border-line p-6 text-center text-fg-muted">읽는 중…</p>
        ) : all.length === 0 ? (
          <p className="rounded-md border border-dashed border-line p-6 text-center text-fg-muted">가져올 수 있는 키가 없습니다.</p>
        ) : (
          // 항목이 많으면 높이를 고정해 검색할 때 창 크기가 흔들리지 않게 한다.
          <div className={`${all.length > 6 ? "h-80" : "max-h-80"} overflow-auto rounded-md border border-line`}>
            <table className="w-full whitespace-nowrap text-xs">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line text-left text-fg-subtle">
                  <th className="w-9 min-w-9 py-2 pl-3 pr-2">
                    <input
                      type="checkbox"
                      aria-label="보이는 항목 모두 선택"
                      disabled={shownImportable.length === 0}
                      checked={allShownSelected}
                      onChange={(e) => toggleAllShown(e.target.checked)}
                    />
                  </th>
                  <th className="py-2 font-medium">호스트</th>
                  <th className="py-2 pl-3 font-medium">종류</th>
                  <th className="py-2 pl-3 pr-3 font-medium">지문</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => {
                  const k = keyOf(c);
                  return (
                    <tr
                      key={k}
                      onClick={() => !c.alreadyTrusted && toggle(k)}
                      className={`border-b border-line last:border-0 ${
                        c.alreadyTrusted ? "text-fg-subtle" : "cursor-pointer hover:bg-canvas"
                      }`}
                    >
                      <td className="w-9 min-w-9 py-1.5 pl-3 pr-2">
                        <input
                          type="checkbox"
                          disabled={c.alreadyTrusted}
                          checked={!c.alreadyTrusted && selected.has(k)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggle(k)}
                        />
                      </td>
                      <td className="py-1.5">
                        <span className="flex items-center gap-1.5">
                          <span
                            className={`block max-w-[16rem] truncate font-mono ${c.alreadyTrusted ? "" : "text-fg"}`}
                            title={c.host}
                          >
                            {c.host}
                          </span>
                          {c.alreadyTrusted && <Badge>이미 신뢰함</Badge>}
                        </span>
                      </td>
                      <td className="py-1.5 pl-3 text-fg-muted" title={c.keyType}>
                        {shortKeyType(c.keyType)}
                      </td>
                      <td className="w-full max-w-0 py-1.5 pl-3 pr-3 font-mono text-fg-muted">
                        <span className="block truncate" title={c.fingerprint}>
                          {c.fingerprint}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-fg-muted">
                      검색 결과가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** ~/.ssh/config의 Host 항목을 서버 프로필로 가져온다. 값은 ssh -G로 해석한다. */
export function SshConfigImportDialog({ onClose }: { onClose: () => void }) {
  const { customers, reload } = useCatalog();
  const [items, setItems] = useState<ConfigCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, toggle, setSelected] = useToggleSet();
  const [customerId, setCustomerId] = useState("");
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  useEffect(() => {
    api
      .sshConfigScan()
      .then((list) => {
        setItems(list);
        setSelected(new Set(list.filter((i) => !i.problem || i.proxyJump).map((i) => i.alias)));
      })
      .catch((e) => setError(String(e)));
  }, [setSelected]);

  const blocked = (i: ConfigCandidate) => !!i.problem && !i.problem.includes("경유");

  if (summary) {
    return (
      <Modal title="가져오기 결과" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>확인</Button>}>
        <div className="space-y-2 text-sm">
          <p className="text-fg">서버 {summary.created}개를 추가했습니다.</p>
          {[...summary.warnings, ...summary.skipped].length > 0 && (
            <ul className="max-h-60 space-y-1 overflow-auto text-xs text-fg-muted">
              {summary.warnings.map(([a, r]) => (
                <li key={`w${a}`}>
                  <b className="text-amber-600">{a}</b>: {r}
                </li>
              ))}
              {summary.skipped.map(([a, r]) => (
                <li key={`s${a}`}>
                  <b>{a}</b>: 건너뜀 · {r}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="SSH 설정 가져오기"
      subtitle={<span className="font-mono">~/.ssh/config</span>}
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button
            variant="primary"
            disabled={selected.size === 0}
            onClick={async () => {
              try {
                const chosen = (items ?? []).filter((i) => selected.has(i.alias) && !blocked(i));
                setSummary(await api.sshConfigImport(chosen, customerId || null));
                await reload();
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            {selected.size}개 가져오기
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-fg-muted">
          Host 별칭마다 <code className="font-mono">ssh -G</code>로 실제 주소·사용자·포트를 확인했습니다. 원본 파일은
          바꾸지 않습니다. 개인키는 파일 경로만 가져오고, 비밀번호나 키 내용은 가져오지 않습니다.
        </p>
        <Field label="넣을 고객사">
          <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="max-w-xs">
            <option value="">미분류</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {!items ? (
          <p className="text-fg-muted">읽는 중…</p>
        ) : items.length === 0 ? (
          <p className="text-fg-muted">가져올 Host 항목이 없습니다.</p>
        ) : (
          <div className="max-h-80 overflow-auto rounded-md border border-line">
            <table className="w-full whitespace-nowrap text-xs">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line text-left text-fg-subtle">
                  <th className="w-9 min-w-9 py-2 pl-3 pr-2" />
                  <th className="py-2 font-medium">별칭</th>
                  <th className="py-2 pl-3 font-medium">주소</th>
                  <th className="py-2 pl-3 font-medium">개인키</th>
                  <th className="py-2 pl-3 pr-3 font-medium">경유</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr
                    key={i.alias}
                    onClick={() => !blocked(i) && toggle(i.alias)}
                    className={`border-b border-line last:border-0 ${blocked(i) ? "text-fg-subtle" : "cursor-pointer hover:bg-canvas"}`}
                  >
                    <td className="w-9 min-w-9 py-1.5 pl-3 pr-2 align-top">
                      <input
                        type="checkbox"
                        disabled={blocked(i)}
                        checked={!blocked(i) && selected.has(i.alias)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggle(i.alias)}
                      />
                    </td>
                    <td className="max-w-0 w-[30%] py-1.5 align-top font-medium text-fg">
                      <span className="block truncate" title={i.alias}>
                        {i.alias}
                      </span>
                      {i.problem && <div className="whitespace-normal font-normal text-amber-600">{i.problem}</div>}
                    </td>
                    <td className="py-1.5 pl-3 align-top font-mono text-fg-muted">
                      <span className="block max-w-[14rem] truncate" title={`${i.user}@${i.host}:${i.port}`}>
                        {i.user}@{i.host}:{i.port}
                      </span>
                    </td>
                    <td className="py-1.5 pl-3 align-top font-mono text-fg-muted" title={i.identityFile ?? "기본 키·Agent 사용"}>
                      <span className="block max-w-[11rem] truncate">{i.identityFile ?? "—"}</span>
                    </td>
                    <td className="py-1.5 pl-3 pr-3 align-top text-fg-muted">
                      <span className="block max-w-[8rem] truncate" title={i.proxyJump ?? undefined}>
                        {i.proxyJump ?? "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

const IMPORTANT = ["hostname", "user", "port", "identityfile", "proxycommand", "proxyjump", "stricthostkeychecking", "userknownhostsfile", "knownhostscommand", "forwardagent"];

/** 서버에 접속할 때 실제로 적용될 ssh 설정 (SEC-P02) */
export function EffectiveConfigDialog({ serverId, name, onClose }: { serverId: string; name: string; onClose: () => void }) {
  const [entries, setEntries] = useState<ConfigEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [all, setAll] = useState(false);

  useEffect(() => {
    api.serverEffectiveConfig(serverId).then(setEntries).catch((e) => setError(String(e)));
  }, [serverId]);

  const shown = useMemo(() => {
    const list = entries ?? [];
    const f = filter.trim().toLowerCase();
    if (f) return list.filter((e) => `${e.key} ${e.value}`.toLowerCase().includes(f));
    if (all) return list;
    return IMPORTANT.flatMap((k) => list.filter((e) => e.key === k));
  }, [entries, filter, all]);

  return (
    <Modal title={`${name} · 실제 적용값`} onClose={onClose} width="max-w-3xl" footer={<Button onClick={onClose}>닫기</Button>}>
      <div className="space-y-3 text-sm">
        <p className="text-fg-muted">
          <code className="font-mono">ssh -G</code>로 확인한 최종 설정입니다. 접속하지 않습니다.{" "}
          <Badge tone="brand">DHost</Badge> 표시는 보안을 위해 DHost가 직접 정하는 값이라 ~/.ssh/config보다 우선합니다.
        </p>
        <div className="flex items-center gap-3">
          <Input placeholder="설정 이름이나 값 검색" value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-xs" />
          <label className="flex items-center gap-1.5 text-xs text-fg-muted">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            전체 보기
          </label>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {!entries ? (
          <p className="text-fg-muted">확인 중…</p>
        ) : (
          <div className="max-h-96 overflow-auto rounded-md border border-line">
            <table className="w-full text-xs">
              <tbody>
                {shown.map((e, i) => (
                  <tr key={`${e.key}-${i}`} className="border-b border-line last:border-0">
                    <td className="w-48 py-1.5 pl-3 align-top font-mono text-fg">
                      {e.key} {e.forced && <Badge tone="brand">DHost</Badge>}
                    </td>
                    <td className="break-all py-1.5 pr-3 font-mono text-fg-muted">{e.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
