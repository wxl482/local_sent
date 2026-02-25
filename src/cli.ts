#!/usr/bin/env node

import { randomInt } from "crypto";
import { Command } from "commander";
import { hostname, networkInterfaces } from "os";
import { resolve } from "path";
import { DEFAULT_DISCOVERY_TIMEOUT_MS, DEFAULT_PORT } from "./constants";
import { runDoctor } from "./doctor";
import { discoverDevices } from "./discovery";
import { resolveCliLocale, t as translate } from "./i18n";
import { sendEntries, startReceiver } from "./transfer";
import { normalizeFingerprint } from "./tlsTrust";
import { buildTransferEntries, formatBytes } from "./utils";

const locale = resolveCliLocale();
const t = (key: Parameters<typeof translate>[1], vars?: Parameters<typeof translate>[2]): string =>
  translate(locale, key, vars);

function parseIntOption(value: string, label: string): number {
  const num = Number.parseInt(value, 10);
  if (Number.isNaN(num) || num <= 0) {
    throw new Error(t("err_positive_integer", { label }));
  }
  return num;
}

function normalizePairCode(value: string): string {
  const code = value.trim();
  if (!/^\d{6}$/.test(code)) {
    throw new Error(t("err_pair_code_format"));
  }
  return code;
}

function generatePairCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function resolveListenEndpointHost(): string {
  const interfaces = networkInterfaces();
  const candidates: Array<{ name: string; address: string }> = [];

  for (const [name, items] of Object.entries(interfaces)) {
    for (const item of items ?? []) {
      if (item.family === "IPv4" && !item.internal) {
        candidates.push({ name, address: item.address });
      }
    }
  }

  if (candidates.length === 0) {
    return "127.0.0.1";
  }

  const interfacePenalty = (name: string): number => {
    const value = name.toLowerCase();
    if (value.includes("docker") || value.includes("vbox") || value.includes("vmnet") || value.includes("wsl")) {
      return 10;
    }
    if (value.includes("tailscale") || value.includes("utun")) {
      return 20;
    }
    return 0;
  };

  const addressPenalty = (address: string): number => {
    if (address.startsWith("192.168.")) {
      return 0;
    }
    if (address.startsWith("10.")) {
      return 1;
    }
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(address)) {
      return 2;
    }
    return 5;
  };

  candidates.sort((a, b) => {
    const scoreA = interfacePenalty(a.name) + addressPenalty(a.address);
    const scoreB = interfacePenalty(b.name) + addressPenalty(b.address);
    if (scoreA !== scoreB) {
      return scoreA - scoreB;
    }
    return a.name.localeCompare(b.name);
  });

  return candidates[0].address;
}

const program = new Command();

program
  .name("local-sent")
  .description(t("app_description"))
  .option("--lang <lang>", t("lang_option_desc"), locale)
  .version("0.1.0");

program
  .command("discover")
  .description(t("discover_command_desc"))
  .option(
    "-t, --timeout <ms>",
    t("discover_timeout_option"),
    (v) => parseIntOption(v, t("label_timeout")),
    DEFAULT_DISCOVERY_TIMEOUT_MS
  )
  .option("--json", t("discover_json_option"))
  .action(async (opts: { timeout: number; json?: boolean }) => {
    const devices = await discoverDevices(opts.timeout);
    if (opts.json) {
      console.log(JSON.stringify(devices, null, 2));
      return;
    }
    if (devices.length === 0) {
      console.log(t("discover_none"));
      return;
    }

    for (const [index, device] of devices.entries()) {
      const addresses = device.addresses.length > 0 ? device.addresses.join(", ") : "N/A";
      console.log(
        `${index + 1}. ${device.name}\n` +
          `   ${t("discover_endpoint")}: ${device.host}:${device.port}\n` +
          `   ${t("discover_addresses")}: ${addresses}`
      );
    }
  });

