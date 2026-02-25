#!/usr/bin/env node

const { execFileSync } = require("child_process");
const { existsSync, rmSync } = require("fs");

function resolveTarget() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "darwin" && arch === "arm64") {
    return "node20-macos-arm64";
  }
  if (platform === "darwin" && arch === "x64") {
    return "node20-macos-x64";
  }
  if (platform === "linux" && arch === "x64") {
    return "node20-linux-x64";
  }
  if (platform === "linux" && arch === "arm64") {
    return "node20-linux-arm64";
  }
  if (platform === "win32" && arch === "x64") {
    return "node20-win-x64";
  }
  if (platform === "win32" && arch === "arm64") {
    return "node20-win-arm64";
  }

  throw new Error(`unsupported host platform/arch: ${platform}/${arch}`);
}

function main() {
  const target = resolveTarget();
  const suffix = target.replace(/^node\d+-/, "");
  const outputName = `local_sent-${suffix}${process.platform === "win32" ? ".exe" : ""}`;
  const legacyOutput = "release/local_sent";
  if (existsSync(legacyOutput)) {
    rmSync(legacyOutput, { force: true });
  }
  console.log(`[release] target=${target}`);
  execFileSync("pkg", [".", "--targets", target, "--output", `release/${outputName}`], {
    stdio: "inherit"
  });
}

main();
