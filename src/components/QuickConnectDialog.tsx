import { useState, type FormEvent } from "react";
import { quickConnect } from "../lib/connect";
import { Button, Field, Input, Modal } from "./ui";

interface Fields {
  host: string;
  port: string;
  user: string;
}

function EndpointFields({ value, onChange, autoFocus }: { value: Fields; onChange: (v: Fields) => void; autoFocus?: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_1fr_5rem] gap-2">
      <Field label="호스트">
        <Input autoFocus={autoFocus} value={value.host} onChange={(e) => onChange({ ...value, host: e.target.value.trim() })} required />
      </Field>
      <Field label="사용자">
        <Input value={value.user} onChange={(e) => onChange({ ...value, user: e.target.value.trim() })} required />
      </Field>
      <Field label="포트">
        <Input
          value={value.port}
          inputMode="numeric"
          onChange={(e) => onChange({ ...value, port: e.target.value.replace(/\D/g, "") })}
          required
        />
      </Field>
    </div>
  );
}

/** 프로필을 만들지 않고 한 번 접속한다. */
export function QuickConnectDialog({ onClose }: { onClose: () => void }) {
  const [target, setTarget] = useState<Fields>({ host: "", port: "22", user: "" });
  const [useJump, setUseJump] = useState(false);
  const [jump, setJump] = useState<Fields>({ host: "", port: "22", user: "" });
  const ep = (f: Fields) => ({ host: f.host, port: Number(f.port), user: f.user });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    quickConnect({ target: ep(target), jump: useJump ? ep(jump) : null });
    onClose();
  };

  return (
    <Modal title="빠른 접속" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <EndpointFields value={target} onChange={setTarget} autoFocus />
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          <input type="checkbox" checked={useJump} onChange={(e) => setUseJump(e.target.checked)} />
          Jump Host 경유
        </label>
        {useJump && <EndpointFields value={jump} onChange={setJump} />}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" variant="primary">
            연결
          </Button>
        </div>
      </form>
    </Modal>
  );
}
