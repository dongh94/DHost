import { useEffect, useMemo, useState } from "react";
import { api, type ConfigCandidate, type ConfigEntry, type ImportSummary, type KnownHostsScan } from "../lib/api";
import { useCatalog } from "../stores/catalog";
import { Badge, Button, Field, Input, Modal, Select } from "./ui";

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
  const [selected, toggle, setSelected] = useToggleSet();
  const keyOf = (c: { host: string; key: string }) => `${c.host} ${c.key}`;

  useEffect(() => {
    api.knownHostsScan().then(setScan).catch((e) => setError(String(e)));
  }, []);

  const importable = scan?.candidates.filter((c) => !c.alreadyTrusted) ?? [];

  return (
    <Modal
      title="~/.ssh/known_hosts 가져오기"
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
                const items = importable.filter((c) => selected.has(keyOf(c)));
                await api.knownHostsImport(items.map(({ host, keyType, key }) => ({ host, keyType, key })));
                onDone();
                onClose();
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
          터미널에서 이미 신뢰한 서버 키입니다. 확인한 서버만 골라 가져오세요. 원본 파일은 바꾸지 않습니다.
        </p>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {scan && (scan.hashed > 0 || scan.skipped > 0) && (
          <p className="text-xs text-fg-subtle">
            {scan.hashed > 0 && `호스트 이름이 해시되어 있어 가져올 수 없는 항목 ${scan.hashed}개. `}
            {scan.skipped > 0 && `와일드카드·인증서 등 가져오지 않는 항목 ${scan.skipped}개.`}
          </p>
        )}
        {!scan ? (
          <p className="text-fg-muted">읽는 중…</p>
        ) : scan.candidates.length === 0 ? (
          <p className="text-fg-muted">가져올 항목이 없습니다.</p>
        ) : (
          <div className="max-h-96 overflow-auto rounded-md border border-line">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line text-left text-fg-subtle">
                  <th className="w-8 py-2 pl-3">
                    <input
                      type="checkbox"
                      checked={importable.length > 0 && selected.size === importable.length}
                      onChange={(e) => setSelected(new Set(e.target.checked ? importable.map(keyOf) : []))}
                    />
                  </th>
                  <th className="py-2 font-medium">호스트</th>
                  <th className="py-2 font-medium">종류</th>
                  <th className="py-2 pr-3 font-medium">지문</th>
                </tr>
              </thead>
              <tbody>
                {scan.candidates.map((c) => (
                  <tr key={keyOf(c)} className="border-b border-line last:border-0">
                    <td className="py-1.5 pl-3">
                      <input
                        type="checkbox"
                        disabled={c.alreadyTrusted}
                        checked={c.alreadyTrusted || selected.has(keyOf(c))}
                        onChange={() => toggle(keyOf(c))}
                      />
                    </td>
                    <td className="py-1.5 font-mono text-fg">
                      {c.host} {c.alreadyTrusted && <Badge>이미 신뢰함</Badge>}
                    </td>
                    <td className="py-1.5 text-fg-muted">{c.keyType}</td>
                    <td className="py-1.5 pr-3 font-mono text-fg-muted">{c.fingerprint}</td>
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
      title="~/.ssh/config 가져오기"
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
          바꾸지 않고, 비밀번호나 키 파일 내용은 가져오지 않습니다.
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
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line text-left text-fg-subtle">
                  <th className="w-8 py-2 pl-3" />
                  <th className="py-2 font-medium">별칭</th>
                  <th className="py-2 font-medium">주소</th>
                  <th className="py-2 pr-3 font-medium">경유</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.alias} className="border-b border-line last:border-0">
                    <td className="py-1.5 pl-3 align-top">
                      <input
                        type="checkbox"
                        disabled={blocked(i)}
                        checked={!blocked(i) && selected.has(i.alias)}
                        onChange={() => toggle(i.alias)}
                      />
                    </td>
                    <td className="py-1.5 align-top font-medium text-fg">
                      {i.alias}
                      {i.problem && <div className="font-normal text-amber-600">{i.problem}</div>}
                    </td>
                    <td className="py-1.5 align-top font-mono text-fg-muted">
                      {i.user}@{i.host}:{i.port}
                    </td>
                    <td className="py-1.5 pr-3 align-top text-fg-muted">{i.proxyJump ?? "—"}</td>
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
