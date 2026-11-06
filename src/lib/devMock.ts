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
        case "history_list":
          return [
            { id: 3, serverId: "s2", title: "web-01", target: "ops@192.0.2.11:22", via: "bastion", startedAt: now - 7200, endedAt: now - 5400, result: "closed", exitCode: 0 },
            { id: 2, serverId: "s2", title: "web-01", target: "ops@192.0.2.11:22", via: "bastion", startedAt: now - 7300, endedAt: now - 7290, result: "auth_failed", exitCode: 255 },
            { id: 1, serverId: "s5", title: "gw-01", target: "ops@198.51.100.5:22", via: null, startedAt: now - 86400, endedAt: now - 86398, result: "hostkey_changed", exitCode: 255 },
          ];
        case "known_hosts_scan":
          return {
            candidates: [
              { host: "bastion.example.com", keyType: "ssh-ed25519", key: "AAAA...", fingerprint: hostKeys[0].fingerprint, alreadyTrusted: true },
              { host: "[192.0.2.21]:2222", keyType: "ssh-ed25519", key: "BBBB...", fingerprint: "SHA256:example1111111111111111111111111111111111", alreadyTrusted: false },
              { host: "198.51.100.5", keyType: "ecdsa-sha2-nistp256", key: "CCCC...", fingerprint: "SHA256:example2222222222222222222222222222222222", alreadyTrusted: false },
            ],
            hashed: 4,
            skipped: 1,
          };
        case "ssh_config_scan":
          return [
            { alias: "jump", host: "192.0.2.1", port: 22, user: "ops", proxyJump: null, problem: null },
            { alias: "app-01", host: "192.0.2.31", port: 22, user: "ops", proxyJump: "jump", problem: null },
            { alias: "far", host: "192.0.2.41", port: 22, user: "ops", proxyJump: "a,b", problem: "여러 단계 경유는 지원하지 않아 경유 없이 가져옵니다" },
          ];
        case "server_effective_config":
          return [
            { key: "hostname", value: "192.0.2.11", forced: false },
            { key: "user", value: "ops", forced: true },
            { key: "port", value: "22", forced: true },
            { key: "identityfile", value: "~/.ssh/id_ed25519", forced: false },
            { key: "stricthostkeychecking", value: "true", forced: true },
            { key: "userknownhostsfile", value: "none", forced: true },
            { key: "proxycommand", value: "/usr/bin/ssh ... -W [%h]:%p -- 'bastion.example.com'", forced: true },
            { key: "ciphers", value: "chacha20-poly1305@openssh.com,aes128-ctr", forced: false },
          ];
        case "plugin:dialog|save":
          return "/Users/me/Documents/DHost-20261106.dhost-backup";
        case "plugin:dialog|open":
          return "/Users/me/Documents/DHost-20261101.dhost-backup";
        case "backup_export":
          return catalog.servers.length;
        case "backup_preview":
          return {
            exportedAt: now - 86400 * 5,
            appVersion: "0.1.0",
            customers: 2,
            folders: 3,
            servers: 7,
            productionServers: 3,
            hostKeys: 4,
            settings: 2,
            duplicates: 5,
            problems: ["서버 'legacy-01': 호스트 이름이 올바르지 않습니다: -oProxyCommand=x", "호스트 키 'old.example.com': 지문이 키와 맞지 않아 가져오지 않습니다"],
          };
        case "backup_restore":
          return { customers: 0, folders: 1, servers: 2, hostKeys: 3, settings: 2, skipped: ["서버 'bastion': 같은 서버가 이미 있습니다"] };
        case "server_password_saved":
          return a.id === "s1";
        case "settings_get":
          return {};
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
