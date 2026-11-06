import { describe, expect, it } from "vitest";
import { shortKeyType, shortTime } from "./format";

const at = (s: string) => Math.floor(new Date(s).getTime() / 1000);
const now = new Date("2026-11-06T15:00:00");

describe("shortTime", () => {
  it("오늘은 시각만", () => {
    expect(shortTime(at("2026-11-06T14:42:00"), now)).toBe("오후 2:42");
  });
  it("올해는 월·일과 시각", () => {
    const s = shortTime(at("2026-03-05T09:07:00"), now);
    expect(s).toMatch(/^3\. 5\. 오전 9:07$/);
  });
  it("작년 이전은 날짜만", () => {
    expect(shortTime(at("2025-12-31T23:00:00"), now)).toBe("2025. 12. 31.");
  });
});

describe("shortKeyType", () => {
  it("키 종류를 짧게", () => {
    expect(shortKeyType("ssh-ed25519")).toBe("ED25519");
    expect(shortKeyType("ecdsa-sha2-nistp256")).toBe("ECDSA");
    expect(shortKeyType("rsa-sha2-512")).toBe("RSA");
    expect(shortKeyType("ssh-rsa")).toBe("RSA");
    expect(shortKeyType("sk-ssh-ed25519@openssh.com")).toBe("ED25519-SK");
    expect(shortKeyType("something")).toBe("something");
  });
});
