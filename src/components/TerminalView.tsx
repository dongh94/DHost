import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

const themes = {
  light: { background: "#ffffff", foreground: "#18181b", cursor: "#18181b" },
  dark: { background: "#09090b", foreground: "#e4e4e7", cursor: "#e4e4e7" },
};

/**
 * 터미널 화면. 아직 SSH 세션과 연결되지 않았다.
 * 키 입력은 어디로도 전송하지 않는다.
 */
export function TerminalView({ theme }: { theme: "light" | "dark" }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new Terminal({
      fontFamily: "Menlo, 'D2Coding', monospace",
      fontSize: 13,
      cursorBlink: true,
      theme: themes[theme],
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    term.writeln("DHost 터미널 (연결 없음)");
    term.writeln("왼쪽에서 서버를 선택하면 여기에서 SSH 세션이 열립니다.");
    termRef.current = term;

    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      term.dispose();
      termRef.current = null;
    };
    // 테마 변경은 아래 effect에서 처리해 터미널을 다시 만들지 않는다 (세션 유지).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = themes[theme];
  }, [theme]);

  return <div ref={containerRef} className="h-full w-full p-2" />;
}
