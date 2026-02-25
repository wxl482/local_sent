import { createHash } from "crypto";
import { promises as fsPromises } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { TLSSocket } from "tls";

interface KnownHostsMap {
  [endpoint: string]: string;
}

export interface VerifyTlsPeerOptions {
  socket: TLSSocket;
  host: string;
  port: number;
  expectedFingerprint?: string;
  trustOnFirstUse?: boolean;
  knownHostsPath?: string;
}

export function normalizeFingerprint(input: string): string {
  const normalized = input.replace(/:/g, "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("TLS fingerprint must be SHA-256 hex (64 chars, colon optional)");
  }
  return normalized;
}

export function getDefaultKnownHostsPath(): string {
  return resolve(homedir(), ".local-sent", "known_hosts.json");
}

export function getPeerFingerprint(socket: TLSSocket): string {
  const cert = socket.getPeerCertificate(true);
  if (!cert || !cert.raw) {
    throw new Error("cannot read server TLS certificate");
  }
  return createHash("sha256").update(cert.raw).digest("hex");
}

export async function verifyTlsPeer(options: VerifyTlsPeerOptions): Promise<void> {
  const peerFingerprint = getPeerFingerprint(options.socket);

  if (options.expectedFingerprint) {
    const expected = normalizeFingerprint(options.expectedFingerprint);
    if (peerFingerprint !== expected) {
      throw new Error(
        `TLS fingerprint mismatch: expected=${expected} actual=${peerFingerprint}`
      );
    }
    return;
  }

  if (!options.trustOnFirstUse) {
    return;
  }

  const endpoint = buildEndpointKey(options.host, options.port);
  const knownHostsPath = options.knownHostsPath ?? getDefaultKnownHostsPath();
  const knownHosts = await loadKnownHosts(knownHostsPath);
  const knownFingerprint = knownHosts[endpoint];
  if (knownFingerprint) {
    if (knownFingerprint !== peerFingerprint) {
      throw new Error(
        `TLS fingerprint changed for ${endpoint}: expected=${knownFingerprint} actual=${peerFingerprint}`
      );
    }
    return;
  }

  knownHosts[endpoint] = peerFingerprint;
  await saveKnownHosts(knownHostsPath, knownHosts);
  process.stdout.write(`[tls] trust-on-first-use: ${endpoint} => ${peerFingerprint}\n`);
}

function buildEndpointKey(host: string, port: number): string {
  return `${host.toLowerCase()}:${port}`;
}

async function loadKnownHosts(filePath: string): Promise<KnownHostsMap> {
  try {
    const raw = await fsPromises.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("known hosts file must be a JSON object");
    }
    const result: KnownHostsMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") {
        result[key] = normalizeFingerprint(value);
      }
    }
    return result;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw new Error(`failed to read known hosts: ${(err as Error).message}`);
  }
}

async function saveKnownHosts(filePath: string, data: KnownHostsMap): Promise<void> {
  await fsPromises.mkdir(dirname(filePath), { recursive: true });
  const sorted = Object.fromEntries(
    Object.entries(data).sort(([a], [b]) => a.localeCompare(b))
  );
  await fsPromises.writeFile(filePath, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
}
