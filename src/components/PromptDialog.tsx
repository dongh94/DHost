import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { cancelAuth } from "../lib/connect";
import { useSessions } from "../stores/sessions";
import { PasteDialog } from "./PasteDialog";

const btn = "rounded-md px-3 py-1.5 text-sm font-medium";
const btnGhost = `${btn} border border-line bg-surface text-fg hover:bg-muted`;
const btnPrimary = `${btn} bg-brand-600 text-white hover:bg-brand-700`;
const btnDanger = `${btn} bg-red-600 text-white hover:bg-red-500`;

function Shell({ title, tone, children }: { title: string; tone?: "danger"; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full max-w-md rounded-lg border bg-surface p-5 shadow-2xl ${
          tone === "danger" ? "border-red-500" : "border-line"
        }`}
      >
        <h2 className={`mb-3 text-base font-semibold ${tone === "danger" ? "text-red-600" : "text-fg"}`}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Fingerprint({ value }: { value: string }) {
  return (
    <code className="block break-all rounded bg-muted px-2 py-1.5 font-mono text-xs text-fg">
      {value}
    </code>
  );
}

/** 호스트 키 승인, 키 변경 차단 알림, 비밀번호 입력을 하나씩 순서대로 보여준다. */
export function PromptDialog() {
  const prompt = useSessions((s) => s.prompts[0]);
  const shift = useSessions((s) => s.shiftPrompt);
  const [secret, setSecret] = useState("");
  const [save, setSave] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSecret("");
    setSave(false);
    inputRef.current?.focus();
  }, [prompt]);

  if (!prompt) return null;

  if (prompt.kind === "paste") {
    return <PasteDialog key={prompt.data.tabKey + prompt.data.text.length} {...prompt.data} onDone={shift} />;
  }

  if (prompt.kind === "hostkey") {
    const p = prompt.data;
    const answer = (trust: boolean) => {
      void api.answerHostKey(p.requestId, trust);
      shift();
    };
    return (
      <Shell title="처음 접속하는 서버입니다">
        <div className="space-y-3 text-sm">
          <p>
            <b>{p.host}</b> 서버의 호스트 키를 아직 신뢰하지 않았습니다. 서버 관리자에게 받은 지문과 같은지
            확인한 뒤에 승인하세요.
          </p>
          <div>
            <div className="mb-1 text-xs text-fg-subtle">{p.keyType}</div>
            <Fingerprint value={p.fingerprint} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button autoFocus className={btnGhost} onClick={() => answer(false)}>
              취소
            </button>
            <button className={btnPrimary} onClick={() => answer(true)}>
              신뢰하고 연결
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  if (prompt.kind === "changed") {
    const p = prompt.data;
    return (
      <Shell title="호스트 키가 바뀌어 연결을 차단했습니다" tone="danger">
        <div className="space-y-3 text-sm">
          <p>
            <b>{p.host}</b> 서버가 저장된 키와 다른 키를 보냈습니다. 서버를 재설치했을 수도 있지만, 중간에서
            누군가 통신을 가로채고 있을 수도 있습니다. 관리자에게 확인하기 전에는 접속하지 마세요.
          </p>
          <div>
            <div className="mb-1 text-xs text-fg-subtle">서버가 보낸 키 ({p.keyType})</div>
            <Fingerprint value={p.fingerprint} />
          </div>
          <div>
            <div className="mb-1 text-xs text-fg-subtle">저장된 키</div>
            {p.knownFingerprints.map((f) => (
              <Fingerprint key={f} value={f} />
            ))}
          </div>
          <div className="flex justify-end pt-1">
            <button autoFocus className={btnDanger} onClick={shift}>
              확인
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  const p = prompt.data;
  const reply = (value: string | null) => {
    void api.answerAskpass(p.requestId, value, value !== null && save);
    // 취소하면 그 접속 시도를 끝낸다. ssh가 비밀번호를 다시 묻지 않는다.
    if (value === null) cancelAuth(p.sessionId);
    setSecret("");
    shift();
  };

  if (p.confirm) {
    return (
      <Shell title="확인 필요">
        <p className="mb-4 whitespace-pre-wrap text-sm">{p.prompt}</p>
        <div className="flex justify-end gap-2">
          <button autoFocus className={btnGhost} onClick={() => reply(null)}>
            거부
          </button>
          <button className={btnPrimary} onClick={() => reply("yes")}>
            허용
          </button>
        </div>
      </Shell>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    reply(secret);
  };
  return (
    <Shell title="인증 정보 입력">
      <form onSubmit={submit} className="space-y-3 text-sm">
        {p.retry && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {p.savedWasWrong
              ? "저장된 비밀번호로 로그인하지 못해 저장된 비밀번호를 지웠습니다. 다시 입력하세요."
              : "비밀번호가 맞지 않습니다. 다시 입력하세요."}
          </p>
        )}
        <p className="whitespace-pre-wrap">{p.prompt}</p>
        <input
          ref={inputRef}
          type="password"
          autoComplete="off"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-fg focus:border-brand-500 focus:outline-none"
        />
        {p.canSave && (
          <label className="flex items-center gap-2 text-xs text-fg-muted">
            <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
            이 서버의 비밀번호를 macOS 키체인에 저장
          </label>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={() => reply(null)}>
            취소
          </button>
          <button type="submit" className={btnPrimary}>
            확인
          </button>
        </div>
      </form>
    </Shell>
  );
}
