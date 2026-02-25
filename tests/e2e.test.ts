import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { ListenOptions, sendEntries, sendFile, startReceiver } from "../src/transfer";
import { normalizeFingerprint } from "../src/tlsTrust";
import { buildTransferEntries, sha256File } from "../src/utils";

interface TestContext {
  rootDir: string;
  sourceDir: string;
  receiveDir: string;
  port: number;
  stop: () => Promise<void>;
}

type ReceiverOverrides = Omit<Partial<ListenOptions>, "port" | "outputDir" | "serviceName">;
const FIXTURE_DIR = resolve(__dirname, "fixtures");
const TLS_A_CERT = resolve(FIXTURE_DIR, "tls-a-cert.pem");
const TLS_A_KEY = resolve(FIXTURE_DIR, "tls-a-key.pem");
const TLS_B_CERT = resolve(FIXTURE_DIR, "tls-b-cert.pem");
const TLS_B_KEY = resolve(FIXTURE_DIR, "tls-b-key.pem");

async function getFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("cannot acquire ephemeral port");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
  return port;
}

async function createSampleFile(filePath: string, size: number): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const chunk = Buffer.alloc(size);
  for (let i = 0; i < size; i += 1) {
    chunk[i] = i % 251;
  }
  await writeFile(filePath, chunk);
}

async function setupReceiver(overrides: ReceiverOverrides = {}): Promise<TestContext> {
  const rootDir = await mkdtemp(join(tmpdir(), "local-sent-e2e-"));
  const sourceDir = join(rootDir, "source");
  const receiveDir = join(rootDir, "received");
  await mkdir(sourceDir, { recursive: true });
  await mkdir(receiveDir, { recursive: true });
  const port = await getFreePort();

  let stop: (() => Promise<void>) | null = null;
  try {
    stop = await startReceiver({
      port,
      outputDir: receiveDir,
      serviceName: `local-sent-test-${process.pid}-${Date.now()}`,
      ...overrides
    });
  } catch (err) {
    await rm(rootDir, { recursive: true, force: true });
    throw err;
  }

  return {
    rootDir,
    sourceDir,
    receiveDir,
    port,
    stop
  };
}

