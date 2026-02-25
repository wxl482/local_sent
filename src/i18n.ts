export type SupportedLocale = "zh" | "en";

type MessageKey =
  | "lang_option_desc"
  | "app_description"
  | "discover_command_desc"
  | "doctor_command_desc"
  | "listen_command_desc"
  | "send_command_desc"
  | "discover_timeout_option"
  | "discover_json_option"
  | "doctor_port_option"
  | "doctor_output_option"
  | "doctor_timeout_option"
  | "doctor_tls_cert_option"
  | "doctor_tls_key_option"
  | "doctor_json_option"
  | "listen_port_option"
  | "listen_output_option"
  | "listen_name_option"
  | "listen_pair_code_option"
  | "listen_pair_generate_option"
  | "listen_pair_once_option"
  | "listen_pair_ttl_option"
  | "listen_tls_cert_option"
  | "listen_tls_key_option"
  | "send_path_arg"
  | "send_host_option"
  | "send_port_option"
  | "send_device_option"
  | "send_timeout_option"
  | "send_pair_code_option"
  | "send_tls_option"
  | "send_tls_ca_option"
  | "send_tls_insecure_option"
  | "send_tls_fingerprint_option"
  | "send_tls_tofu_option"
  | "send_tls_known_hosts_option"
  | "label_timeout"
  | "label_port"
  | "label_pair_ttl"
  | "err_positive_integer"
  | "err_pair_code_format"
  | "discover_none"
  | "discover_endpoint"
  | "discover_addresses"
  | "doctor_start"
  | "doctor_done"
  | "doctor_hint_suffix"
  | "doctor_pass"
  | "doctor_warn"
  | "doctor_fail"
  | "err_tls_cert_key_together"
  | "err_pair_code_and_generate_conflict"
  | "err_pair_ttl_positive"
  | "err_pair_once_requirement"
  | "listen_pair_code_rotated"
  | "listen_service"
  | "listen_endpoint"
  | "listen_output"
  | "listen_pair_code"
  | "listen_pair_ttl"
  | "listen_tls_enabled"
  | "listen_press_ctrl_c"
  | "listen_shutdown"
  | "err_tls_ca_requires_tls"
  | "err_tls_insecure_requires_tls"
  | "err_tls_fingerprint_requires_tls"
  | "err_tls_tofu_requires_tls"
  | "err_tls_known_hosts_requires_tofu"
  | "err_tls_fingerprint_tofu_conflict"
  | "err_no_receiver_found"
  | "discover_selected"
  | "send_done"
  | "error_prefix";

type Dictionary = Record<MessageKey, string>;

