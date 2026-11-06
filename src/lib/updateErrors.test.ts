import { describe, expect, it } from "vitest";
import { describeUpdateError } from "./updateErrors";

describe("describeUpdateError", () => {
  it("공개된 Release가 없을 때(404)", () => {
    const r = describeUpdateError("Could not fetch a valid release JSON from the remote");
    expect(r.kind).toBe("no-release");
    expect(r.message).toContain("공개된 배포가 없습니다");
    expect(r.detail).toContain("valid release JSON");
  });

  it("네트워크 오류", () => {
    for (const e of [
      "error sending request for url (https://github.com/...)",
      "dns error: failed to lookup address information",
      "operation timed out",
      "tcp connect error: Connection refused",
    ]) {
      expect(describeUpdateError(e).kind).toBe("network");
    }
  });

  it("서명 오류는 설치하지 않았다고 알린다", () => {
    const r = describeUpdateError(new Error("The signature verification failed"));
    expect(r.kind).toBe("signature");
    expect(r.message).toContain("설치하지 않았습니다");
  });

  it("권한·플랫폼 오류", () => {
    expect(describeUpdateError("Permission denied (os error 13)").kind).toBe("permission");
    expect(describeUpdateError("the platform `darwin-aarch64` was not found on the response").kind).toBe("platform");
  });

  it("모르는 오류는 일반 안내와 원문을 남긴다", () => {
    const r = describeUpdateError("something weird");
    expect(r.kind).toBe("unknown");
    expect(r.detail).toBe("something weird");
  });
});
