#!/usr/bin/env node

const { execFileSync } = require("child_process");
const { existsSync, rmSync } = require("fs");
const { resolve } = require("path");

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

  const localPkg = resolve(
    __dirname,
    "..",
    "node_modules",
    ".bin",
    process.platform === "win32" ? "pkg.cmd" : "pkg"
  );
  const pkgCommand = existsSync(localPkg)
    ? [localPkg, []]
    : [process.platform === "win32" ? "npx.cmd" : "npx", ["--yes", "@yao-pkg/pkg"]];

  const [command, commandPrefix] = pkgCommand;
  console.log(`[release] target=${target}`);
  console.log(`[release] command=${command}`);
  execFileSync(
    command,
    [...commandPrefix, ".", "--targets", target, "--output", `release/${outputName}`],
    {
      stdio: "inherit"
    }
  );
}

main();