const zh: Dictionary = {
  lang_option_desc: "界面语言（zh 或 en）",
  app_description: "跨平台局域网文件传输（TypeScript MVP）",
  discover_command_desc: "在局域网中发现 local-sent 接收端",
  doctor_command_desc: "运行本地环境诊断（网络/发现/TLS）",
  listen_command_desc: "作为接收端运行并通过 mDNS 广播",
  send_command_desc: "发送文件或目录到接收端",
  discover_timeout_option: "发现超时（毫秒）",
  discover_json_option: "以 JSON 输出发现结果",
  doctor_port_option: "检查监听端口可用性",
  doctor_output_option: "检查输出目录写权限",
  doctor_timeout_option: "发现超时（毫秒）",
  doctor_tls_cert_option: "TLS 证书路径（可选，启用 TLS 自检）",
  doctor_tls_key_option: "TLS 私钥路径（可选，启用 TLS 自检）",
  doctor_json_option: "以 JSON 输出报告",
  listen_port_option: "监听端口",
  listen_output_option: "输出目录",
  listen_name_option: "广播设备名称",
  listen_pair_code_option: "发送方必须提供的 6 位配对码",
  listen_pair_generate_option: "自动生成 6 位随机配对码",
  listen_pair_once_option: "每次文件成功传输后轮换配对码",
  listen_pair_ttl_option: "每 N 秒轮换配对码",
  listen_tls_cert_option: "TLS 证书文件路径（PEM）",
  listen_tls_key_option: "TLS 私钥文件路径（PEM）",
  send_path_arg: "文件或目录路径",
  send_host_option: "接收端主机；不传时自动发现首个匹配设备",
  send_port_option: "接收端端口",
  send_device_option: "自动发现时按设备名筛选",
  send_timeout_option: "自动发现超时（毫秒）",
  send_pair_code_option: "接收端配对码（6 位）",
  send_tls_option: "使用 TLS 连接",
  send_tls_ca_option: "用于 TLS 校验的 CA/证书 PEM 路径",
  send_tls_insecure_option: "跳过 TLS 证书校验",
  send_tls_fingerprint_option: "服务端证书 SHA-256 指纹",
  send_tls_tofu_option: "首次连接信任服务端证书指纹",
  send_tls_known_hosts_option: "--tls-tofu 的 known hosts 文件路径",
  label_timeout: "timeout",
  label_port: "port",
  label_pair_ttl: "pair-ttl",
  err_positive_integer: "{label} 必须是正整数",
  err_pair_code_format: "配对码必须是 6 位数字",
  discover_none: "未发现接收端。请确认另一台设备已执行：local-sent listen",
  discover_endpoint: "端点",
  discover_addresses: "地址",
  doctor_start: "[doctor] 开始时间={startedAt}",
  doctor_done: "[doctor] 完成，用时 {durationMs}ms | fail={failCount} warn={warnCount}",
  doctor_hint_suffix: " | 建议: {hint}",
  doctor_pass: "通过",
  doctor_warn: "警告",
  doctor_fail: "失败",
  err_tls_cert_key_together: "--tls-cert 和 --tls-key 必须同时设置",
  err_pair_code_and_generate_conflict: "--pair-code 与 --pair-generate 互斥",
  err_pair_ttl_positive: "--pair-ttl 必须是正整数",
  err_pair_once_requirement: "--pair-once 需要 --pair-code 或 --pair-generate 或 --pair-ttl",
  listen_pair_code_rotated: "[listen] pair-code={code} (轮换:{reason}){ttlSuffix}",
  listen_service: "[listen] service={service}",
  listen_endpoint: "[listen] endpoint={host}:{port}",
  listen_output: "[listen] output={output}",
  listen_pair_code: "[listen] pair-code={code}{ttlSuffix}",
  listen_pair_ttl: "[listen] pair-ttl={seconds}s",
  listen_tls_enabled: "[listen] tls=enabled",
  listen_press_ctrl_c: "[listen] 按 Ctrl+C 停止",
  listen_shutdown: "\n[listen] {signal}，正在关闭...",
  err_tls_ca_requires_tls: "--tls-ca 需要与 --tls 一起使用",
  err_tls_insecure_requires_tls: "--tls-insecure 需要与 --tls 一起使用",
  err_tls_fingerprint_requires_tls: "--tls-fingerprint 需要与 --tls 一起使用",
  err_tls_tofu_requires_tls: "--tls-tofu 需要与 --tls 一起使用",
  err_tls_known_hosts_requires_tofu: "--tls-known-hosts 需要与 --tls-tofu 一起使用",
  err_tls_fingerprint_tofu_conflict: "--tls-fingerprint 与 --tls-tofu 互斥",
  err_no_receiver_found: "未发现接收端。请使用 --host + --port，或先执行 local-sent discover",
  discover_selected: "[discover] 已选择 {name} ({host}:{port})",
  send_done: "[send] 完成: files={fileCount} bytes={bytes} resumed={resumed}",
  error_prefix: "[错误] {message}"
};

