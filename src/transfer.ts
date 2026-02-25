import { createHash } from "crypto";
import { createReadStream, createWriteStream, promises as fsPromises, readFileSync, WriteStream } from "fs";
import { createConnection, createServer, Server, Socket } from "net";
import { basename, dirname, extname, resolve } from "path";
import { once } from "events";
import { finished } from "stream/promises";
import { connect as tlsConnect, createServer as createTlsServer, Server as TlsServer, TLSSocket } from "tls";
import { HEADER_MAX_BYTES } from "./constants";
import { publishService } from "./discovery";
import { AckMessage, decodeJsonLine, encodeJsonLine, ReadyMessage, TransferHeader } from "./protocol";
import { verifyTlsPeer } from "./tlsTrust";
import {
  normalizeTransferPath,
  renderProgress,
  resolveOutputPath,
  sha256File,
  TransferEntry,
  updateHashFromFilePrefix
} from "./utils";

export interface TransferConfirmRequest {
  from: string;
  relativePath: string;
  fileSize: number;
}

export interface TransferConfirmDecision {
  accept: boolean;
  message?: string;
}

export interface ListenOptions {
  port: number;
  outputDir: string;
  serviceName: string;
  pairCode?: string;
  rotatePairCodePerTransfer?: boolean;
  pairCodeTtlSeconds?: number;
  generatePairCode?: () => string;
  onPairCodeChange?: (nextCode: string | null, reason: "once" | "ttl") => void;
  confirmTransfer?: (
    request: TransferConfirmRequest
  ) => Promise<TransferConfirmDecision | boolean> | TransferConfirmDecision | boolean;
  tls?: {
    certPath: string;
    keyPath: string;
  };
}

export interface SendFileOptions {
  filePath: string;
  relativePath: string;
  host: string;
  port: number;
  pairCode?: string;
  tls?: {
    enabled: boolean;
    caPath?: string;
    insecure?: boolean;
    fingerprint?: string;
    trustOnFirstUse?: boolean;
    knownHostsPath?: string;
  };
}

export interface SendBatchOptions {
  entries: TransferEntry[];
  host: string;
  port: number;
  pairCode?: string;
  tls?: {
    enabled: boolean;
    caPath?: string;
    insecure?: boolean;
    fingerprint?: string;
    trustOnFirstUse?: boolean;
    knownHostsPath?: string;
  };
}

export interface SendBatchResult {
  fileCount: number;
  totalBytes: number;
  resumedBytes: number;
  results: Array<{ entry: TransferEntry; ack: AckMessage }>;
}

type ReceiverPhase = "before-ready" | "receiving" | "done";
type CloseableServer = Server | TlsServer;

interface PairingState {
  currentCode: string | null;
  previousCode: string | null;
  previousCodeValidUntilMs: number;
  activeTransfers: number;
}

interface ProgressEmitState {
  prefix: string;
  totalBytes: number;
  startedAt: number;
  lastEmitAt: number;
  lastPercent: number;
}

interface ReceivePathSelection {
  finalPath: string;
  tempPath: string;
}

class SocketReader {
  private buffer = Buffer.alloc(0);
  private ended = false;
  private error: Error | null = null;
  private waiter: (() => void) | null = null;

  constructor(private readonly socket: Socket) {
    socket.on("data", this.onData);
    socket.on("end", this.onEnd);
    socket.on("close", this.onClose);
    socket.on("error", this.onError);
  }

  dispose(): void {
    this.socket.removeListener("data", this.onData);
    this.socket.removeListener("end", this.onEnd);
    this.socket.removeListener("close", this.onClose);
    this.socket.removeListener("error", this.onError);
  }

