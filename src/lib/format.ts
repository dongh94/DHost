/** 표에서 쓰는 짧은 표기. 줄바꿈 없이 한 줄에 들어가게 하고, 전체 값은 title(마우스 올리면 보임)로 준다. */

const time = new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit" });
const dayTime = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
const date = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "numeric", day: "numeric" });
const full = new Intl.DateTimeFormat("ko-KR", { dateStyle: "long", timeStyle: "medium" });

/** 오늘이면 "오후 2:42", 올해면 "11. 6. 오후 2:42", 그 전이면 "2025. 11. 6." */
export function shortTime(epochSeconds: number, now: Date = new Date()): string {
  const d = new Date(epochSeconds * 1000);
  if (d.toDateString() === now.toDateString()) return time.format(d);
  if (d.getFullYear() === now.getFullYear()) return dayTime.format(d);
  return date.format(d);
}

/** 마우스를 올렸을 때 보여 줄 전체 날짜와 시각 */
export function fullTime(epochSeconds: number): string {
  return full.format(new Date(epochSeconds * 1000));
}

/** "ssh-ed25519" → "ED25519", "ecdsa-sha2-nistp256" → "ECDSA", "ssh-rsa" → "RSA" */
export function shortKeyType(keyType: string): string {
  const t = keyType.toLowerCase();
  if (t.includes("ed25519")) return t.startsWith("sk-") ? "ED25519-SK" : "ED25519";
  if (t.startsWith("ecdsa") || t.startsWith("sk-ecdsa")) return t.startsWith("sk-") ? "ECDSA-SK" : "ECDSA";
  if (t.includes("rsa")) return "RSA";
  if (t.includes("dss")) return "DSA";
  return keyType;
}
