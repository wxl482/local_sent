#!/usr/bin/env node

const { existsSync, readdirSync, statSync } = require("fs");
const { join } = require("path");

function main() {
  const dir = process.argv[2] || "release";
  if (!existsSync(dir)) {
    console.error(`[inspect-release] directory not found: ${dir}`);
    process.exit(1);
  }

  const entries = readdirSync(dir);
  if (entries.length === 0) {
    console.error(`[inspect-release] directory is empty: ${dir}`);
    process.exit(1);
  }

  for (const name of entries) {
    const fullPath = join(dir, name);
    const kind = statSync(fullPath).isDirectory() ? "[dir]" : "[file]";
    console.log(`${kind} ${name}`);
  }
}

main();
