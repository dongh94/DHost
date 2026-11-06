import { create } from "zustand";
import { isTauri } from "@tauri-apps/api/core";

/**
 * 앱 안 업데이트. GitHub 최신 Release의 latest.json을 보고 새 버전이 있으면 알린다.
 * 설치는 사용자가 누를 때만 한다. 내려받은 파일은 앱에 넣어 둔 공개키로 서명을 확인한 뒤 설치된다.
 */
export type UpdateStatus = "idle" | "checking" | "none" | "available" | "downloading" | "installing" | "error";

export interface UpdateInfo {
  version: string;
  notes: string;
  date: string | null;
}

/** 실제 업데이트 객체(플러그인)를 감싼 최소 인터페이스. 미리보기에서는 가짜를 쓴다. */
interface Installer {
  download(onProgress: (downloaded: number, total: number | null) => void): Promise<void>;
  relaunch(): Promise<void>;
}

interface UpdateState {
  currentVersion: string | null;
  status: UpdateStatus;
  info: UpdateInfo | null;
  progress: { downloaded: number; total: number | null } | null;
  error: string | null;
  lastChecked: number | null;
  dialogOpen: boolean;
  check: (manual?: boolean) => Promise<void>;
  install: () => Promise<void>;
  openDialog: () => void;
  closeDialog: () => void;
}

let installer: Installer | null = null;

const mock = () => (window as unknown as { __DHOST_MOCK__?: { update?: boolean } }).__DHOST_MOCK__;

async function realCheck(): Promise<{ info: UpdateInfo; installer: Installer } | null> {
  const { check } = await import("@tauri-apps/plugin-updater");
  const { relaunch } = await import("@tauri-apps/plugin-process");
  const update = await check();
  if (!update) return null;
  return {
    info: { version: update.version, notes: update.body ?? "", date: update.date ?? null },
    installer: {
      async download(onProgress) {
        let downloaded = 0;
        let total: number | null = null;
        await update.downloadAndInstall((e) => {
          if (e.event === "Started") total = e.data.contentLength ?? null;
          if (e.event === "Progress") downloaded += e.data.chunkLength;
          onProgress(downloaded, total);
        });
      },
      relaunch,
    },
  };
}

async function mockCheck(): Promise<{ info: UpdateInfo; installer: Installer } | null> {
  await new Promise((r) => setTimeout(r, 400));
  if (!mock()?.update) return null;
  return {
    info: { version: "0.2.0", notes: "- 앱 안 업데이트 추가\n- 접속 안정성 개선", date: new Date().toISOString() },
    installer: {
      async download(onProgress) {
        const total = 6_000_000;
        for (let d = 0; d <= total; d += 1_000_000) {
          onProgress(d, total);
          await new Promise((r) => setTimeout(r, 150));
        }
      },
      async relaunch() {
        location.reload();
      },
    },
  };
}

export const useUpdate = create<UpdateState>((set, get) => ({
  currentVersion: null,
  status: "idle",
  info: null,
  progress: null,
  error: null,
  lastChecked: null,
  dialogOpen: false,

  check: async (manual = false) => {
    const s = get().status;
    if (s === "checking" || s === "downloading" || s === "installing") return;
    if (!isTauri()) return;
    set({ status: "checking", error: null });
    try {
      if (!get().currentVersion) {
        const version = mock() ? "0.1.0" : await (await import("@tauri-apps/api/app")).getVersion();
        set({ currentVersion: version });
      }
      const found = mock() ? await mockCheck() : await realCheck();
      installer = found?.installer ?? null;
      set({
        status: found ? "available" : "none",
        info: found?.info ?? null,
        lastChecked: Date.now(),
        // 직접 확인을 눌렀을 때만 창을 연다. 자동 확인은 작업을 방해하지 않게 상태 표시줄에만 알린다.
        dialogOpen: manual && !!found,
      });
    } catch (e) {
      // 자동 확인 실패(오프라인 등)는 조용히 넘긴다. 직접 확인했을 때만 오류를 보여 준다.
      set({ status: manual ? "error" : "idle", error: manual ? String(e) : null, lastChecked: Date.now() });
    }
  },

  install: async () => {
    if (!installer) return;
    set({ status: "downloading", progress: { downloaded: 0, total: null }, error: null });
    try {
      await installer.download((downloaded, total) => set({ progress: { downloaded, total } }));
      set({ status: "installing" });
      // 다시 시작하면 앱 종료 처리에서 열린 ssh 세션을 모두 정리한다.
      await installer.relaunch();
    } catch (e) {
      set({ status: "error", error: String(e) });
    }
  },

  openDialog: () => set({ dialogOpen: true }),
  closeDialog: () => set((s) => ({ dialogOpen: s.status === "downloading" || s.status === "installing" })),
}));

const SIX_HOURS = 6 * 60 * 60 * 1000;

/** 앱 시작 후 잠시 뒤 한 번, 그 뒤 6시간마다 확인한다. 정리 함수를 돌려준다. */
export function startUpdateChecks() {
  const first = setTimeout(() => void useUpdate.getState().check(), 5_000);
  const every = setInterval(() => void useUpdate.getState().check(), SIX_HOURS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
