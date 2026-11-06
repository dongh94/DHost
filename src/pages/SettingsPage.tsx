import { useEffect, useState } from "react";
import { Download, Monitor, Moon, RefreshCw, RotateCcw, Sun } from "lucide-react";
import { useUpdate } from "../stores/update";
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

function UpdateSection() {
  const { currentVersion, status, info, error, noRelease, lastChecked, check, openDialog, loadVersion } = useUpdate();
  useEffect(() => void loadVersion(), [loadVersion]);
  const message =
    status === "checking"
      ? "확인 중…"
      : status === "available" && info
        ? `새 버전 ${info.version}이 있습니다.`
        : status === "none"
          ? noRelease
            ? "아직 공개된 배포가 없습니다."
            : "최신 버전입니다."
          : lastChecked
            ? ""
            : "앱을 열면 자동으로 확인하고, 6시간마다 다시 확인합니다.";
  return (
    <div className="rounded-lg border border-line bg-surface">
      <Section title="앱 업데이트" description={`현재 버전 ${currentVersion ?? "-"}${message ? ` · ${message}` : ""}`}>
        {status === "available" ? (
          <Button variant="primary" onClick={openDialog}>
            <Download className="h-4 w-4" />
            업데이트
          </Button>
        ) : (
          <Button onClick={() => void check(true)} disabled={status === "checking" || status === "downloading"}>
            <RefreshCw className={`h-4 w-4 ${status === "checking" ? "animate-spin" : ""}`} />
            업데이트 확인
          </Button>
        )}
      </Section>
      {status === "error" && error && !useUpdate.getState().dialogOpen && (
        <div className="border-t border-line px-5 py-3 text-xs">
          <p className="text-red-600">{error.message}</p>
          <details className="mt-1 text-fg-muted">
            <summary className="cursor-pointer">자세한 오류 (관리자에게 전달)</summary>
            <code className="mt-1 block break-all font-mono select-text">{error.detail}</code>
          </details>
        </div>
      )}
    </div>
  );
}

export function SettingsPage() {
  const { theme, setTheme, fontSize, setFontSize, connectTimeout, setConnectTimeout, scrollback, setScrollback, reset } = useSettings();
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
          <Section
            title="스크롤 보관 줄 수"
            description="탭마다 이만큼만 이전 출력을 보관합니다. 늘리면 오래된 출력을 더 볼 수 있지만 메모리를 더 씁니다. 새 탭부터 적용됩니다."
          >
            <div className="flex items-center gap-3">
              <select
                value={scrollback}
                onChange={(e) => setScrollback(Number(e.target.value))}
                className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-fg"
              >
                {[1000, 5000, 10000, 20000, 50000].map((n) => (
                  <option key={n} value={n}>
                    {n.toLocaleString()}줄
                  </option>
                ))}
              </select>
            </div>
          </Section>
          <Section title="연결 시간 제한" description="서버(또는 경유 서버)가 이 시간 안에 응답하지 않으면 실패로 처리합니다.">
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={5}
                max={120}
                step={5}
                value={connectTimeout}
                onChange={(e) => setConnectTimeout(Number(e.target.value))}
                className="w-40 accent-brand-600"
              />
              <span className="w-10 text-right font-mono text-sm text-fg">{connectTimeout}초</span>
            </div>
          </Section>
        </div>

        <UpdateSection />

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
          message="테마, 터미널 글자 크기, 스크롤 보관 줄 수, 연결 시간 제한을 기본값으로 되돌립니다."
          confirmLabel="초기화"
          onClose={() => setConfirmReset(false)}
          onConfirm={reset}
        />
      )}
    </div>
  );
}
