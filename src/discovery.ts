import { Bonjour, Service } from "bonjour-service";
import { createSocket, Socket as DgramSocket } from "dgram";
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

function serviceToDevice(service: Service): DiscoveredDevice {
  const addresses = (service.addresses ?? []).filter(Boolean);
  const host = chooseAddress(addresses) ?? service.host;
  return {
    name: service.name,
    host,
    port: service.port,
    addresses
  };
}

function chooseAddress(addresses: string[]): string | undefined {
  const preferred = addresses.find((addr) => {
    if (addr.includes(":")) {
      return false;
    }
    return !addr.startsWith("169.254.");
  });
  return preferred ?? addresses[0];
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

async function discoverViaMdns(timeoutMs: number): Promise<DiscoveredDevice[]> {
  return new Promise((resolve) => {
    const bonjour = new Bonjour();
    const devices = new Map<string, DiscoveredDevice>();
    const browser = bonjour.find({ type: SERVICE_TYPE, protocol: SERVICE_PROTOCOL }, (service) => {
      const device = serviceToDevice(service);
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

async function discoverViaUdp(timeoutMs: number): Promise<DiscoveredDevice[]> {
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

        const device: DiscoveredDevice = {
          name: payload.name,
          host: rinfo.address,
          port: payload.port,
          addresses: [rinfo.address]
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
        socket.send(probe, UDP_DISCOVERY_PORT, "127.0.0.1");
      } catch {
        done();
        return;
      }
      setTimeout(done, timeoutMs);
    });
  });
}

export async function discoverDevices(timeoutMs = DEFAULT_DISCOVERY_TIMEOUT_MS): Promise<DiscoveredDevice[]> {
  const results = await Promise.allSettled([discoverViaMdns(timeoutMs), discoverViaUdp(timeoutMs)]);
  const lists = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  return mergeDevices(lists);
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