  async readLineMessage<T>(label: string): Promise<T> {
    while (true) {
      this.throwIfError();

      const newlineIndex = this.buffer.indexOf(0x0a);
      if (newlineIndex >= 0) {
        const line = this.buffer.subarray(0, newlineIndex).toString("utf8").trim();
        this.buffer = this.buffer.subarray(newlineIndex + 1);
        try {
          return decodeJsonLine<T>(line);
        } catch (err) {
          throw new Error(`invalid ${label}: ${(err as Error).message}`);
        }
      }

      if (this.buffer.length > HEADER_MAX_BYTES) {
        throw new Error(`${label} too large`);
      }
      if (this.ended) {
        throw new Error(`connection closed before ${label}`);
      }

      await this.waitForUpdate();
    }
  }

  async readChunk(): Promise<Buffer | null> {
    while (true) {
      this.throwIfError();

      if (this.buffer.length > 0) {
        const chunk = this.buffer;
        this.buffer = Buffer.alloc(0);
        return chunk;
      }

      if (this.ended) {
        return null;
      }

      await this.waitForUpdate();
    }
  }

  private onData = (chunk: Buffer): void => {
    const normalized = Buffer.from(chunk);
    this.buffer = this.buffer.length === 0 ? normalized : Buffer.concat([this.buffer, normalized]);
    this.notify();
  };

  private onEnd = (): void => {
    this.ended = true;
    this.notify();
  };

  private onClose = (): void => {
    this.ended = true;
    this.notify();
  };

  private onError = (err: Error): void => {
    this.error = err;
    this.notify();
  };

  private throwIfError(): void {
    if (this.error) {
      throw this.error;
    }
  }

  private async waitForUpdate(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.waiter = resolve;
    });
  }

  private notify(): void {
    if (!this.waiter) {
      return;
    }
    const waiter = this.waiter;
    this.waiter = null;
    waiter();
  }
}

export async function startReceiver(options: ListenOptions): Promise<() => Promise<void>> {
  await fsPromises.mkdir(options.outputDir, { recursive: true });
  const stopPublish = publishService(options.serviceName, options.port);
  const activeSockets = new Set<Socket>();
  const pairingState: PairingState = {
    currentCode: options.pairCode ?? null,
    previousCode: null,
    previousCodeValidUntilMs: 0,
    activeTransfers: 0
  };

  const needsGenerator = options.rotatePairCodePerTransfer || Boolean(options.pairCodeTtlSeconds);
  if (needsGenerator && !options.generatePairCode) {
    throw new Error("generatePairCode is required when pair code rotation is enabled");
  }
  if (options.pairCodeTtlSeconds && options.pairCodeTtlSeconds <= 0) {
    throw new Error("pairCodeTtlSeconds must be positive");
  }
  if ((options.rotatePairCodePerTransfer || options.pairCodeTtlSeconds) && !pairingState.currentCode && options.generatePairCode) {
    pairingState.currentCode = options.generatePairCode();
  }

  const ttlMs = options.pairCodeTtlSeconds ? options.pairCodeTtlSeconds * 1000 : null;
  const rotatePairCode = (reason: "once" | "ttl"): string | undefined => {
    if (!pairingState.currentCode || !options.generatePairCode) {
      return undefined;
    }

    const oldCode = pairingState.currentCode;
    let nextCode = options.generatePairCode();
    for (let i = 0; i < 5 && nextCode === oldCode; i += 1) {
      nextCode = options.generatePairCode();
    }

    pairingState.currentCode = nextCode;
    if (reason === "ttl" && ttlMs) {
      pairingState.previousCode = oldCode;
      pairingState.previousCodeValidUntilMs = Date.now() + ttlMs;
    } else {
      pairingState.previousCode = null;
      pairingState.previousCodeValidUntilMs = 0;
    }
    options.onPairCodeChange?.(nextCode, reason);
    return nextCode;
  };

  const ttlTimer =
    ttlMs && pairingState.currentCode
      ? setInterval(() => {
          if (pairingState.activeTransfers > 0) {
            return;
          }
          rotatePairCode("ttl");
        }, ttlMs)
      : null;

  const server = options.tls
    ? createTlsServer(
        {
          key: readFileSync(options.tls.keyPath),
          cert: readFileSync(options.tls.certPath),
          requestCert: false,
          allowHalfOpen: true
        },
        (socket) => {
          activeSockets.add(socket);
          socket.once("close", () => {
            activeSockets.delete(socket);
          });
          void handleIncomingSocket(socket, options.outputDir, pairingState, options);
        }
      )
    : createServer({ allowHalfOpen: true }, (socket) => {
        activeSockets.add(socket);
        socket.once("close", () => {
          activeSockets.delete(socket);
        });
        void handleIncomingSocket(socket, options.outputDir, pairingState, options);
      });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, () => resolve());
  });

  return async () => {
    if (ttlTimer) {
      clearInterval(ttlTimer);
    }
    for (const socket of activeSockets) {
      if (!socket.destroyed) {
        socket.destroy();
      }
    }
    await stopPublish();
    await closeServer(server);
  };
}

