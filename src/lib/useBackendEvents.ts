import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import type { AskpassPrompt, HostKeyChanged, HostKeyPrompt, SessionExit } from "./api";
import { markExited } from "./connect";
import { useSessions } from "../stores/sessions";

export function useBackendEvents() {
  useEffect(() => {
    const push = useSessions.getState().pushPrompt;
    const subs = [
      listen<HostKeyPrompt>("hostkey-prompt", (e) => push({ kind: "hostkey", data: e.payload })),
      listen<HostKeyChanged>("hostkey-changed", (e) => push({ kind: "changed", data: e.payload })),
      listen<AskpassPrompt>("askpass-prompt", (e) => push({ kind: "askpass", data: e.payload })),
      listen<SessionExit>("session-exit", (e) => markExited(e.payload.sessionId, e.payload.exitCode)),
    ];
    return () => {
      subs.forEach((p) => void p.then((unlisten) => unlisten()));
    };
  }, []);
}
