import { describe, expect, it } from "vitest";
import { analyzePaste, stripControls, stripTrailingNewline, visualize } from "./paste";

describe("analyzePaste", () => {
  it("한 줄 일반 텍스트는 바로 붙여넣는다", () => {
    const a = analyzePaste("ls -al /var/log");
    expect(a.needsConfirm).toBe(false);
    expect(a.lines).toBe(1);
  });

  it("한글과 탭은 위험하지 않다", () => {
    expect(analyzePaste("echo '안녕하세요'\tok").needsConfirm).toBe(false);
  });

  it("여러 줄은 확인을 받는다", () => {
    const a = analyzePaste("cd /tmp\nrm -rf ./*\n");
    expect(a.needsConfirm).toBe(true);
    expect(a.hasNewline).toBe(true);
    expect(a.onlyTrailingNewline).toBe(false);
    expect(a.lines).toBe(2);
  });

  it("끝에 줄바꿈 하나만 있어도 실행되므로 확인을 받는다", () => {
    const a = analyzePaste("systemctl restart nginx\n");
    expect(a.needsConfirm).toBe(true);
    expect(a.onlyTrailingNewline).toBe(true);
    expect(a.lines).toBe(1);
  });

  it("CRLF도 줄바꿈으로 센다", () => {
    expect(analyzePaste("a\r\nb").lines).toBe(2);
    expect(analyzePaste("a\rb").hasNewline).toBe(true);
  });

  it("bracketed paste 탈출 시퀀스를 잡는다", () => {
    const a = analyzePaste("echo hi\x1b[201~rm -rf ~");
    expect(a.bracketEscape).toBe(true);
    expect(a.controls.map((c) => c.name)).toContain("ESC");
    expect(a.needsConfirm).toBe(true);
  });

  it("C0·DEL·C1 제어문자를 종류별로 센다", () => {
    const a = analyzePaste("a\x03b\x03c\x7fd\u009be");
    expect(a.controls).toEqual([
      { code: 0x03, name: "Ctrl+C (ETX)", count: 2 },
      { code: 0x7f, name: "DEL", count: 1 },
      { code: 0x9b, name: "CSI (C1)", count: 1 },
    ]);
  });

  it("아주 긴 한 줄도 확인을 받는다", () => {
    expect(analyzePaste("x".repeat(5000)).needsConfirm).toBe(true);
  });
});

describe("정리 함수", () => {
  it("제어문자만 지우고 줄바꿈·탭·한글은 남긴다", () => {
    expect(stripControls("a\x1b[201~b\tc\n한\x00")).toBe("a[201~b\tc\n한");
  });

  it("끝 줄바꿈 하나만 지운다", () => {
    expect(stripTrailingNewline("cmd\n")).toBe("cmd");
    expect(stripTrailingNewline("cmd\r\n")).toBe("cmd");
    expect(stripTrailingNewline("a\nb\n")).toBe("a\nb");
  });

  it("미리보기에서 제어문자를 기호로 보여준다", () => {
    expect(visualize("a\x1bb\x03")).toBe("a␛b␃");
  });
});
