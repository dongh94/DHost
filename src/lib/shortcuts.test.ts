import { beforeEach, describe, expect, it, vi } from "vitest";

const closed: string[] = [];
vi.mock("./connect", () => ({
  closeTab: (k: string) => closed.push(k),
  reconnect: vi.fn(),
  resetTerminal: vi.fn(),
}));

const { runAction } = await import("./shortcuts");
const { useSessions } = await import("../stores/sessions");
const { useUi } = await import("../stores/ui");

const tab = (key: string, status: "connected" | "closed" = "connected") => ({
  key,
  title: key,
  subtitle: "",
  source: { type: "server" as const, serverId: key },
  production: false,
  sessionId: `sid-${key}`,
  status,
  exitCode: null,
});

let clock = 0;
beforeEach(() => {
  closed.length = 0;
  // 같은 동작을 연달아 테스트해도 중복 제거에 걸리지 않게 시간을 넉넉히 민다.
  clock += 1000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  useSessions.setState({ tabs: [tab("a"), tab("b"), tab("c", "closed")], activeKey: "a", prompts: [] });
  useUi.setState({ page: "servers" });
});

describe("runAction", () => {
  it("⌘숫자로 탭을 고르고 ⌘9는 마지막 탭이다", () => {
    runAction("tab.2");
    expect(useSessions.getState().activeKey).toBe("b");
    expect(useUi.getState().page).toBe("sessions");
    clock += 1000;
    runAction("tab.9");
    expect(useSessions.getState().activeKey).toBe("c");
    clock += 1000;
    runAction("tab.5"); // 없는 탭은 무시
    expect(useSessions.getState().activeKey).toBe("c");
  });

  it("다음·이전 탭은 끝에서 처음으로 돌아간다", () => {
    runAction("tab.prev");
    expect(useSessions.getState().activeKey).toBe("c");
    clock += 1000;
    runAction("tab.next");
    expect(useSessions.getState().activeKey).toBe("a");
  });

  it("메뉴와 keydown이 같은 동작을 두 번 보내도 한 번만 처리한다", () => {
    runAction("tab.next");
    runAction("tab.next");
    expect(useSessions.getState().activeKey).toBe("b");
  });

  it("⌘W는 연결된 탭이면 먼저 묻고, 끊긴 탭은 바로 닫는다", () => {
    useUi.setState({ page: "sessions" });
    runAction("tab.close");
    expect(closed).toEqual([]);
    expect(useSessions.getState().prompts[0]).toEqual({ kind: "closeTab", data: { tabKey: "a" } });

    useSessions.setState({ activeKey: "c", prompts: [] });
    clock += 1000;
    runAction("tab.close");
    expect(closed).toEqual(["c"]);
  });

  it("세션 화면이 아니거나 확인 창이 떠 있으면 탭을 닫지 않는다", () => {
    runAction("tab.close"); // 서버 목록 화면
    expect(useSessions.getState().prompts).toEqual([]);
    useUi.setState({ page: "sessions" });
    useSessions.setState({ activeKey: "c", prompts: [{ kind: "closeTab", data: { tabKey: "a" } }] });
    clock += 1000;
    runAction("tab.close");
    expect(closed).toEqual([]);
  });

  it("⌘T와 ⌘K는 서버 검색창으로 간다", () => {
    useUi.setState({ page: "sessions", searchFocus: 0 });
    runAction("tab.new");
    expect(useUi.getState().page).toBe("servers");
    expect(useUi.getState().searchFocus).toBe(1);
  });
});
