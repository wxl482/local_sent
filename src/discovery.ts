import { Bonjour, Service } from "bonjour-service";
import { createSocket, Socket as DgramSocket } from "dgram";
import { networkInterfaces } from "os";
import {
  DEFAULT_DISCOVERY_TIMEOUT_MS,
  SERVICE_PROTOCOL,
  SERVICE_TYPE,
  UDP_DISCOVERY_MAGIC,
  UDP_DISCOVERY_PORT
} from "./constants";

export interface DiscoveredDevice {
  name: string;
  host: string;
  port: number;
  addresses: string[];
}

interface UdpDiscoveryReply {
  magic: string;
  name: string;
  port: number;
}

export interface DiscoverDevicesOptions {
  includeSelf?: boolean;
  includeLoopback?: boolean;
  onlyLanIpv4?: boolean;
}

interface ResolvedDiscoverDevicesOptions {
  includeSelf: boolean;
  includeLoopback: boolean;
  onlyLanIpv4: boolean;
}

function resolveDiscoverOptions(options?: DiscoverDevicesOptions): ResolvedDiscoverDevicesOptions {
  return {
    includeSelf: options?.includeSelf ?? false,
    includeLoopback: options?.includeLoopback ?? false,
    onlyLanIpv4: options?.onlyLanIpv4 ?? true
  };
}

function serviceToDevice(
  service: Service,
  options: ResolvedDiscoverDevicesOptions
): DiscoveredDevice | null {
  const addresses = normalizeAddresses(service.addresses ?? [], options);
  const host = chooseAddress(addresses, options);
  if (!host) {
    return null;
  }
  return {
    name: service.name,
    host,
    port: service.port,
    addresses
  };
}

function chooseAddress(
  addresses: string[],
  options: ResolvedDiscoverDevicesOptions
): string | undefined {
  const preferred = addresses.find((addr) => {
    return !addr.startsWith("169.254.");
  });
  return preferred ?? addresses.find((addr) => isAllowedIpv4(addr, options));
}

function normalizeAddresses(
  input: Array<string | undefined>,
  options: ResolvedDiscoverDevicesOptions
): string[] {
  const list = input
    .map((raw) => normalizeIpv4(raw))
    .filter((value): value is string => Boolean(value))
    .filter((value) => isAllowedIpv4(value, options));

  return [...new Set(list)];
}

function normalizeIpv4(raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }

  let value = raw.trim();
  if (!value) {
    return null;
  }

  if (value.startsWith("::ffff:")) {
    value = value.slice("::ffff:".length);
  }
  const zoneIndex = value.indexOf("%");
  if (zoneIndex >= 0) {
    value = value.slice(0, zoneIndex);
  }

  const matched = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!matched) {
    return null;
  }

  const octets = matched.slice(1).map((item) => Number.parseInt(item, 10));
  if (octets.some((item) => Number.isNaN(item) || item < 0 || item > 255)) {
    return null;
  }

  return octets.join(".");
}

function isAllowedIpv4(address: string, options: ResolvedDiscoverDevicesOptions): boolean {
  if (isLoopbackIpv4(address) && !options.includeLoopback) {
    return false;
  }
  if (!options.onlyLanIpv4) {
    return true;
  }
  return isLanIpv4(address);
}

function isLoopbackIpv4(address: string): boolean {
  return address.startsWith("127.");
}

function isLanIpv4(address: string): boolean {
  if (address.startsWith("10.") || address.startsWith("192.168.")) {
    return true;
  }

  const parts = address.split(".");
  if (parts.length !== 4) {
    return false;
  }

  const first = Number.parseInt(parts[0], 10);
  const second = Number.parseInt(parts[1], 10);
  return first === 172 && second >= 16 && second <= 31;
}

function localIpv4Set(options: ResolvedDiscoverDevicesOptions): Set<string> {
  const result = new Set<string>(options.includeLoopback ? ["127.0.0.1"] : []);
  const interfaces = networkInterfaces();
  for (const list of Object.values(interfaces)) {
    for (const item of list ?? []) {
      if (item.family !== "IPv4") {
        continue;
      }
      const normalized = normalizeIpv4(item.address);
      if (!normalized) {
        continue;
      }
      if (!isAllowedIpv4(normalized, options)) {
        continue;
      }
      result.add(normalized);
    }
  }
  return result;
}

function isSelfDevice(device: DiscoveredDevice, localAddrs: Set<string>): boolean {
  if (localAddrs.has(device.host)) {
    return true;
  }
  return device.addresses.some((address) => localAddrs.has(address));
}

function mergeDevices(lists: DiscoveredDevice[][]): DiscoveredDevice[] {
  const merged = new Map<string, DiscoveredDevice>();
  for (const list of lists) {
    for (const item of list) {
      const key = `${item.host}:${item.port}`;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, item);
        continue;
      }
      existing.name = existing.name || item.name;
      existing.addresses = [...new Set([...existing.addresses, ...item.addresses])];
    }
  }
  return [...merged.values()];
}