const en: Dictionary = {
  lang_option_desc: "language (zh or en)",
  app_description: "Cross-platform LAN file transfer (TypeScript MVP)",
  discover_command_desc: "Discover local-sent receivers in LAN",
  doctor_command_desc: "Run local environment diagnostics (network/discovery/TLS)",
  listen_command_desc: "Run as receiver and broadcast via mDNS",
  send_command_desc: "Send a file or directory to receiver",
  discover_timeout_option: "discovery timeout in milliseconds",
  discover_json_option: "output discovered devices as JSON",
  doctor_port_option: "check listen port availability",
  doctor_output_option: "check output directory write access",
  doctor_timeout_option: "discovery timeout in milliseconds",
  doctor_tls_cert_option: "TLS cert file path (optional active TLS self-test)",
  doctor_tls_key_option: "TLS private key path (optional active TLS self-test)",
  doctor_json_option: "print report as JSON",
  listen_port_option: "listen port",
  listen_output_option: "output directory",
  listen_name_option: "broadcasted device name",
  listen_pair_code_option: "6-digit pairing code required by sender",
  listen_pair_generate_option: "generate a random 6-digit pairing code",
  listen_pair_once_option: "rotate pair code after each successful file transfer",
  listen_pair_ttl_option: "rotate pair code every N seconds",
  listen_tls_cert_option: "TLS cert file path (PEM)",
  listen_tls_key_option: "TLS private key file path (PEM)",
  send_path_arg: "file or directory path",
  send_host_option: "receiver host; if omitted, auto-discover first match",
  send_port_option: "receiver port",
  send_device_option: "receiver name filter when auto-discovering",
  send_timeout_option: "auto-discovery timeout in milliseconds",
  send_pair_code_option: "6-digit pairing code for receiver",
  send_tls_option: "connect with TLS",
  send_tls_ca_option: "trusted CA/cert PEM path for TLS validation",
  send_tls_insecure_option: "skip TLS certificate validation",
  send_tls_fingerprint_option: "expected server cert SHA-256 fingerprint",
  send_tls_tofu_option: "trust server certificate fingerprint on first use",
  send_tls_known_hosts_option: "known hosts file path for --tls-tofu",
  label_timeout: "timeout",
  label_port: "port",
  label_pair_ttl: "pair-ttl",
  err_positive_integer: "{label} must be a positive integer",
  err_pair_code_format: "pair code must be exactly 6 digits",
  discover_none: "No receiver found. Make sure another device runs: local-sent listen",
  discover_endpoint: "endpoint",
  discover_addresses: "addresses",
  doctor_start: "[doctor] started={startedAt}",
  doctor_done: "[doctor] done in {durationMs}ms | fail={failCount} warn={warnCount}",
  doctor_hint_suffix: " | hint: {hint}",
  doctor_pass: "PASS",
  doctor_warn: "WARN",
  doctor_fail: "FAIL",
  err_tls_cert_key_together: "--tls-cert and --tls-key must be set together",
  err_pair_code_and_generate_conflict: "--pair-code and --pair-generate are mutually exclusive",
  err_pair_ttl_positive: "--pair-ttl must be a positive integer",
  err_pair_once_requirement: "--pair-once requires --pair-code or --pair-generate or --pair-ttl",
  listen_pair_code_rotated: "[listen] pair-code={code} (rotated:{reason}){ttlSuffix}",
  listen_service: "[listen] service={service}",
  listen_endpoint: "[listen] endpoint={host}:{port}",
  listen_output: "[listen] output={output}",
  listen_pair_code: "[listen] pair-code={code}{ttlSuffix}",
  listen_pair_ttl: "[listen] pair-ttl={seconds}s",
  listen_tls_enabled: "[listen] tls=enabled",
  listen_press_ctrl_c: "[listen] Press Ctrl+C to stop.",
  listen_shutdown: "\n[listen] {signal}, shutting down...",
  err_tls_ca_requires_tls: "--tls-ca requires --tls",
  err_tls_insecure_requires_tls: "--tls-insecure requires --tls",
  err_tls_fingerprint_requires_tls: "--tls-fingerprint requires --tls",
  err_tls_tofu_requires_tls: "--tls-tofu requires --tls",
  err_tls_known_hosts_requires_tofu: "--tls-known-hosts requires --tls-tofu",
  err_tls_fingerprint_tofu_conflict: "--tls-fingerprint and --tls-tofu are mutually exclusive",
  err_no_receiver_found: "no receiver found. Use --host + --port or run local-sent discover first",
  discover_selected: "[discover] selected {name} ({host}:{port})",
  send_done: "[send] done: files={fileCount} bytes={bytes} resumed={resumed}",
  error_prefix: "[error] {message}"
};

const dictionaries: Record<SupportedLocale, Dictionary> = {
  zh,
  en
};

export function resolveCliLocale(argv: string[] = process.argv, env: NodeJS.ProcessEnv = process.env): SupportedLocale {
  const argLang = extractLangFromArgv(argv);
  const envLang = env.LOCAL_SENT_LANG ?? env.LC_ALL ?? env.LANG;
  return normalizeLocale(argLang ?? envLang) ?? "en";
}

export function t(
  locale: SupportedLocale,
  key: MessageKey,
  vars?: Record<string, string | number>
): string {
  const template = dictionaries[locale][key];
  if (!vars) {
    return template;
  }

  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => {
    const value = vars[name];
    return value === undefined ? `{${name}}` : String(value);
  });
}

function extractLangFromArgv(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--lang" && argv[i + 1]) {
      return argv[i + 1];
    }
    if (item.startsWith("--lang=")) {
      return item.slice("--lang=".length);
    }
  }
  return undefined;
}

function normalizeLocale(raw: string | undefined): SupportedLocale | null {
  if (!raw) {
    return null;
  }
  const value = raw.trim().toLowerCase();
  if (value.startsWith("zh")) {
    return "zh";
  }
  if (value.startsWith("en")) {
    return "en";
  }
  return null;
}
