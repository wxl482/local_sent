import { X509Certificate } from "crypto";
import { createWriteStream } from "fs";
import { promises as fsPromises } from "fs";
import { createServer } from "net";
import { networkInterfaces } from "os";
import { join, resolve } from "path";
import { once } from "events";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { discoverDevices } from "./discovery";
import { sendFile, startReceiver } from "./transfer";
import { normalizeFingerprint } from "./tlsTrust";

export type DoctorStatus = "pass" | "warn" | "fail";

export interface DoctorCheckResult {
  name: string;
  status: DoctorStatus;
  detail: string;
  hint?: string;
  durationMs: number;
}

export interface DoctorReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  checks: DoctorCheckResult[];
}

export interface DoctorOptions {
  port: number;
  outputDir: string;
  timeoutMs: number;
  tlsCertPath?: string;
  tlsKeyPath?: string;
}

type CheckOutcome = Pick<DoctorCheckResult, "status" | "detail" | "hint">;

export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const startedMs = Date.now();
  const checks: DoctorCheckResult[] = [];

  checks.push(
    await runCheck("Node.js Runtime", async () => {
      const major = Number.parseInt(process.versions.node.split(".")[0], 10);
      if (major < 20) {
        return {
          status: "fail",
          detail: `Node.js ${process.versions.node} detected`,
          hint: "Upgrade to Node.js >= 20"
        };
      }
      return {
        status: "pass",
        detail: `Node.js ${process.versions.node}`
      };
    })
  );

  checks.push(await runCheck("Network Interfaces", checkNetworkInterfaces));
  checks.push(await runCheck("Output Directory Write", () => checkOutputDirectory(options.outputDir)));
  checks.push(await runCheck("Listen Port", () => checkListenPort(options.port)));
  checks.push(await runCheck("Discovery Loopback", () => checkDiscoveryLoopback(options.timeoutMs)));
  checks.push(
    await runCheck("TLS Self-Test", () =>
      checkTlsSelfTest({
        timeoutMs: options.timeoutMs,
        tlsCertPath: options.tlsCertPath,
        tlsKeyPath: options.tlsKeyPath
      })
    )
  );

  return {
    startedAt: new Date(startedMs).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    checks
  };
}

async function runCheck(name: string, execute: () => Promise<CheckOutcome> | CheckOutcome): Promise<DoctorCheckResult> {
  const startedMs = Date.now();
  try {
    const outcome = await execute();
    return {
      name,
      status: outcome.status,
      detail: outcome.detail,
      hint: outcome.hint,
      durationMs: Date.now() - startedMs
    };
  } catch (err) {
    return {
      name,
      status: "fail",
      detail: (err as Error).message,
      durationMs: Date.now() - startedMs
    };
  }
}

function checkNetworkInterfaces(): CheckOutcome {
  const interfaces = networkInterfaces();
  const externalIpv4 = Object.entries(interfaces).flatMap(([name, list]) =>
    (list ?? [])
      .filter((item) => item.family === "IPv4" && !item.internal)
      .map((item) => ({ name, address: item.address }))
  );

  if (externalIpv4.length === 0) {
    return {
      status: "warn",
      detail: "No external IPv4 interface found",
      hint: "Ensure Wi-Fi/Ethernet is connected if you need LAN transfer"
    };
  }

  const preview = externalIpv4.slice(0, 3).map((item) => `${item.name}:${item.address}`).join(", ");
  return {
    status: "pass",
    detail: `${externalIpv4.length} external IPv4 interface(s): ${preview}`
  };
}

async function checkOutputDirectory(outputDir: string): Promise<CheckOutcome> {
  const absoluteDir = resolve(outputDir);
  await fsPromises.mkdir(absoluteDir, { recursive: true });
  const probePath = join(absoluteDir, `.doctor-write-${process.pid}-${Date.now()}.tmp`);
  const writer = createWriteStream(probePath, { flags: "w" });
  writer.write("ok");
  writer.end();
  await once(writer, "finish");
  await fsPromises.rm(probePath, { force: true });

  return {
    status: "pass",
    detail: `Writable: ${absoluteDir}`
  };
}

async function checkListenPort(port: number): Promise<CheckOutcome> {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "0.0.0.0", () => resolve());
    });
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  return {
    status: "pass",
    detail: `Port ${port} is available`
  };
}

async function checkDiscoveryLoopback(timeoutMs: number): Promise<CheckOutcome> {
  const workDir = await mkdtemp(join(tmpdir(), "local-sent-doctor-discovery-"));
  const serviceName = `local-sent-doctor-${process.pid}-${Date.now()}`;
  const port = await getFreePort();

  const stop = await startReceiver({
    port,
    outputDir: workDir,
    serviceName
  });

  try {
    await sleep(250);
    const devices = await discoverDevices(timeoutMs, {
      includeSelf: true,
      includeLoopback: true,
      onlyLanIpv4: false
    });
    const found = devices.find((d) => d.name === serviceName && d.port === port);
    if (!found) {
      return {
        status: "warn",
        detail: "Receiver started, but self-discovery did not return expected endpoint",
        hint: "mDNS/UDP broadcast may be restricted. You can still use --host + --port"
      };
    }
    return {
      status: "pass",
      detail: `Discovered self endpoint ${found.host}:${found.port}`
    };
  } finally {
    await stop();
    await fsPromises.rm(workDir, { recursive: true, force: true });
  }
}

async function checkTlsSelfTest(options: {
  timeoutMs: number;
  tlsCertPath?: string;
  tlsKeyPath?: string;
}): Promise<CheckOutcome> {
  if (!options.tlsCertPath && !options.tlsKeyPath) {
    return {
      status: "warn",
      detail: "Skipped (no --tls-cert/--tls-key provided)",
      hint: "Provide cert/key to run active TLS fingerprint verification"
    };
  }
  if (!options.tlsCertPath || !options.tlsKeyPath) {
    return {
      status: "fail",
      detail: "--tls-cert and --tls-key must be provided together"
    };
  }

  const certPath = resolve(options.tlsCertPath);
  const keyPath = resolve(options.tlsKeyPath);
  const certPem = await fsPromises.readFile(certPath, "utf8");
  const fingerprint = normalizeFingerprint(new X509Certificate(certPem).fingerprint256);

  const root = await mkdtemp(join(tmpdir(), "local-sent-doctor-tls-"));
  const sendPath = join(root, "probe.bin");
  const receiveDir = join(root, "recv");
  await fsPromises.mkdir(receiveDir, { recursive: true });
  await fsPromises.writeFile(sendPath, Buffer.alloc(32 * 1024, 7));

  const port = await getFreePort();
  const stop = await startReceiver({
    port,
    outputDir: receiveDir,
    serviceName: `local-sent-doctor-tls-${process.pid}-${Date.now()}`,
    tls: {
      certPath,
      keyPath
    }
  });

  try {
    await sendFile({
      filePath: sendPath,
      relativePath: "probe.bin",
      host: "127.0.0.1",
      port,
      tls: {
        enabled: true,
        fingerprint
      }
    });

    return {
      status: "pass",
      detail: `TLS handshake + fingerprint pin verified (${Math.max(1, options.timeoutMs)}ms timeout config)`
    };
  } finally {
    await stop();
    await fsPromises.rm(root, { recursive: true, force: true });
  }
}

async function getFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("failed to allocate free port");
  }

  const port = address.port;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  return port;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