export async function sendEntries(options: SendBatchOptions): Promise<SendBatchResult> {
  const results: Array<{ entry: TransferEntry; ack: AckMessage }> = [];
  let totalBytes = 0;
  let resumedBytes = 0;
  let activePairCode = options.pairCode;

  for (const [index, entry] of options.entries.entries()) {
    totalBytes += entry.size;
    process.stdout.write(`\n[send] ${index + 1}/${options.entries.length} ${entry.relativePath}\n`);

    const ack = await sendFile({
      filePath: entry.absolutePath,
      relativePath: entry.relativePath,
      host: options.host,
      port: options.port,
      pairCode: activePairCode,
      tls: options.tls
    });
    resumedBytes += ack.resumedFrom ?? 0;
    results.push({ entry, ack });
    if (ack.nextPairCode) {
      activePairCode = ack.nextPairCode;
    }
  }

  return {
    fileCount: options.entries.length,
    totalBytes,
    resumedBytes,
    results
  };
}

export async function sendFile(options: SendFileOptions): Promise<AckMessage> {
  const absolutePath = resolve(options.filePath);
  const stat = await fsPromises.stat(absolutePath);
  if (!stat.isFile()) {
    throw new Error("only regular file is supported");
  }

  const digest = await sha256File(absolutePath);
  const header: TransferHeader = {
    type: "header",
    version: 1,
    relativePath: normalizeTransferPath(options.relativePath),
    fileSize: stat.size,
    sha256: digest,
    pairCode: options.pairCode
  };

  const socket = createClientSocket(options);
  const reader = new SocketReader(socket);
  let completed = false;

  try {
    await waitConnected(socket);
    await verifyTlsPeerIfNeeded(socket, options);
    socket.write(encodeJsonLine(header));

    const ready = await reader.readLineMessage<ReadyMessage>("ready");
    if (ready.type !== "ready") {
      throw new Error("protocol error: expected ready message");
    }
    if (!ready.ok) {
      throw new Error(ready.message ?? "receiver rejected transfer");
    }

    const offset = ready.offset;
    if (offset < 0 || offset > stat.size) {
      throw new Error(`invalid resume offset: ${offset}`);
    }

    if (offset < stat.size) {
      await streamFileRange({
        socket,
        filePath: absolutePath,
        startOffset: offset,
        totalBytes: stat.size,
        label: header.relativePath
      });
      socket.end();
    } else {
      process.stdout.write(`[send ${header.relativePath}] already complete on receiver, waiting ack\n`);
      socket.end();
    }

    const ack = await reader.readLineMessage<AckMessage>("ack");
    if (ack.type !== "ack") {
      throw new Error("protocol error: expected ack message");
    }
    if (!ack.ok) {
      throw new Error(ack.message ?? "receiver rejected transfer");
    }
    completed = true;
    return ack;
  } finally {
    reader.dispose();
    if (!completed && !socket.destroyed) {
      socket.destroy();
    }
  }
}

