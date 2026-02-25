export interface TransferHeader {
  type: "header";
  version: 1;
  relativePath: string;
  fileSize: number;
  sha256: string;
  pairCode?: string;
}

export interface ReadyMessage {
  type: "ready";
  ok: boolean;
  offset: number;
  message?: string;
  savedPath?: string;
}

export interface AckMessage {
  type: "ack";
  ok: boolean;
  message?: string;
  sha256?: string;
  receivedBytes?: number;
  savedPath?: string;
  resumedFrom?: number;
  nextPairCode?: string;
}

export function encodeJsonLine(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}

export function decodeJsonLine<T>(line: string): T {
  return JSON.parse(line) as T;
}
