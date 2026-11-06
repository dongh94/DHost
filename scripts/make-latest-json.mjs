#!/usr/bin/env node
// 앱 안 업데이트가 읽는 latest.json을 만든다. Release 워크플로에서 쓴다.
//   node scripts/make-latest-json.mjs <버전> <업데이트 파일 이름> <.sig 경로> <변경 내용 파일> > latest.json
// 앱은 https://github.com/dongh94/DHost/releases/latest/download/latest.json 을 읽는다 (tauri.conf.json).
import { readFileSync } from "node:fs";

const [version, assetName, sigPath, notesPath] = process.argv.slice(2);
if (!version || !assetName || !sigPath) {
  console.error("사용법: make-latest-json.mjs <버전> <파일 이름> <.sig 경로> [변경 내용 파일]");
  process.exit(1);
}
const repo = process.env.GITHUB_REPOSITORY ?? "dongh94/DHost";
const manifest = {
  version,
  notes: notesPath ? readFileSync(notesPath, "utf8").trim() : "",
  pub_date: new Date().toISOString(),
  platforms: {
    "darwin-aarch64": {
      signature: readFileSync(sigPath, "utf8").trim(),
      url: `https://github.com/${repo}/releases/download/v${version}/${assetName}`,
    },
  },
};
process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