async function closeServer(server: CloseableServer): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve) => {
    let finished = false;
    const settle = (): void => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      resolve();
    };

    const timer = setTimeout(() => {
      const closable = server as CloseableServer & {
        closeAllConnections?: () => void;
        unref?: () => void;
      };
      try {
        closable.closeAllConnections?.();
      } catch {
        // Ignore force-close failures.
      }
      try {
        closable.unref?.();
      } catch {
        // Ignore unref failures.
      }
      settle();
    }, 2000);

    server.close(() => {
      settle();
    });
  });
}

async function handleIncomingSocket(socket: Socket, outputDir: string, pairingState: PairingState, listenOptions: ListenOptions): Promise<void> {
  socket.on("error", () => {
    // Keep receiver process alive if peer resets after we reply with an error.
  });
  pairingState.activeTransfers += 1;
  const reader = new SocketReader(socket);
  let header: TransferHeader | null = null;
  let targetPath = "";
  let tempPath = "";
  let fileStream: WriteStream | null = null;
  let phase: ReceiverPhase = "before-ready";
  let failed = false;
  let resumedFrom = 0;
  let received = 0;
  let requiredPairCodeForThisTransfer: string | null = null;
  const hasher = createHash("sha256");
  const startedAt = Date.now();
  const remoteAddress = normalizeRemoteAddress(socket.remoteAddress);

  const fail = async (message: string, cleanup = false): Promise<void> => {
    if (failed) {
      return;
    }
    failed = true;
    process.stdout.write(`\n[receive] failed: ${message}\n`);

    if (fileStream) {
      fileStream.destroy();
    }

    if (cleanup && tempPath) {
      try {
        await fsPromises.rm(tempPath, { force: true });
      } catch {
        // Ignore cleanup failures.
      }
    }

    const messageBody =
      phase === "before-ready"
        ? ({
            type: "ready",
            ok: false,
            offset: 0,
            message
          } satisfies ReadyMessage)
        : ({
            type: "ack",
            ok: false,
            message
          } satisfies AckMessage);

    if (socket.writable) {
      try {
        socket.end(encodeJsonLine(messageBody));
        setImmediate(() => {
          if (!socket.destroyed) {
            socket.destroy();
          }
        });
      } catch {
        socket.destroy();
      }
    } else {
      socket.destroy();
    }
  };

  try {
    header = await reader.readLineMessage<TransferHeader>("header");
    if (header.type !== "header") {
      await fail("protocol error: expected header");
      return;
    }

    if (header.version !== 1 || header.fileSize < 0 || !header.sha256) {
      await fail("invalid header fields");
      return;
    }

    requiredPairCodeForThisTransfer = pairingState.currentCode;
    if (!isPairCodeAccepted(pairingState, header.pairCode)) {
      await fail("pair code mismatch");
      return;
    }

    const receivePathSelection = await selectReceivePaths({
      outputDir,
      relativePath: header.relativePath,
      expectedSha256: header.sha256
    });
    targetPath = receivePathSelection.finalPath;
    tempPath = receivePathSelection.tempPath;
    await fsPromises.mkdir(dirname(targetPath), { recursive: true });

    if (listenOptions.confirmTransfer) {
      const decision = await listenOptions.confirmTransfer({
        from: remoteAddress,
        relativePath: header.relativePath,
        fileSize: header.fileSize
      });
      const accepted = typeof decision === "boolean" ? decision : decision.accept;
      if (!accepted) {
        const message =
          typeof decision === "boolean"
            ? "receiver rejected transfer"
            : decision.message?.trim() || "receiver rejected transfer";
        await fail(message);
        return;
      }
    }

    resumedFrom = await decideResumeOffset({
      targetPath: tempPath,
      expectedSha256: header.sha256,
      expectedSize: header.fileSize,
      hasher
    });
    received = resumedFrom;
    const recvProgressState = createProgressEmitState(`[recv ${header.relativePath}]`, header.fileSize, startedAt);

    if (resumedFrom < header.fileSize) {
      fileStream = createWriteStream(tempPath, resumedFrom > 0 ? { flags: "r+", start: resumedFrom } : { flags: "w" });
      fileStream.on("error", () => {
        void fail("cannot write target file");
      });
    }

    socket.write(
      encodeJsonLine({
        type: "ready",
        ok: true,
        offset: resumedFrom,
        savedPath: targetPath
      } satisfies ReadyMessage)
    );
    phase = "receiving";

    while (received < header.fileSize) {
      const chunk = await reader.readChunk();
      if (chunk === null) {
        break;
      }

      await writePayload({
        payload: chunk,
        header,
        fileStream,
        hasher,
        progressState: recvProgressState,
        receivedRef: {
          get: () => received,
          set: (v: number) => {
            received = v;
          }
        }
      });
    }

    if (received !== header.fileSize) {
      await fail(`size mismatch: expected ${header.fileSize}, got ${received}`);
      return;
    }

    if (fileStream) {
      fileStream.end();
      await finished(fileStream);
    }

    const digest = hasher.digest("hex");
    if (digest !== header.sha256) {
      await fail("sha256 mismatch", true);
      return;
    }
    const savedPath = await promoteReceivedFile(tempPath, targetPath);

    phase = "done";
    let nextPairCode: string | undefined;
    if (requiredPairCodeForThisTransfer && listenOptions.rotatePairCodePerTransfer && listenOptions.generatePairCode) {
      nextPairCode = rotatePairCodeOnce(pairingState, listenOptions.generatePairCode);
      if (nextPairCode) {
        listenOptions.onPairCodeChange?.(nextPairCode, "once");
      }
    } else if (requiredPairCodeForThisTransfer) {
      nextPairCode = pairingState.currentCode ?? undefined;
    }

    emitProgress(recvProgressState, received, true);
    process.stdout.write("\n");
    socket.end(
      encodeJsonLine({
        type: "ack",
        ok: true,
        sha256: digest,
        receivedBytes: received,
        savedPath,
        resumedFrom,
        nextPairCode
      } satisfies AckMessage)
    );
    process.stdout.write(`[receive] saved ${savedPath}\n`);
  } catch (err) {
    await fail((err as Error).message);
  } finally {
    reader.dispose();
    pairingState.activeTransfers = Math.max(0, pairingState.activeTransfers - 1);
  }
}

