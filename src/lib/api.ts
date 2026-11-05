import { Channel, invoke } from "@tauri-apps/api/core";

export interface EngineInfo {
  name: string;
  version: string;
  supported: boolean;
}

export interface Endpoint {
  host: string;
  port: number;
  user: string;
}

export interface ConnectRequest {
  target: Endpoint;
  jump: Endpoint | null;
}

export interface HostKeyPrompt {
  requestId: string;
  sessionId: string;
  host: string;
  keyType: string;
  fingerprint: string;
}

export interface HostKeyChanged {
  sessionId: string;
  host: string;
  keyType: string;
  fingerprint: string;
  knownFingerprints: string[];
}

export interface AskpassPrompt {
  requestId: string;
  sessionId: string;
  prompt: string;
  confirm: boolean;
}

export interface SessionExit {
  sessionId: string;
  exitCode: number | null;
}

function toBytes(msg: unknown): Uint8Array {
  if (msg instanceof ArrayBuffer) return new Uint8Array(msg);
  if (msg instanceof Uint8Array) return msg;
  if (Array.isArray(msg)) return Uint8Array.from(msg);
  return new Uint8Array();
}

export const api = {
  sshEngineInfo: () => invoke<EngineInfo>("ssh_engine_info"),

  sessionOpen: (
    request: ConnectRequest,
    cols: number,
    rows: number,
    onOutput: (bytes: Uint8Array) => void,
  ) => {
    const channel = new Channel<unknown>();
    channel.onmessage = (msg) => onOutput(toBytes(msg));
    return invoke<string>("session_open", { request, cols, rows, onOutput: channel });
  },
  sessionWrite: (sessionId: string, data: string) =>
    invoke<void>("session_write", { sessionId, data }),
  sessionResize: (sessionId: string, cols: number, rows: number) =>
    invoke<void>("session_resize", { sessionId, cols, rows }),
  sessionClose: (sessionId: string) => invoke<void>("session_close", { sessionId }),

  answerHostKey: (requestId: string, trust: boolean) =>
    invoke<boolean>("answer_hostkey", { requestId, trust }),
  answerAskpass: (requestId: string, secret: string | null) =>
    invoke<boolean>("answer_askpass", { requestId, secret }),
};