async function teardown(context: TestContext): Promise<void> {
  try {
    await context.stop();
  } finally {
    await rm(context.rootDir, { recursive: true, force: true });
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function readCertFingerprint(certPath: string): Promise<string> {
  const pem = await readFile(certPath, "utf8");
  const cert = new X509Certificate(pem);
  return normalizeFingerprint(cert.fingerprint256);
}

test(
  "e2e: send single file with hash verification",
  { concurrency: false, timeout: 20_000 },
  async () => {
    const context = await setupReceiver();
    try {
      const sourcePath = join(context.sourceDir, "sample.bin");
      await createSampleFile(sourcePath, 256 * 1024 + 17);

      const ack = await sendFile({
        filePath: sourcePath,
        relativePath: "sample.bin",
        host: "127.0.0.1",
        port: context.port
      });

      assert.equal(ack.ok, true);
      assert.equal(ack.resumedFrom, 0);

      const receivedPath = join(context.receiveDir, "sample.bin");
      assert.equal(await sha256File(receivedPath), await sha256File(sourcePath));
      assert.equal((await stat(receivedPath)).size, 256 * 1024 + 17);
    } finally {
      await teardown(context);
    }
  }
);

test(
  "e2e: resume transfer from existing partial file",
  { concurrency: false, timeout: 20_000 },
  async () => {
    const context = await setupReceiver();
    try {
      const sourcePath = join(context.sourceDir, "nested", "resume.bin");
      await createSampleFile(sourcePath, 600 * 1024 + 3);

      const partialSize = 120 * 1024 + 11;
      const targetPath = join(context.receiveDir, "nested", "resume.bin");
      await mkdir(dirname(targetPath), { recursive: true });
      const sourceData = await readFile(sourcePath);
      await writeFile(targetPath, sourceData.subarray(0, partialSize));

      const ack = await sendFile({
        filePath: sourcePath,
        relativePath: "nested/resume.bin",
        host: "127.0.0.1",
        port: context.port
      });

      assert.equal(ack.ok, true);
      assert.equal(ack.resumedFrom, partialSize);
      assert.equal(await sha256File(targetPath), await sha256File(sourcePath));
      assert.equal((await stat(targetPath)).size, 600 * 1024 + 3);
    } finally {
      await teardown(context);
    }
  }
);

test(
  "e2e: pair-once rotation keeps batch transfer alive",
  { concurrency: false, timeout: 20_000 },
  async () => {
    const codeSequence = ["654321", "111222", "333444"];
    let codeIndex = 0;
    const context = await setupReceiver({
      pairCode: "123456",
      rotatePairCodePerTransfer: true,
      generatePairCode: () => {
        const code = codeSequence[Math.min(codeIndex, codeSequence.length - 1)];
        codeIndex += 1;
        return code;
      }
    });

    try {
      const folderPath = join(context.sourceDir, "pair-batch");
      await mkdir(folderPath, { recursive: true });
      await writeFile(join(folderPath, "a.txt"), "alpha");
      await writeFile(join(folderPath, "b.txt"), "bravo");

      const entries = await buildTransferEntries(folderPath);
      const result = await sendEntries({
        entries,
        host: "127.0.0.1",
        port: context.port,
        pairCode: "123456"
      });

      assert.equal(result.fileCount, 2);
      assert.equal(result.results[0].ack.nextPairCode, "654321");
      assert.equal(result.results[1].ack.nextPairCode, "111222");

      for (const entry of result.results) {
        const receivedPath = join(context.receiveDir, entry.entry.relativePath);
        assert.equal(await sha256File(receivedPath), await sha256File(entry.entry.absolutePath));
      }
    } finally {
      await teardown(context);
    }
  }
);

test(
  "e2e: pair-ttl accepts previous code within grace window",
  { concurrency: false, timeout: 30_000 },
  async () => {
    let resolveRotation: ((nextCode: string) => void) | null = null;
    const rotated = new Promise<string>((resolve) => {
      resolveRotation = resolve;
    });

    const codeSequence = ["888888", "999999", "121212"];
    let codeIndex = 0;
    const context = await setupReceiver({
      pairCode: "777777",
      pairCodeTtlSeconds: 2,
      generatePairCode: () => {
        const code = codeSequence[Math.min(codeIndex, codeSequence.length - 1)];
        codeIndex += 1;
        return code;
      },
      onPairCodeChange: (nextCode, reason) => {
        if (reason === "ttl" && resolveRotation) {
          const callback = resolveRotation;
          resolveRotation = null;
          callback(nextCode);
        }
      }
    });

    try {
      const fileOne = join(context.sourceDir, "ttl-one.bin");
      const fileTwo = join(context.sourceDir, "ttl-two.bin");
      await createSampleFile(fileOne, 64 * 1024 + 5);
      await createSampleFile(fileTwo, 64 * 1024 + 7);

      await sendFile({
        filePath: fileOne,
        relativePath: "ttl-one.bin",
        host: "127.0.0.1",
        port: context.port,
        pairCode: "777777"
      });

      const rotatedCode = await withTimeout(rotated, 8_000, "pair TTL rotation");
      const ack = await sendFile({
        filePath: fileTwo,
        relativePath: "ttl-two.bin",
        host: "127.0.0.1",
        port: context.port,
        pairCode: "777777"
      });

      assert.equal(ack.ok, true);
      assert.equal(ack.nextPairCode, rotatedCode);
      assert.equal(await sha256File(join(context.receiveDir, "ttl-two.bin")), await sha256File(fileTwo));
    } finally {
      await teardown(context);
    }
  }
);

test(
  "e2e: tls fingerprint pin verifies server certificate",
  { concurrency: false, timeout: 20_000 },
  async () => {
    const context = await setupReceiver({
      tls: {
        certPath: TLS_A_CERT,
        keyPath: TLS_A_KEY
      }
    });

    try {
      const sourcePath = join(context.sourceDir, "tls-pin.bin");
      await createSampleFile(sourcePath, 96 * 1024 + 9);

      const expectedFingerprint = await readCertFingerprint(TLS_A_CERT);
      const ack = await sendFile({
        filePath: sourcePath,
        relativePath: "tls-pin.bin",
        host: "127.0.0.1",
        port: context.port,
        tls: {
          enabled: true,
          fingerprint: expectedFingerprint
        }
      });
      assert.equal(ack.ok, true);

      const mismatchResult = await withTimeout(
        sendFile({
          filePath: sourcePath,
          relativePath: "tls-pin-mismatch.bin",
          host: "127.0.0.1",
          port: context.port,
          tls: {
            enabled: true,
            fingerprint: "0".repeat(64)
          }
        })
          .then(() => null)
          .catch((err: unknown) => err as Error),
        5_000,
        "tls fingerprint mismatch rejection"
      );
      assert.ok(mismatchResult instanceof Error, "expected mismatch to reject");
      assert.match(mismatchResult.message, /TLS fingerprint mismatch/);
    } finally {
      await teardown(context);
    }
  }
);

test(
  "e2e: tls TOFU stores first fingerprint and blocks cert change",
  { concurrency: false, timeout: 30_000 },
  async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "local-sent-tls-tofu-"));
    const sourceDir = join(rootDir, "source");
    const knownHostsPath = join(rootDir, "known_hosts.json");
    await mkdir(sourceDir, { recursive: true });
    const port = await getFreePort();
    const host = "127.0.0.1";
    const endpointKey = `${host}:${port}`;

    let stopA: (() => Promise<void>) | null = null;
    let stopB: (() => Promise<void>) | null = null;

    try {
      const sourcePath = join(sourceDir, "tofu.bin");
      await createSampleFile(sourcePath, 128 * 1024 + 13);

      stopA = await startReceiver({
        port,
        outputDir: join(rootDir, "recv-a"),
        serviceName: `local-sent-tls-a-${process.pid}-${Date.now()}`,
        tls: {
          certPath: TLS_A_CERT,
          keyPath: TLS_A_KEY
        }
      });

      const firstAck = await sendFile({
        filePath: sourcePath,
        relativePath: "tofu.bin",
        host,
        port,
        tls: {
          enabled: true,
          trustOnFirstUse: true,
          knownHostsPath
        }
      });
      assert.equal(firstAck.ok, true);

      const firstKnownHostsRaw = await readFile(knownHostsPath, "utf8");
      const firstKnownHosts = JSON.parse(firstKnownHostsRaw) as Record<string, string>;
      const expectedFirst = await readCertFingerprint(TLS_A_CERT);
      assert.equal(firstKnownHosts[endpointKey], expectedFirst);

      await stopA();
      stopA = null;

      stopB = await startReceiver({
        port,
        outputDir: join(rootDir, "recv-b"),
        serviceName: `local-sent-tls-b-${process.pid}-${Date.now()}`,
        tls: {
          certPath: TLS_B_CERT,
          keyPath: TLS_B_KEY
        }
      });

      const tofuMismatch = await withTimeout(
        sendFile({
          filePath: sourcePath,
          relativePath: "tofu-after-rotate.bin",
          host,
          port,
          tls: {
            enabled: true,
            trustOnFirstUse: true,
            knownHostsPath
          }
        })
          .then(() => null)
          .catch((err: unknown) => err as Error),
        8_000,
        "tls tofu mismatch rejection"
      );
      assert.ok(tofuMismatch instanceof Error, "expected TOFU mismatch to reject");
      assert.match(tofuMismatch.message, /TLS fingerprint changed/);
    } finally {
      if (stopA) {
        await stopA();
      }
      if (stopB) {
        await stopB();
      }
      await rm(rootDir, { recursive: true, force: true });
    }
  }
);
