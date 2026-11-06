/**
 * 붙여넣기 위험 분석 (FUN-08, SEC-05).
 *
 * 터미널에 붙여넣은 텍스트는 원격 셸에 그대로 입력된다.
 * - 줄바꿈이 있으면 붙여넣는 순간 명령이 실행된다.
 * - ESC 같은 제어문자는 bracketed paste(\x1b[201~)를 빠져나가거나 터미널을 조작할 수 있다.
 *   xterm.js는 이런 문자를 걸러주지 않는다.
 * 문자열 검사로 모든 위험한 명령을 알아낼 수는 없으므로, 여기서는 "사용자가 확인해야 할 신호"만 찾는다.
 */

/** 이 길이를 넘으면 한 줄이라도 확인을 받는다 */
export const LARGE_PASTE = 4000;

export interface ControlChar {
  code: number;
  name: string;
  count: number;
}

export interface PasteAnalysis {
  lines: number;
  chars: number;
  /** 줄바꿈이 있어서 붙여넣자마자 실행될 수 있다 */
  hasNewline: boolean;
  /** 마지막 한 줄바꿈만 있다 (복사할 때 딸려온 경우가 많다) */
  onlyTrailingNewline: boolean;
  /** 탭·줄바꿈을 뺀 제어문자 */
  controls: ControlChar[];
  /** bracketed paste 종료 시퀀스가 들어 있다 */
  bracketEscape: boolean;
  large: boolean;
  needsConfirm: boolean;
}

const NAMES: Record<number, string> = {
  0x00: "NUL",
  0x03: "Ctrl+C (ETX)",
  0x04: "Ctrl+D (EOT)",
  0x07: "BEL",
  0x08: "백스페이스 (BS)",
  0x0b: "VT",
  0x0c: "FF",
  0x15: "Ctrl+U (NAK)",
  0x1a: "Ctrl+Z (SUB)",
  0x1b: "ESC",
  0x7f: "DEL",
  0x9b: "CSI (C1)",
};

/** 허용: 탭(0x09), LF(0x0a), CR(0x0d). 그 밖의 C0, DEL, C1 제어문자는 위험으로 본다. */
export function isDangerousControl(code: number) {
  if (code === 0x09 || code === 0x0a || code === 0x0d) return false;
  return code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
}

export function controlName(code: number) {
  return NAMES[code] ?? `0x${code.toString(16).padStart(2, "0").toUpperCase()}`;
}

export function analyzePaste(text: string): PasteAnalysis {
  const counts = new Map<number, number>();
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (isDangerousControl(code)) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  const controls = [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([code, count]) => ({ code, name: controlName(code), count }));

  const normalized = text.replace(/\r\n?/g, "\n");
  const newlineCount = (normalized.match(/\n/g) ?? []).length;
  const hasNewline = newlineCount > 0;
  const onlyTrailingNewline = newlineCount === 1 && normalized.endsWith("\n");
  const lines = normalized.endsWith("\n") ? newlineCount : newlineCount + 1;
  const bracketEscape = text.includes("\x1b[201~") || text.includes("\x1b[200~");
  const large = text.length > LARGE_PASTE;

  return {
    lines: Math.max(lines, 1),
    chars: text.length,
    hasNewline,
    onlyTrailingNewline,
    controls,
    bracketEscape,
    large,
    needsConfirm: hasNewline || controls.length > 0 || large,
  };
}

/** 위험한 제어문자를 지운다. 탭과 줄바꿈은 남긴다. */
export function stripControls(text: string) {
  let out = "";
  for (const ch of text) if (!isDangerousControl(ch.codePointAt(0)!)) out += ch;
  return out;
}

/** 끝에 붙은 줄바꿈 하나를 지운다. */
export function stripTrailingNewline(text: string) {
  return text.replace(/\r?\n$|\r$/, "");
}

/** 미리보기용: 제어문자를 눈에 보이는 기호로 바꾼다. */
export function visualize(text: string) {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code === 0x1b) out += "␛";
    else if (isDangerousControl(code)) out += code < 0x20 ? String.fromCodePoint(0x2400 + code) : "�";
    else if (code === 0x09) out += "⇥   ";
    else out += ch;
  }
  return out;
}