program
  .command("doctor")
  .description(t("doctor_command_desc"))
  .option("-p, --port <port>", t("doctor_port_option"), (v) => parseIntOption(v, t("label_port")), DEFAULT_PORT)
  .option("-o, --output <dir>", t("doctor_output_option"), "./received")
  .option(
    "-t, --timeout <ms>",
    t("doctor_timeout_option"),
    (v) => parseIntOption(v, t("label_timeout")),
    DEFAULT_DISCOVERY_TIMEOUT_MS
  )
  .option("--tls-cert <path>", t("doctor_tls_cert_option"))
  .option("--tls-key <path>", t("doctor_tls_key_option"))
  .option("--json", t("doctor_json_option"))
  .action(
    async (opts: { port: number; output: string; timeout: number; tlsCert?: string; tlsKey?: string; json?: boolean }) => {
      if ((opts.tlsCert && !opts.tlsKey) || (!opts.tlsCert && opts.tlsKey)) {
        throw new Error(t("err_tls_cert_key_together"));
      }

      const report = await runDoctor({
        port: opts.port,
        outputDir: resolve(opts.output),
        timeoutMs: opts.timeout,
        tlsCertPath: opts.tlsCert ? resolve(opts.tlsCert) : undefined,
        tlsKeyPath: opts.tlsKey ? resolve(opts.tlsKey) : undefined
      });

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        const statusIcon: Record<string, string> = {
          pass: t("doctor_pass"),
          warn: t("doctor_warn"),
          fail: t("doctor_fail")
        };

        console.log(t("doctor_start", { startedAt: report.startedAt }));
        for (const check of report.checks) {
          const suffix = check.hint ? t("doctor_hint_suffix", { hint: check.hint }) : "";
          console.log(`[${statusIcon[check.status]}] ${check.name}: ${check.detail}${suffix}`);
        }

        const failCount = report.checks.filter((item) => item.status === "fail").length;
        const warnCount = report.checks.filter((item) => item.status === "warn").length;
        console.log(
          t("doctor_done", {
            durationMs: report.durationMs,
            failCount,
            warnCount
          })
        );
      }

      const failed = report.checks.some((item) => item.status === "fail");
      if (failed) {
        process.exitCode = 1;
      }
    }
  );

program
  .command("listen")
  .description(t("listen_command_desc"))
  .option("-p, --port <port>", t("listen_port_option"), (v) => parseIntOption(v, t("label_port")), DEFAULT_PORT)
  .option("-o, --output <dir>", t("listen_output_option"), "./received")
  .option("-n, --name <name>", t("listen_name_option"))
  .option("--pair-code <code>", t("listen_pair_code_option"))
  .option("--pair-generate", t("listen_pair_generate_option"))
  .option("--pair-once", t("listen_pair_once_option"))
  .option(
    "--pair-ttl <seconds>",
    t("listen_pair_ttl_option"),
    (v) => parseIntOption(v, t("label_pair_ttl"))
  )
  .option("--tls-cert <path>", t("listen_tls_cert_option"))
  .option("--tls-key <path>", t("listen_tls_key_option"))
  .action(
    async (opts: { port: number; output: string; name?: string; pairCode?: string; pairGenerate?: boolean; pairOnce?: boolean; pairTtl?: number; tlsCert?: string; tlsKey?: string }) => {
      const outputDir = resolve(opts.output);
      const serviceName = opts.name ?? `local-sent-${hostname()}`;
      if ((opts.tlsCert && !opts.tlsKey) || (!opts.tlsCert && opts.tlsKey)) {
        throw new Error(t("err_tls_cert_key_together"));
      }
      if (opts.pairCode && opts.pairGenerate) {
        throw new Error(t("err_pair_code_and_generate_conflict"));
      }
      if (opts.pairTtl && opts.pairTtl <= 0) {
        throw new Error(t("err_pair_ttl_positive"));
      }
      if (opts.pairOnce && !opts.pairCode && !opts.pairGenerate && !opts.pairTtl) {
        throw new Error(t("err_pair_once_requirement"));
      }

      const pairCode = opts.pairGenerate
        ? generatePairCode()
        : opts.pairCode
          ? normalizePairCode(opts.pairCode)
          : opts.pairTtl
            ? generatePairCode()
            : undefined;

      const stop = await startReceiver({
        port: opts.port,
        outputDir,
        serviceName,
        pairCode,
        rotatePairCodePerTransfer: Boolean(opts.pairOnce),
        pairCodeTtlSeconds: opts.pairTtl,
        generatePairCode,
        onPairCodeChange: (nextCode, reason) => {
          if (nextCode) {
            const ttlSuffix = opts.pairTtl ? ` valid-for=${opts.pairTtl}s` : "";
            console.log(
              t("listen_pair_code_rotated", {
                code: nextCode,
                reason,
                ttlSuffix
              })
            );
          }
        },
        tls: opts.tlsCert && opts.tlsKey ? { certPath: resolve(opts.tlsCert), keyPath: resolve(opts.tlsKey) } : undefined
      });

      console.log(t("listen_service", { service: serviceName }));
      const listenHost = resolveListenEndpointHost();
      console.log(t("listen_endpoint", { host: listenHost, port: opts.port }));
      console.log(t("listen_output", { output: outputDir }));
      if (pairCode) {
        const ttlSuffix = opts.pairTtl ? ` valid-for=${opts.pairTtl}s` : "";
        console.log(t("listen_pair_code", { code: pairCode, ttlSuffix }));
      }
      if (opts.pairTtl) {
        console.log(t("listen_pair_ttl", { seconds: opts.pairTtl }));
      }
      if (opts.tlsCert) {
        console.log(t("listen_tls_enabled"));
      }
      let stopped = false;
      const shutdown = async (signal: string): Promise<void> => {
        if (stopped) {
          return;
        }
        stopped = true;
        console.log(t("listen_shutdown", { signal }));
        await stop();
        process.exit(0);
      };

      process.on("SIGINT", () => {
        void shutdown("SIGINT");
      });
      process.on("SIGTERM", () => {
        void shutdown("SIGTERM");
      });

      await new Promise<void>(() => {
        // Keep process running.
      });
    }
  );