function normalizeRemoteAddress(raw: string | undefined): string {
  const value = String(raw ?? "").trim();
  if (!value) {
    return "unknown";
  }
  if (value.startsWith("::ffff:")) {
    return value.slice("::ffff:".length);
  }
  return value;
}

const TEMP_SUFFIX = ".local-sent.part";
const MAX_DUPLICATE_SUFFIX_ATTEMPTS = 10_000;

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsPromises.stat(filePath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw err;
  }
}

function duplicatePathWithIndex(basePath: string, index: number): string {
  if (index <= 0) {
    return basePath;
  }
  const dir = dirname(basePath);
  const fileName = basename(basePath);
  const extension = extname(fileName);
  const stem = extension ? fileName.slice(0, -extension.length) : fileName;
  return resolve(dir, `${stem}(${index})${extension}`);
}

function buildReceiveTempPath(finalPath: string, expectedSha256: string): string {
  const tag = expectedSha256.slice(0, 16).toLowerCase();
  return `${finalPath}.${tag}${TEMP_SUFFIX}`;
}

async function selectReceivePaths(args: {
  outputDir: string;
  relativePath: string;
  expectedSha256: string;
}): Promise<ReceivePathSelection> {
  const { outputDir, relativePath, expectedSha256 } = args;
  const basePath = resolveOutputPath(outputDir, relativePath);

  for (let index = 0; index < MAX_DUPLICATE_SUFFIX_ATTEMPTS; index += 1) {
    const candidateFinalPath = duplicatePathWithIndex(basePath, index);
    const candidateTempPath = buildReceiveTempPath(candidateFinalPath, expectedSha256);

    if (await pathExists(candidateTempPath)) {
      return {
        finalPath: candidateFinalPath,
        tempPath: candidateTempPath
      };
    }

    if (!(await pathExists(candidateFinalPath))) {
      return {
        finalPath: candidateFinalPath,
        tempPath: candidateTempPath
      };
    }
  }

  throw new Error("failed to allocate receive target path");
}

