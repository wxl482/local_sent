import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const desktopDir = resolve(__dirname, "..");
const projectRoot = resolve(desktopDir, "..");

function resolveSourceBinaryName() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "darwin" && arch === "arm64") {
    return "local_sent-macos-arm64";
  }
  if (platform === "darwin" && arch === "x64") {
    return "local_sent-macos-x64";
  }
  if (platform === "win32" && arch === "x64") {
    return "local_sent-win-x64.exe";
  }
  if (platform === "win32" && arch === "arm64") {
    return "local_sent-win-arm64.exe";
  }
  if (platform === "linux" && arch === "x64") {
    return "local_sent-linux-x64";
  }
  if (platform === "linux" && arch === "arm64") {
    return "local_sent-linux-arm64";
  }

  throw new Error(`unsupported host platform/arch: ${platform}/${arch}`);
}

function resolveBundleBinaryName() {
  return process.platform === "win32" ? "local_sent_cli.exe" : "local_sent_cli";
}

function main() {
  const sourceName = resolveSourceBinaryName();
  const sourcePath = join(projectRoot, "release", sourceName);
  if (!existsSync(sourcePath)) {
    throw new Error(`missing source binary: ${sourcePath}`);
  }

  const binDir = join(desktopDir, "src-tauri", "bin");
  mkdirSync(binDir, { recursive: true });

  const bundleName = resolveBundleBinaryName();
  const bundlePath = join(binDir, bundleName);
  copyFileSync(sourcePath, bundlePath);
  if (process.platform !== "win32") {
    chmodSync(bundlePath, 0o755);
  }
  console.log(`[prepare-cli-bin] ${sourcePath} -> ${bundlePath}`);
}

main();
