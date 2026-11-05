import { invoke } from "@tauri-apps/api/core";

export interface EngineInfo {
  name: string;
  version: string;
  supported: boolean;
}

export const api = {
  sshEngineInfo: () => invoke<EngineInfo>("ssh_engine_info"),
};