async function discoverViaMdns(
  timeoutMs: number,
  options: ResolvedDiscoverDevicesOptions
): Promise<DiscoveredDevice[]> {
  return new Promise((resolve) => {
    const bonjour = new Bonjour();
    const devices = new Map<string, DiscoveredDevice>();
    const browser = bonjour.find({ type: SERVICE_TYPE, protocol: SERVICE_PROTOCOL }, (service) => {
      const device = serviceToDevice(service, options);
      if (!device) {
        return;
      }
      const key = `${device.name}@${device.host}:${device.port}`;
      devices.set(key, device);
    });

    const done = (): void => {
      browser.stop();
      bonjour.destroy();
      resolve([...devices.values()]);
    };

    browser.start();
    const timer = setTimeout(done, timeoutMs);
    browser.on("error", () => {
      clearTimeout(timer);
      done();
    });
  });
}

async function discoverViaUdp(
  timeoutMs: number,
  options: ResolvedDiscoverDevicesOptions
): Promise<DiscoveredDevice[]> {
  return new Promise((resolve) => {
    const devices = new Map<string, DiscoveredDevice>();
    const socket = createSocket({ type: "udp4", reuseAddr: true });
    let finished = false;

    const done = (): void => {
      if (finished) {
        return;
      }
      finished = true;
      try {
        socket.close();
      } catch {
        // Ignore close errors.
      }
      resolve([...devices.values()]);
    };

    socket.on("message", (message, rinfo) => {
      try {
        const payload = JSON.parse(message.toString("utf8").trim()) as UdpDiscoveryReply;
        if (payload.magic !== UDP_DISCOVERY_MAGIC || !payload.name || payload.port <= 0) {
          return;
        }
        const host = normalizeIpv4(rinfo.address);
        if (!host || !isAllowedIpv4(host, options)) {
          return;
        }

        const device: DiscoveredDevice = {
          name: payload.name,
          host,
          port: payload.port,
          addresses: [host]
        };
        const key = `${device.host}:${device.port}`;
        devices.set(key, device);
      } catch {
        // Ignore non-discovery packets.
      }
    });

    socket.on("error", () => done());
    socket.bind(0, () => {
      try {
        socket.setBroadcast(true);
        const probe = Buffer.from(UDP_DISCOVERY_MAGIC, "utf8");
        socket.send(probe, UDP_DISCOVERY_PORT, "255.255.255.255");
        if (options.includeLoopback) {
          socket.send(probe, UDP_DISCOVERY_PORT, "127.0.0.1");
        }
      } catch {
        done();
        return;
      }
      setTimeout(done, timeoutMs);
    });
  });
}

export async function discoverDevices(
  timeoutMs = DEFAULT_DISCOVERY_TIMEOUT_MS,
  options?: DiscoverDevicesOptions
): Promise<DiscoveredDevice[]> {
  const resolved = resolveDiscoverOptions(options);
  const results = await Promise.allSettled([
    discoverViaMdns(timeoutMs, resolved),
    discoverViaUdp(timeoutMs, resolved)
  ]);
  const lists = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  const devices = mergeDevices(lists);
  if (resolved.includeSelf) {
    return devices;
  }

  const locals = localIpv4Set(resolved);
  return devices.filter((device) => !isSelfDevice(device, locals));
}

function createUdpResponder(name: string, port: number): DgramSocket {
  const socket = createSocket({ type: "udp4", reuseAddr: true });
  socket.on("error", () => {
    // Keep running even if UDP discovery fails.
  });

  socket.on("message", (message, rinfo) => {
    if (message.toString("utf8").trim() !== UDP_DISCOVERY_MAGIC) {
      return;
    }

    const payload: UdpDiscoveryReply = {
      magic: UDP_DISCOVERY_MAGIC,
      name,
      port
    };

    try {
      socket.send(Buffer.from(JSON.stringify(payload), "utf8"), rinfo.port, rinfo.address);
    } catch {
      // Ignore response send failures.
    }
  });

  socket.bind(UDP_DISCOVERY_PORT);
  return socket;
}

export function publishService(name: string, port: number): () => Promise<void> {
  const bonjour = new Bonjour();
  const service = bonjour.publish({
    name,
    type: SERVICE_TYPE,
    protocol: SERVICE_PROTOCOL,
    port
  });

  let udpSocket: DgramSocket | null = null;
  try {
    udpSocket = createUdpResponder(name, port);
  } catch {
    udpSocket = null;
  }

  return async () => {
    if (udpSocket) {
      await runWithTimeout(
        (done) => {
          udpSocket?.close(() => done());
        },
        1000
      );
    }

    await runWithTimeout(
      (done) => {
        service.stop?.(() => done());
      },
      1500
    );
    await runWithTimeout(
      (done) => {
        bonjour.destroy(() => done());
      },
      1500
    );
  };
}

async function runWithTimeout(invoke: (done: () => void) => void, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    let finished = false;
    const done = (): void => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);

    try {
      invoke(done);
    } catch {
      done();
    }
  });
}
