import { createHash, Hash } from "crypto";
import { createReadStream } from "fs";
import { promises as fsPromises } from "fs";
import { basename, join, normalize, posix, relative, resolve, sep } from "path";

export interface TransferEntry {
  absolutePath: string;
  relativePath: string;
  size: number;
}

export async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);

    stream.on("data", (chunk: Buffer) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function updateHashFromFilePrefix(hasher: Hash, filePath: string, byteLength: number): Promise<void> {
  if (byteLength <= 0) {
    return;
  }

  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath, { start: 0, end: byteLength - 1 });
    stream.on("data", (chunk: Buffer) => hasher.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = -1;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

export function renderProgress(prefix: string, sent: number, total: number, startedAt: number): string {
  const pct = total === 0 ? 100 : (sent / total) * 100;
  const elapsedSec = Math.max(1, (Date.now() - startedAt) / 1000);
  const speed = sent / elapsedSec;
  const remainingSec = speed <= 0 ? 0 : Math.max(0, (total - sent) / speed);
  return `${prefix} ${pct.toFixed(1)}% (${formatBytes(sent)}/${formatBytes(total)}) ${formatBytes(speed)}/s ETA ${Math.ceil(remainingSec)}s`;
}

export function normalizeTransferPath(input: string): string {
  const unixPath = input.replace(/\\/g, "/").trim();
  const normalized = posix.normalize(unixPath).replace(/^\/+/, "");

  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error("invalid relative path");
  }

  return normalized;
}

export function resolveOutputPath(outputDir: string, relativePath: string): string {
  const normalized = normalizeTransferPath(relativePath);
  const localRelative = normalized.split("/").join(sep);
  const absoluteRoot = resolve(outputDir);
  const absoluteTarget = resolve(absoluteRoot, localRelative);
  const rel = relative(absoluteRoot, absoluteTarget);
  if (rel === "" || rel === "." || (!rel.startsWith("..") && !normalize(rel).startsWith(`..${sep}`))) {
    return absoluteTarget;
  }
  throw new Error("path escapes output directory");
}

export async function buildTransferEntries(inputPath: string): Promise<TransferEntry[]> {
  const absoluteInput = resolve(inputPath);
  const stat = await fsPromises.stat(absoluteInput);

  if (stat.isFile()) {
    return [
      {
        absolutePath: absoluteInput,
        relativePath: basename(absoluteInput),
        size: stat.size
      }
    ];
  }

  if (!stat.isDirectory()) {
    throw new Error("only regular file or directory is supported");
  }

  const rootName = basename(absoluteInput);
  const entries: TransferEntry[] = [];

  await walkDirectory(absoluteInput, async (filePath, fileSize) => {
    const rel = relative(absoluteInput, filePath).split(sep).join("/");
    entries.push({
      absolutePath: filePath,
      relativePath: `${rootName}/${rel}`,
      size: fileSize
    });
  });

  if (entries.length === 0) {
    throw new Error("directory has no files");
  }

  entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return entries;
}

async function walkDirectory(
  dirPath: string,
  onFile: (absolutePath: string, fileSize: number) => Promise<void>
): Promise<void> {
  const items = await fsPromises.readdir(dirPath, { withFileTypes: true });
  items.sort((a, b) => a.name.localeCompare(b.name));

  for (const item of items) {
    const absolute = join(dirPath, item.name);
    if (item.isDirectory()) {
      await walkDirectory(absolute, onFile);
      continue;
    }

    if (item.isFile()) {
      const stat = await fsPromises.stat(absolute);
      await onFile(absolute, stat.size);
    }
  }
}
