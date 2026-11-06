import { Monitor, Moon, Sun } from "lucide-react";
import { useSettings, type ThemeMode } from "../stores/settings";
import { PageHeader } from "../components/ui";

const options: { value: ThemeMode; label: string; icon: React.ReactNode }[] = [
  { value: "system", label: "시스템", icon: <Monitor className="h-4 w-4" /> },
  { value: "light", label: "라이트", icon: <Sun className="h-4 w-4" /> },
  { value: "dark", label: "다크", icon: <Moon className="h-4 w-4" /> },
];

export function SettingsPage() {
  const { theme, setTheme } = useSettings();
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="설정" description="앱 설정입니다. 열린 세션에는 영향을 주지 않습니다." />
      <div className="px-6">
        <section className="rounded-lg border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold text-fg">테마</h2>
          <p className="mt-0.5 text-xs text-fg-muted">시스템 설정을 따르거나 직접 고를 수 있습니다.</p>
          <div className="mt-3 inline-flex rounded-md border border-line p-0.5">
            {options.map((o) => (
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
        </section>
      </div>
    </div>
  );
}
