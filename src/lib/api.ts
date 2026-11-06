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

export interface Customer {
  id: string;
  name: string;
}

export interface Folder {
  id: string;
  customerId: string;
  name: string;
}

export interface Server {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  customerId: string | null;
  folderId: string | null;
  jumpServerId: string | null;
  isProduction: boolean;
  favorite: boolean;
  note: string;
  lastConnectedAt: number | null;
}

export type ServerInput = Omit<Server, "id" | "lastConnectedAt">;

export interface Catalog {
  customers: Customer[];
  folders: Folder[];
  servers: Server[];
}

export interface HostKey {
  id: number;
  host: string;
  keyType: string;
  key: string;
  fingerprint: string;
  addedAt: number;
}

function channelOf(onOutput: (bytes: Uint8Array) => void) {
  const channel = new Channel<unknown>();
  channel.onmessage = (msg) => onOutput(toBytes(msg));
  return channel;
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
  ) => invoke<string>("session_open", { request, cols, rows, onOutput: channelOf(onOutput) }),
  serverConnect: (serverId: string, cols: number, rows: number, onOutput: (bytes: Uint8Array) => void) =>
    invoke<string>("server_connect", { serverId, cols, rows, onOutput: channelOf(onOutput) }),
  sessionWrite: (sessionId: string, data: string) =>
    invoke<void>("session_write", { sessionId, data }),
  sessionResize: (sessionId: string, cols: number, rows: number) =>
    invoke<void>("session_resize", { sessionId, cols, rows }),
  sessionClose: (sessionId: string) => invoke<void>("session_close", { sessionId }),

  answerHostKey: (requestId: string, trust: boolean) =>
    invoke<boolean>("answer_hostkey", { requestId, trust }),
  answerAskpass: (requestId: string, secret: string | null) =>
    invoke<boolean>("answer_askpass", { requestId, secret }),

  catalog: () => invoke<Catalog>("catalog"),
  customerCreate: (name: string) => invoke<Customer>("customer_create", { name }),
  customerRename: (id: string, name: string) => invoke<void>("customer_rename", { id, name }),
  customerDelete: (id: string) => invoke<void>("customer_delete", { id }),
  folderCreate: (customerId: string, name: string) => invoke<Folder>("folder_create", { customerId, name }),
  folderRename: (id: string, name: string) => invoke<void>("folder_rename", { id, name }),
  folderDelete: (id: string) => invoke<void>("folder_delete", { id }),
  serverCreate: (input: ServerInput) => invoke<Server>("server_create", { input }),
  serverUpdate: (id: string, input: ServerInput) => invoke<Server>("server_update", { id, input }),
  serverSetFavorite: (id: string, favorite: boolean) => invoke<void>("server_set_favorite", { id, favorite }),
  serverDelete: (id: string) => invoke<void>("server_delete", { id }),
  hostKeyList: () => invoke<HostKey[]>("hostkey_list"),
  hostKeyDelete: (id: number) => invoke<void>("hostkey_delete", { id }),
};