async function promoteReceivedFile(tempPath: string, preferredFinalPath: string): Promise<string> {
  for (let index = 0; index < MAX_DUPLICATE_SUFFIX_ATTEMPTS; index += 1) {
    const candidateFinalPath = duplicatePathWithIndex(preferredFinalPath, index);
    try {
      await fsPromises.rename(tempPath, candidateFinalPath);
      return candidateFinalPath;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new Error("temporary receive file is missing");
      }
      if (code === "EXDEV") {
        await fsPromises.copyFile(tempPath, candidateFinalPath);
        await fsPromises.rm(tempPath, { force: true });
        return candidateFinalPath;
      }
      if (code === "EEXIST" || code === "ENOTEMPTY") {
        continue;
      }
      throw err;
    }
  }

  throw new Error("failed to choose final receive file path");
}

async function decideResumeOffset(args: {
  targetPath: string;
  expectedSize: number;
  expectedSha256: string;
  hasher: ReturnType<typeof createHash>;
}): Promise<number> {
  const { targetPath, expectedSize, expectedSha256, hasher } = args;

  let existingStat: Awaited<ReturnType<typeof fsPromises.stat>> | null = null;
  try {
    existingStat = await fsPromises.stat(targetPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return 0;
    }
    throw err;
  }

  if (!existingStat.isFile()) {
    throw new Error("target path is not a regular file");
  }

  if (existingStat.size <= 0) {
    return 0;
  }

  if (existingStat.size > expectedSize) {
    return 0;
  }

  if (existingStat.size === expectedSize) {
    const existingDigest = await sha256File(targetPath);
    if (existingDigest !== expectedSha256) {
      return 0;
    }
    await updateHashFromFilePrefix(hasher, targetPath, existingStat.size);
    return existingStat.size;
  }

  await updateHashFromFilePrefix(hasher, targetPath, existingStat.size);
  return existingStat.size;
}

const PROGRESS_EMIT_INTERVAL_MS = 80;
const PROGRESS_EMIT_DELTA_PERCENT = 0.35;

function createProgressEmitState(prefix: string, totalBytes: number, startedAt: number): ProgressEmitState {
  return {
    prefix,
    totalBytes,
    startedAt,
    lastEmitAt: 0,
    lastPercent: -1
  };
}

function emitProgress(state: ProgressEmitState, transferredBytes: number, force = false): void {
  const now = Date.now();
  const total = Math.max(0, state.totalBytes);
  const ratio = total === 0 ? 100 : (transferredBytes / total) * 100;
  const safePercent = Math.max(0, Math.min(100, ratio));
  const percentDelta = Math.abs(safePercent - state.lastPercent);

  if (!force && now - state.lastEmitAt < PROGRESS_EMIT_INTERVAL_MS && percentDelta < PROGRESS_EMIT_DELTA_PERCENT) {
    return;
  }

  state.lastEmitAt = now;
  state.lastPercent = safePercent;
  process.stdout.write(`\r${renderProgress(state.prefix, transferredBytes, total, state.startedAt)}`);
}

async function streamFileRange(args: {
  socket: Socket;
  filePath: string;
  startOffset: number;
  totalBytes: number;
  label: string;
}): Promise<void> {
  const { socket, filePath, startOffset, totalBytes, label } = args;
  const startedAt = Date.now();
  let sent = startOffset;
  const progressState = createProgressEmitState(`[send ${label}]`, totalBytes, startedAt);
  const stream = createReadStream(filePath, { start: startOffset });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => {
      socket.destroy();
      reject(err);
    };

    socket.on("error", onError);
    stream.on("error", onError);
    stream.on("data", (chunk: Buffer) => {
      sent += chunk.length;
      emitProgress(progressState, sent);

      const writable = socket.write(chunk);
      if (!writable) {
        stream.pause();
        socket.once("drain", () => stream.resume());
      }
    });
    stream.on("end", () => {
      emitProgress(progressState, sent, true);
      process.stdout.write("\n");
      socket.removeListener("error", onError);
      resolve();
    });
  });
}

