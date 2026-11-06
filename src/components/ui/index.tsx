import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50",
  secondary:
    "border border-line bg-surface text-fg hover:bg-muted disabled:opacity-50",
  ghost: "text-fg-muted hover:bg-muted hover:text-fg",
  danger: "bg-red-600 text-white hover:bg-red-500",
};

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${variants[variant]} ${className}`}
    />
  );
}

export function IconButton({
  label,
  className = "",
  tone,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; tone?: "danger" | "brand" }) {
  const toneCls =
    tone === "danger"
      ? "hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
      : tone === "brand"
        ? "hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-950"
        : "hover:bg-muted hover:text-fg";
  return (
    <button
      {...props}
      title={label}
      aria-label={label}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors disabled:opacity-40 ${toneCls} ${className}`}
    />
  );
}

export const inputCls =
  "w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputCls} ${props.className ?? ""}`} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-fg-subtle">{hint}</span>}
    </label>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = "max-w-lg",
  tone,
}: {
  title: string;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
  tone?: "danger";
}) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full ${width} overflow-hidden rounded-xl border bg-surface shadow-2xl ${
          tone === "danger" ? "border-red-500" : "border-line"
        }`}
      >
        <div className="border-b border-line px-5 py-3.5">
          <h2 className={`text-base font-semibold ${tone === "danger" ? "text-red-600" : "text-fg"}`}>{title}</h2>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line bg-canvas px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "danger" | "brand"; children: ReactNode }) {
  const t = {
    neutral: "bg-muted text-fg-muted",
    danger: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
    brand: "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300",
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${t}`}>{children}</span>;
}

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 px-6 pb-4 pt-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">{title}</h1>
        <p className="mt-0.5 text-sm text-fg-muted">{description}</p>
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}
