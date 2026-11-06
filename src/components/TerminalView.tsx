import { useEffect, useRef } from "react";
import { getTerminal } from "../lib/terminals";

/** 보관 중인 xterm 인스턴스를 화면에 붙인다. 페이지를 옮겨도 터미널과 세션은 유지된다. */
export function TerminalView({ termKey, active }: { termKey: string; active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const entry = getTerminal(termKey);
    const container = containerRef.current;
    if (!entry || !container) return;
    if (entry.el.parentElement !== container) container.appendChild(entry.el);
    if (!entry.opened) {
      entry.term.open(entry.el);
      entry.opened = true;
    }
    const observer = new ResizeObserver(() => {
      if (container.offsetParent !== null) entry.fit.fit();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [termKey]);

  useEffect(() => {
    if (!active) return;
    const entry = getTerminal(termKey);
    if (!entry) return;
    requestAnimationFrame(() => {
      entry.fit.fit();
      entry.term.focus();
    });
  }, [active, termKey]);

  return <div ref={containerRef} className={`h-full w-full bg-surface p-2 ${active ? "" : "hidden"}`} />;
}