async function writePayload(args: {
  payload: Buffer;
  header: TransferHeader;
  fileStream: WriteStream | null;
  hasher: ReturnType<typeof createHash>;
  progressState: ProgressEmitState;
  receivedRef: { get: () => number; set: (next: number) => void };
}): Promise<void> {
  const { payload, header, fileStream, hasher, progressState, receivedRef } = args;
  if (payload.length === 0) {
    return;
  }

  const nextReceived = receivedRef.get() + payload.length;
  if (nextReceived > header.fileSize) {
    throw new Error("payload exceeds declared file size");
  }

  if (!fileStream) {
    throw new Error("unexpected payload for already complete file");
  }

  hasher.update(payload);
  receivedRef.set(nextReceived);
  const writable = fileStream.write(payload);
  emitProgress(progressState, nextReceived);
  if (!writable) {
    await once(fileStream, "drain");
  }
}

function waitConnected(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.removeListener("connect", onConnect);
      socket.removeListener("secureConnect", onSecureConnect);
      socket.removeListener("error", onError);
      fn();
    };

    const onConnect = (): void => {
      settle(resolve);
    };
    const onSecureConnect = (): void => {
      settle(resolve);
    };
    const onError = (err: Error): void => {
      settle(() => reject(err));
    };

    socket.once("error", onError);
    if (socket instanceof TLSSocket) {
      socket.once("secureConnect", onSecureConnect);
      const tlsSocketState = socket as TLSSocket & { secureConnecting?: boolean };
      if (!socket.connecting && !tlsSocketState.secureConnecting) {
        queueMicrotask(() => settle(resolve));
      }
      return;
    }

    socket.once("connect", onConnect);
    if (!socket.connecting && socket.readyState === "open") {
      queueMicrotask(() => settle(resolve));
    }
  });
}

function createClientSocket(options: SendFileOptions): Socket {
  if (!options.tls?.enabled) {
    return createConnection({ host: options.host, port: options.port });
  }

  const pinningEnabled = Boolean(options.tls.fingerprint || options.tls.trustOnFirstUse);
  const rejectUnauthorized = options.tls.insecure ? false : !pinningEnabled;
  const ca = options.tls.caPath ? [readFileSync(options.tls.caPath)] : undefined;
  return tlsConnect({
    host: options.host,
    port: options.port,
    rejectUnauthorized,
    ca
  });
}

async function verifyTlsPeerIfNeeded(socket: Socket, options: SendFileOptions): Promise<void> {
  if (!options.tls?.enabled) {
    return;
  }

  const tlsSocket = socket as TLSSocket;
  await verifyTlsPeer({
    socket: tlsSocket,
    host: options.host,
    port: options.port,
    expectedFingerprint: options.tls.fingerprint,
    trustOnFirstUse: options.tls.trustOnFirstUse,
    knownHostsPath: options.tls.knownHostsPath
  });
}

function isPairCodeAccepted(pairingState: PairingState, incomingCode: string | undefined): boolean {
  if (!pairingState.currentCode) {
    return true;
  }
  if (incomingCode === pairingState.currentCode) {
    return true;
  }
  if (
    pairingState.previousCode &&
    incomingCode === pairingState.previousCode &&
    Date.now() <= pairingState.previousCodeValidUntilMs
  ) {
    return true;
  }
  return false;
}

function rotatePairCodeOnce(pairingState: PairingState, generatePairCode: () => string): string {
  const oldCode = pairingState.currentCode;
  let nextCode = generatePairCode();
  for (let i = 0; i < 5 && nextCode === oldCode; i += 1) {
    nextCode = generatePairCode();
  }

  pairingState.currentCode = nextCode;
  pairingState.previousCode = null;
  pairingState.previousCodeValidUntilMs = 0;
  return nextCode;
}
