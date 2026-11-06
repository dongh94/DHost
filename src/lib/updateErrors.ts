/**
 * 업데이트 플러그인의 영어 오류를 사용자에게 보여 줄 한국어 안내로 바꾼다.
 * 원래 메시지는 `detail`로 남겨 관리자에게 전달할 수 있게 한다.
 */
export type UpdateErrorKind = "no-release" | "network" | "signature" | "permission" | "platform" | "unknown";

export interface UpdateErrorInfo {
  kind: UpdateErrorKind;
  message: string;
  detail: string;
}

// 위에서부터 차례로 맞춰 본다. 플랫폼 오류 문구에도 "not found"가 들어 있어 먼저 본다.
const rules: { kind: UpdateErrorKind; test: RegExp; message: string }[] = [
  {
    kind: "platform",
    test: /platform|target .*not found|darwin-/i,
    message: "이 Mac에 맞는 업데이트 파일이 없습니다. 관리자에게 알려 주세요.",
  },
  {
    // latest.json이 없음: 아직 Publish한 Release가 없거나 파일이 빠짐 (GitHub은 404를 돌려준다)
    kind: "no-release",
    test: /valid release json|status code:?\s*404|\b404\b|not found/i,
    message: "아직 공개된 배포가 없습니다. 관리자가 새 버전을 공개하면 여기서 확인할 수 있습니다.",
  },
  {
    kind: "signature",
    test: /signature|minisign|public key|verif/i,
    message: "업데이트 파일의 서명이 맞지 않아 설치하지 않았습니다. 관리자에게 알려 주세요.",
  },
  {
    kind: "permission",
    test: /permission denied|operation not permitted|read-only|access is denied/i,
    message: "앱을 바꿀 권한이 없습니다. DHost가 응용 프로그램 폴더에 있는지 확인하세요.",
  },
  {
    kind: "network",
    test: /error sending request|dns|resolve|timed? ?out|connection (refused|reset|closed)|network|offline|tcp connect|unreachable|certificate|tls|ssl/i,
    message: "GitHub에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도하세요.",
  },
];

export function describeUpdateError(raw: unknown): UpdateErrorInfo {
  const detail = String(raw instanceof Error ? raw.message : raw).trim();
  const hit = rules.find((r) => r.test.test(detail));
  return {
    kind: hit?.kind ?? "unknown",
    message: hit?.message ?? "업데이트를 확인하지 못했습니다. 잠시 뒤 다시 시도하세요.",
    detail,
  };
}
