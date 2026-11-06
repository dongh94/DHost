import { create } from "zustand";
import type { AskpassPrompt, ConnectRequest, HostKeyChanged, HostKeyPrompt } from "../lib/api";
import type { PasteAnalysis } from "../lib/paste";

export type SessionStatus = "connecting" | "connected" | "closed";

/** 접속 방법: 저장된 서버 프로필 또는 빠른 접속 */
export type SessionSource = { type: "server"; serverId: string } | { type: "quick"; request: ConnectRequest };

export interface SessionTab {
  /** 화면 탭 키. 재접속해도 유지된다. */
  key: string;
  title: string;
  subtitle: string;
  source: SessionSource;
  production: boolean;
  /** 백엔드 세션 ID. 재접속하면 바뀐다. */
  sessionId: string | null;
  status: SessionStatus;
  exitCode: number | null;
}

export type Prompt =
  | { kind: "hostkey"; data: HostKeyPrompt }
  | { kind: "changed"; data: HostKeyChanged }
  | { kind: "askpass"; data: AskpassPrompt }
  | { kind: "paste"; data: { tabKey: string; text: string; analysis: PasteAnalysis } };

interface SessionsState {
  tabs: SessionTab[];
  activeKey: string | null;
  prompts: Prompt[];
  addTab: (tab: SessionTab) => void;
  updateTab: (key: string, patch: Partial<SessionTab>) => void;
  removeTab: (key: string) => void;
  setActive: (key: string) => void;
  pushPrompt: (p: Prompt) => void;
  shiftPrompt: () => void;
}

export const useSessions = create<SessionsState>((set) => ({
  tabs: [],
  activeKey: null,
  prompts: [],
  addTab: (tab) => set((s) => ({ tabs: [...s.tabs, tab], activeKey: tab.key })),
  updateTab: (key, patch) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.key === key ? { ...t, ...patch } : t)) })),
  removeTab: (key) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.key !== key);
      const activeKey = s.activeKey === key ? (tabs[tabs.length - 1]?.key ?? null) : s.activeKey;
      return { tabs, activeKey };
    }),
  setActive: (key) => set({ activeKey: key }),
  pushPrompt: (p) => set((s) => ({ prompts: [...s.prompts, p] })),
  shiftPrompt: () => set((s) => ({ prompts: s.prompts.slice(1) })),
}));
