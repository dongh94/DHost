import { useState } from "react";
import { Monitor, Moon, RotateCcw, Sun } from "lucide-react";
import { useSettings, type ThemeMode } from "../stores/settings";
import { Button, PageHeader } from "../components/ui";
import { ConfirmDialog } from "../components/dialogs";
import { BackupSection } from "../components/BackupSection";

const themes: { value: ThemeMode; label: string; icon: React.ReactNode }[] = [
  { value: "system", label: "시스템", icon: <Monitor className="h-4 w-4" /> },
  { value: "light", label: "라이트", icon: <Sun className="h-4 w-4" /> },
  { value: "dark", label: "다크", icon: <Moon className="h-4 w-4" /> },
];

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="flex items-center justify-between gap-6 border-b border-line px-5 py-4 last:border-0">
      <div>
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        <p className="mt-0.5 text-xs text-fg-muted">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </section>
  );
}

export function SettingsPage() {
  const { theme, setTheme, fontSize, setFontSize, reset } = useSettings();
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="설정" description="설정은 이 Mac에 저장됩니다. 바꿔도 열린 세션은 끊기지 않습니다." />
      <div className="min-h-0 flex-1 space-y-4 overflow-auto px-6 pb-6">
        <div className="rounded-lg border border-line bg-surface">
          <Section title="테마" description="시스템 설정을 따르거나 직접 고를 수 있습니다.">
            <div className="inline-flex rounded-md border border-line p-0.5">
              {themes.map((o) => (
                <button
                  key={o.value}
                  onClick={() => setTheme(o.value)}
                  className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-sm ${
                    theme === o.value ? "bg-brand-600 text-white" : "text-fg-muted hover:text-fg"
                  }`}
                >
                  {o.icon}
                  {o.label}
                </button>
              ))}
            </div>
          </Section>
          <Section title="터미널 글자 크기" description="열려 있는 터미널에도 바로 적용됩니다.">
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={10}
                max={24}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="w-40 accent-brand-600"
              />
              <span className="w-10 text-right font-mono text-sm text-fg">{fontSize}px</span>
            </div>
          </Section>
        </div>

        <BackupSection />

        <div className="rounded-lg border border-line bg-surface">
          <Section title="설정 초기화" description="설정만 기본값으로 되돌립니다. 서버 목록과 호스트 키는 그대로 남습니다.">
            <Button onClick={() => setConfirmReset(true)}>
              <RotateCcw className="h-4 w-4" />
              초기화
            </Button>
          </Section>
        </div>
      </div>
      {confirmReset && (
        <ConfirmDialog
          title="설정 초기화"
          message="테마와 터미널 글자 크기를 기본값으로 되돌립니다."
          confirmLabel="초기화"
          onClose={() => setConfirmReset(false)}
          onConfirm={reset}
        />
      )}
    </div>
  );
}