program
  .command("send")
  .description(t("send_command_desc"))
  .argument("<path>", t("send_path_arg"))
  .option("--host <host>", t("send_host_option"))
  .option("--port <port>", t("send_port_option"), (v) => parseIntOption(v, t("label_port")), DEFAULT_PORT)
  .option("--device <name>", t("send_device_option"))
  .option(
    "-t, --timeout <ms>",
    t("send_timeout_option"),
    (v) => parseIntOption(v, t("label_timeout")),
    DEFAULT_DISCOVERY_TIMEOUT_MS
  )
  .option("--pair-code <code>", t("send_pair_code_option"))
  .option("--tls", t("send_tls_option"))
  .option("--tls-ca <path>", t("send_tls_ca_option"))
  .option("--tls-insecure", t("send_tls_insecure_option"))
  .option("--tls-fingerprint <sha256>", t("send_tls_fingerprint_option"))
  .option("--tls-tofu", t("send_tls_tofu_option"))
  .option("--tls-known-hosts <path>", t("send_tls_known_hosts_option"))
  .action(
    async (
      pathInput: string,
      opts: {
        host?: string;
        port: number;
        device?: string;
        timeout: number;
        pairCode?: string;
        tls?: boolean;
        tlsCa?: string;
        tlsInsecure?: boolean;
        tlsFingerprint?: string;
        tlsTofu?: boolean;
        tlsKnownHosts?: string;
      }
    ) => {
      if (opts.tlsCa && !opts.tls) {
        throw new Error(t("err_tls_ca_requires_tls"));
      }
      if (opts.tlsInsecure && !opts.tls) {
        throw new Error(t("err_tls_insecure_requires_tls"));
      }
      if (opts.tlsFingerprint && !opts.tls) {
        throw new Error(t("err_tls_fingerprint_requires_tls"));
      }
      if (opts.tlsTofu && !opts.tls) {
        throw new Error(t("err_tls_tofu_requires_tls"));
      }
      if (opts.tlsKnownHosts && !opts.tlsTofu) {
        throw new Error(t("err_tls_known_hosts_requires_tofu"));
      }
      if (opts.tlsFingerprint && opts.tlsTofu) {
        throw new Error(t("err_tls_fingerprint_tofu_conflict"));
      }
      const pairCode = opts.pairCode ? normalizePairCode(opts.pairCode) : undefined;
      const tlsFingerprint = opts.tlsFingerprint ? normalizeFingerprint(opts.tlsFingerprint) : undefined;

      let host = opts.host;
      let port = opts.port;

      if (!host) {
        const devices = await discoverDevices(opts.timeout);
        const filtered = opts.device
          ? devices.filter((d) => d.name.toLowerCase().includes(opts.device!.toLowerCase()))
          : devices;

        if (filtered.length === 0) {
          throw new Error(t("err_no_receiver_found"));
        }

        const target = filtered[0];
        host = target.host;
        port = target.port;
        console.log(
          t("discover_selected", {
            name: target.name,
            host,
            port
          })
        );
      }

      const entries = await buildTransferEntries(resolve(pathInput));
      const batch = await sendEntries({
        entries,
        host,
        port,
        pairCode,
        tls: opts.tls
          ? {
              enabled: true,
              caPath: opts.tlsCa ? resolve(opts.tlsCa) : undefined,
              insecure: Boolean(opts.tlsInsecure),
              fingerprint: tlsFingerprint,
              trustOnFirstUse: Boolean(opts.tlsTofu),
              knownHostsPath: opts.tlsKnownHosts ? resolve(opts.tlsKnownHosts) : undefined
            }
          : undefined
      });

      const transferredBytes = batch.results.reduce((sum, item) => sum + (item.ack.receivedBytes ?? 0), 0);
      console.log(
        t("send_done", {
          fileCount: batch.fileCount,
          bytes: formatBytes(transferredBytes),
          resumed: formatBytes(batch.resumedBytes)
        })
      );
    }
  );

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(t("error_prefix", { message: err.message }));
  process.exit(1);
});
