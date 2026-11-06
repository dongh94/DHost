import { describe, expect, it } from "vitest";
import { looksMisleading, parseSafeUrl } from "./links";

describe("parseSafeUrl", () => {
  it("http와 https만 허용한다", () => {
    expect(parseSafeUrl("https://example.com/a")?.host).toBe("example.com");
    expect(parseSafeUrl("http://192.0.2.10:8080/")?.port).toBe("8080");
    for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "ssh://x", "data:text/html,hi", "not a url", ""]) {
      expect(parseSafeUrl(bad)).toBeNull();
    }
  });
});

describe("looksMisleading", () => {
  const u = (s: string) => parseSafeUrl(s)!;
  it("보이는 주소와 실제 호스트가 다르면 경고한다", () => {
    expect(looksMisleading("https://bank.example.com", u("https://evil.example.net/login"))).toBe(true);
    expect(looksMisleading("docs.example.org 보기", u("https://example.net"))).toBe(true);
  });
  it("같은 사이트이거나 주소가 아닌 글자면 경고하지 않는다", () => {
    expect(looksMisleading("example.com", u("https://www.example.com/x"))).toBe(false);
    expect(looksMisleading("example.com", u("https://docs.example.com"))).toBe(false);
    expect(looksMisleading("여기를 누르세요", u("https://example.net"))).toBe(false);
    expect(looksMisleading(undefined, u("https://example.net"))).toBe(false);
  });
});
