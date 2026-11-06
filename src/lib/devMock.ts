/**
 * 개발용 가짜 백엔드. `pnpm dev`로 브라우저에서 `?mock`을 붙여 열었을 때만 쓴다.
 * 화면 확인용이며 실제 SSH 연결은 하지 않는다. 값은 모두 가상 예제(192.0.2.0/24, example.com)다.
 */
import { mockIPC } from "@tauri-apps/api/mocks";
import type { Catalog, HostKey, Server } from "./api";

export function installDevMock() {
  const now = Math.floor(Date.now() / 1000);
  const s = (p: Partial<Server> & Pick<Server, "id" | "name" | "host">): Server => ({
    port: 22,
    username: "ops",
    customerId: null,
    folderId: null,
    jumpServerId: null,
    isProduction: false,
    favorite: false,
    note: "",
    lastConnectedAt: null,
    ...p,
  });
  const catalog: Catalog = {
    customers: [
      { id: "c1", name: "가나다 물류" },
      { id: "c2", name: "라마바 금융" },
    ],
    folders: [
      { id: "f1", customerId: "c1", name: "운영" },
      { id: "f2", customerId: "c1", name: "개발" },
      { id: "f3", customerId: "c2", name: "DMZ" },
    ],
    servers: [
      s({ id: "s1", name: "bastion", host: "bastion.example.com", customerId: "c1", folderId: "f1", favorite: true, lastConnectedAt: now - 300 }),
      s({ id: "s2", name: "web-01", host: "192.0.2.11", customerId: "c1", folderId: "f1", jumpServerId: "s1", isProduction: true, note: "nginx, 배포는 화요일만", lastConnectedAt: now - 7200 }),
      s({ id: "s3", name: "web-02", host: "192.0.2.12", customerId: "c1", folderId: "f1", jumpServerId: "s1", isProduction: true }),
      s({ id: "s4", name: "dev-api", host: "192.0.2.21", port: 2222, username: "dev", customerId: "c1", folderId: "f2", lastConnectedAt: now - 86400 * 3 }),
      s({ id: "s5", name: "gw-01", host: "198.51.100.5", customerId: "c2", folderId: "f3", isProduction: true, favorite: true }),
      s({ id: "s6", name: "lab-vm", host: "192.0.2.99", username: "root" }),
    ],
  };
  const hostKeys: HostKey[] = [
    { id: 1, host: "bastion.example.com", keyType: "ssh-ed25519", key: "AAAA...", fingerprint: "SHA256:example0000000000000000000000000000000000", addedAt: now - 86400 },
  ];

  (window as unknown as { isTauri: boolean }).isTauri = true;
  mockIPC(
    (cmd, args) => {
      const a = (args ?? {}) as Record<string, unknown>;
      switch (cmd) {
        case "ssh_engine_info":
          return { name: "openssh", version: "OpenSSH_10.3p1 (mock)", supported: true };
        case "catalog":
          return structuredClone(catalog);
        case "hostkey_list":
          return hostKeys;
        case "server_set_favorite": {
          const x = catalog.servers.find((v) => v.id === a.id);
          if (x) x.favorite = a.favorite as boolean;
          return null;
        }
        case "server_connect":
        case "session_open":
          return crypto.randomUUID();
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );
}
