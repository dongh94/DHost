import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
const devPort = Number(process.env.DHOST_DEV_PORT) || 1420;

export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  // 개발용 가짜 백엔드(?mock)가 쓰는 모듈. 미리 묶어 두지 않으면 처음 쓸 때 "Outdated Optimize Dep" 오류가 난다.
  optimizeDeps: {
    include: [
      "@tauri-apps/api/mocks",
      "@tauri-apps/api/app",
      "@tauri-apps/plugin-dialog",
      "@tauri-apps/plugin-opener",
      "@tauri-apps/plugin-updater",
      "@tauri-apps/plugin-process",
    ],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  //    DHOST_DEV_PORT로 바꿀 수 있다 (기본 1420). `pnpm app`은 1421을 쓴다.
  server: {
    port: devPort,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: devPort + 1,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
