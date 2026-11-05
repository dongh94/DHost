import { useState, type FormEvent } from "react";
import { openSession } from "../lib/connect";

const inputCls =
  "w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950";

interface Fields {
  host: string;
  port: string;
  user: string;
}

function EndpointFields({ value, onChange }: { value: Fields; onChange: (v: Fields) => void }) {
  return (
    <div className="space-y-1.5">
      <input
        className={inputCls}
        placeholder="호스트 (예: 192.0.2.10)"
        value={value.host}
        onChange={(e) => onChange({ ...value, host: e.target.value.trim() })}
        required
      />
      <div className="flex gap-1.5">
        <input
          className={inputCls}
          placeholder="사용자"
          value={value.user}
          onChange={(e) => onChange({ ...value, user: e.target.value.trim() })}
          required
        />
        <input
          className={`${inputCls} w-20`}
          placeholder="포트"
          inputMode="numeric"
          value={value.port}
          onChange={(e) => onChange({ ...value, port: e.target.value.replace(/\D/g, "") })}
          required
        />
      </div>
    </div>
  );
}

/** 빠른 접속 (스파이크용). 서버 프로필 관리(FUN-01)로 대체될 예정 */
export function ConnectForm() {
  const [target, setTarget] = useState<Fields>({ host: "", port: "22", user: "" });
  const [useJump, setUseJump] = useState(false);
  const [jump, setJump] = useState<Fields>({ host: "", port: "22", user: "" });

  const toEndpoint = (f: Fields) => ({ host: f.host, port: Number(f.port), user: f.user });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    openSession({ target: toEndpoint(target), jump: useJump ? toEndpoint(jump) : null });
  };

  return (
    <form onSubmit={submit} className="space-y-2 p-3">
      <div className="text-xs font-semibold text-zinc-500">빠른 접속</div>
      <EndpointFields value={target} onChange={setTarget} />
      <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
        <input type="checkbox" checked={useJump} onChange={(e) => setUseJump(e.target.checked)} />
        Jump Host 경유
      </label>
      {useJump && <EndpointFields value={jump} onChange={setJump} />}
      <button
        type="submit"
        className="w-full rounded-md bg-zinc-900 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        연결
      </button>
    </form>
  );
}
