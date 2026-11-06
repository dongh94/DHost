import { useState, type FormEvent } from "react";
import { Button, Field, Input, Modal } from "./ui";

/** 이름 하나를 입력받는 대화상자 (고객사·폴더 추가와 이름 변경) */
export function NameDialog({
  title,
  label,
  initial = "",
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  initial?: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await onSubmit(name);
      onClose();
    } catch (err) {
      setError(String(err));
    }
  };
  return (
    <Modal title={title} onClose={onClose} width="max-w-sm">
      <form onSubmit={submit} className="space-y-3">
        <Field label={label}>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </Field>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            저장
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** 삭제처럼 되돌리기 어려운 동작의 확인 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "삭제",
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      title={title}
      onClose={onClose}
      width="max-w-sm"
      footer={
        <>
          <Button autoFocus onClick={onClose}>
            취소
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              try {
                await onConfirm();
                onClose();
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-fg">{message}</p>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </Modal>
  );
}
