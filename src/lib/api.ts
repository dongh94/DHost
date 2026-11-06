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

/** 진단 코드별 짧은 이름 (이력 화면용) */
export const reasonLabels: Record<string, string> = {
  dns: "주소 없음",
  refused: "연결 거부",
  timeout: "시간 초과",
  unreachable: "네트워크 없음",
  closed_early: "서버가 끊음",
  not_ssh: "SSH 아님",
  auth_password: "비밀번호 틀림",
  auth_key_only: "키 전용 서버",
  auth_too_many: "시도 횟수 초과",
  auth_failed: "로그인 실패",
  kex_legacy: "보안 방식 불일치",
  forward_denied: "경유 차단",
  forward_failed: "경유 후 연결 실패",
  lost: "연결 끊김",
  hostkey_rejected: "키 승인 안 함",
  hostkey_changed: "키 변경",
  unknown: "알 수 없음",
};

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
  /** 저장된 서버 프로필이라 키체인에 저장할 수 있다 */
  canSave: boolean;
  /** 앞서 넣은 비밀번호가 틀려서 다시 묻는다 */
  retry: boolean;
  /** 저장돼 있던 비밀번호가 틀려서 지웠다 */
  savedWasWrong: boolean;
}

export type HistoryResult =
  | "connecting"
  | "closed"
  | "auth_failed"
  | "hostkey_rejected"
  | "hostkey_changed"
  | "cancelled"
  | "error"
  | "interrupted";

export interface HistoryEntry {
  id: number;
  serverId: string | null;
  title: string;
  target: string;
  via: string | null;
  startedAt: number;
  endedAt: number | null;
  result: HistoryResult;
  exitCode: number | null;
  reason: string | null;
}

export interface Diagnosis {
  code: string;
  title: string;
  detail: string;
  hints: string[];
  /** 실패한 구간 (예: "경유 서버 bastion") */
  hop: string | null;
}

export interface SessionExit {
  sessionId: string;
  exitCode: number | null;
  diagnosis: Diagnosis | null;
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
  /** 개인키 파일 경로 (선택). 키 내용은 저장하지 않는다. */
  identityFile: string | null;
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

export interface KnownHostCandidate {
  host: string;
  keyType: string;
  key: string;
  fingerprint: string;
  alreadyTrusted: boolean;
}

export interface KnownHostsScan {
  candidates: KnownHostCandidate[];
  hashed: number;
  skipped: number;
}

export interface ConfigCandidate {
  alias: string;
  host: string;
  port: number;
  user: string;
  proxyJump: string | null;
  /** config에 직접 적은 IdentityFile */
  identityFile: string | null;
  problem: string | null;
}

export interface ImportSummary {
  created: number;
  skipped: [string, string][];
  warnings: [string, string][];
}

export interface ConfigEntry {
  key: string;
  value: string;
  forced: boolean;
}

export interface BackupPreview {
  exportedAt: number;
  appVersion: string;
  customers: number;
  folders: number;
  servers: number;
  productionServers: number;
  hostKeys: number;
  settings: number;
  duplicates: number;
  problems: string[];
}

export interface RestoreOptions {
  mode: "merge" | "replace";
  hostKeys: boolean;
  settings: boolean;
}

export interface RestoreReport {
  customers: number;
  folders: number;
  servers: number;
  hostKeys: number;
  settings: number;
  skipped: string[];
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
  sessionFlow: (sessionId: string, paused: boolean) => invoke<void>("session_flow", { sessionId, paused }),
  sessionResize: (sessionId: string, cols: number, rows: number) =>
    invoke<void>("session_resize", { sessionId, cols, rows }),
  sessionClose: (sessionId: string) => invoke<void>("session_close", { sessionId }),

  answerHostKey: (requestId: string, trust: boolean) =>
    invoke<boolean>("answer_hostkey", { requestId, trust }),
  answerAskpass: (requestId: string, secret: string | null, save = false) =>
    invoke<boolean>("answer_askpass", { requestId, secret, save }),
  serverPasswordSaved: (id: string) => invoke<boolean>("server_password_saved", { id }),
  serverPasswordDelete: (id: string) => invoke<void>("server_password_delete", { id }),
  historyList: () => invoke<HistoryEntry[]>("history_list"),
  historyClear: () => invoke<void>("history_clear"),
  knownHostsScan: () => invoke<KnownHostsScan>("known_hosts_scan"),
  knownHostsImport: (items: Pick<KnownHostCandidate, "host" | "keyType" | "key">[]) =>
    invoke<number>("known_hosts_import", { items }),
  sshConfigScan: () => invoke<ConfigCandidate[]>("ssh_config_scan"),
  sshConfigImport: (items: ConfigCandidate[], customerId: string | null) =>
    invoke<ImportSummary>("ssh_config_import", { items, customerId }),
  backupExport: (path: string, includeHostKeys: boolean) =>
    invoke<number>("backup_export", { path, includeHostKeys }),
  backupPreview: (path: string) => invoke<BackupPreview>("backup_preview", { path }),
  backupRestore: (path: string, options: RestoreOptions) => invoke<RestoreReport>("backup_restore", { path, options }),
  serverEffectiveConfig: (id: string) => invoke<ConfigEntry[]>("server_effective_config", { id }),

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
