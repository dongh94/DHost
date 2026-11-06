import { useSessions } from "../stores/sessions";

/**
 * 원격 출력에 들어 있는 링크 처리 (GAP-04).
 * 원격 서버가 출력한 링크는 믿을 수 없으므로 ⌘+클릭일 때만 반응하고,
 * 열기 전에 실제 주소를 보여 주고 확인을 받는다. http/https만 허용한다.
 */
export interface LinkRequest {
  tabKey: string;
  url: string;
  /** OSC 8 링크에서 화면에 보이던 글자. 실제 주소와 다를 수 있다. */
  shownText?: string;
}

export function parseSafeUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  } catch {
    return null;
  }
}

/** 보이는 글자가 주소처럼 생겼는데 실제 주소의 호스트와 다르면 속이는 링크일 수 있다. */
export function looksMisleading(shownText: string | undefined, url: URL): boolean {
  if (!shownText) return false;
  const m = /([a-z0-9-]+\.)+[a-z]{2,}/i.exec(shownText);
  if (!m) return false;
  const shownHost = m[0].toLowerCase().replace(/^www\./, "");
  const realHost = url.hostname.toLowerCase().replace(/^www\./, "");
  return shownHost !== realHost && !realHost.endsWith(`.${shownHost}`);
}

export function requestOpenLink(req: LinkRequest) {
  const s = useSessions.getState();
  if (s.prompts.some((p) => p.kind === "link")) return;
  s.pushPrompt({ kind: "link", data: req });
}

export async function openExternal(url: string) {
  const safe = parseSafeUrl(url);
  if (!safe) return;
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(safe.href);
  } catch {
    window.open(safe.href, "_blank", "noopener,noreferrer");
  }
}
