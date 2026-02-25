#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use if_addrs::get_if_addrs;
use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
struct AppState {
  listen_child: Mutex<Option<Child>>,
  listen_stdin: Mutex<Option<ChildStdin>>,
  listen_port: Mutex<Option<u16>>,
}

#[derive(Debug, Clone)]
struct ListenStateSnapshot {
  running: bool,
  pid: Option<u32>,
}

enum CliRuntime {
  Binary(PathBuf),
  NodeScript(PathBuf),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ListenStatePayload {
  running: bool,
  pid: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ListenLogPayload {
  stream: String,
  line: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SendOutputPayload {
  stream: String,
  chunk: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandResult {
  success: bool,
  code: i32,
  stdout: String,
  stderr: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiscoverDevice {
  name: String,
  host: String,
  port: u16,
  addresses: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListenRequest {
  port: u16,
  output_dir: String,
  name: Option<String>,
  pair_code: Option<String>,
  tls_cert_path: Option<String>,
  tls_key_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendRequest {
  path: String,
  host: Option<String>,
  port: u16,
  device: Option<String>,
  timeout_ms: Option<u64>,
  pair_code: Option<String>,
  tls: Option<bool>,
  tls_insecure: Option<bool>,
  tls_fingerprint: Option<String>,
  tls_tofu: Option<bool>,
  tls_known_hosts: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransferConfirmResponse {
  id: u64,
  accept: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CliConfirmRequest {
  id: u64,
  from: Option<String>,
  path: String,
  size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TransferConfirmRequestPayload {
  id: u64,
  from: String,
  path: String,
  size: u64,
}

#[tauri::command]
async fn discover(timeout_ms: Option<u64>, state: State<'_, AppState>) -> Result<Vec<DiscoverDevice>, String> {
  let timeout = timeout_ms.unwrap_or(3000).max(100);
  let args = vec![
    "discover".to_string(),
    "-t".to_string(),
    timeout.to_string(),
    "--json".to_string(),
  ];

  let output = run_cli_capture_async(args).await?;
  if !output.success {
    return Err(render_cli_error("discover", &output));
  }

  let stdout = output.stdout.trim();
  if stdout.is_empty() {
    return Ok(Vec::new());
  }

  let mut devices: Vec<DiscoverDevice> =
    serde_json::from_str(stdout).map_err(|err| format!("failed to parse discovery JSON: {err}"))?;

  let _ = inspect_listen_state(&state)?;
  let local_addresses = local_address_set();
  devices.retain(|device| !is_local_discovered_device(device, &local_addresses));

  Ok(devices)
}

#[tauri::command]
async fn send_file(app: AppHandle, request: SendRequest) -> Result<CommandResult, String> {
  if request.path.trim().is_empty() {
    return Err("path is required".to_string());
  }
  if request.port == 0 {
    return Err("port must be in 1-65535".to_string());
  }
  if let Some(host) = request.host.as_ref() {
    if host.trim().is_empty() {
      return Err("host cannot be empty string".to_string());
    }
  }

  let mut args = vec!["send".to_string(), request.path];
  args.push("--port".to_string());
  args.push(request.port.to_string());

  if let Some(host) = request.host.filter(|value| !value.trim().is_empty()) {
    args.push("--host".to_string());
    args.push(host);
  }

  if let Some(device) = request.device.filter(|value| !value.trim().is_empty()) {
    args.push("--device".to_string());
    args.push(device);
  }

  args.push("-t".to_string());
  args.push(request.timeout_ms.unwrap_or(3000).max(100).to_string());

  if let Some(code) = request.pair_code.filter(|value| !value.trim().is_empty()) {
    args.push("--pair-code".to_string());
    args.push(code);
  }

  if request.tls.unwrap_or(false) {
    args.push("--tls".to_string());
  }
  if request.tls_insecure.unwrap_or(false) {
    args.push("--tls-insecure".to_string());
  }
  if let Some(fingerprint) = request.tls_fingerprint.filter(|value| !value.trim().is_empty()) {
    args.push("--tls-fingerprint".to_string());
    args.push(fingerprint);
  }
  if request.tls_tofu.unwrap_or(false) {
    args.push("--tls-tofu".to_string());
  }
  if let Some(known_hosts_path) = request
    .tls_known_hosts
    .filter(|value| !value.trim().is_empty())
  {
    args.push("--tls-known-hosts".to_string());
    args.push(known_hosts_path);
  }

  let output = run_cli_capture_streaming_async(app, args).await?;
  if !output.success {
    return Err(render_cli_error("send", &output));
  }
  Ok(output)
}

#[tauri::command]
fn start_listen(
  app: AppHandle,
  state: State<AppState>,
  request: ListenRequest,
) -> Result<ListenStatePayload, String> {
  if request.port == 0 {
    return Err("port must be in 1-65535".to_string());
  }
  if (request.tls_cert_path.is_some() && request.tls_key_path.is_none())
    || (request.tls_cert_path.is_none() && request.tls_key_path.is_some())
  {
    return Err("--tls-cert and --tls-key must be provided together".to_string());
  }

  let mut guard = state
    .listen_child
    .lock()
    .map_err(|_| "failed to lock listen process state".to_string())?;

  if let Some(child) = guard.as_mut() {
    match child.try_wait() {
      Ok(Some(_)) => {
        *guard = None;
      }
      Ok(None) => {
        return Err("listen process is already running".to_string());
      }
      Err(err) => {
        return Err(format!("failed to check listen process status: {err}"));
      }
    }
  }

  let mut args = vec![
    "listen".to_string(),
    "-p".to_string(),
    request.port.to_string(),
    "-o".to_string(),
    request.output_dir,
  ];

  if let Some(name) = request.name.filter(|value| !value.trim().is_empty()) {
    args.push("-n".to_string());
    args.push(name);
  }
  if let Some(pair_code) = request.pair_code.filter(|value| !value.trim().is_empty()) {
    args.push("--pair-code".to_string());
    args.push(pair_code);
  }
  if let (Some(cert_path), Some(key_path)) = (request.tls_cert_path, request.tls_key_path) {
    args.push("--tls-cert".to_string());
    args.push(cert_path);
    args.push("--tls-key".to_string());
    args.push(key_path);
  }
  args.push("--confirm-each".to_string());

  let mut command = build_cli_command(&args)?;
  let mut child = command
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|err| format!("failed to start listen process: {err}"))?;

  let pid = child.id();
  let child_stdin = child.stdin.take();
  if let Some(stdout) = child.stdout.take() {
    spawn_log_reader(stdout, "stdout", app.clone());
  }
  if let Some(stderr) = child.stderr.take() {
    spawn_log_reader(stderr, "stderr", app.clone());
  }

  *guard = Some(child);
  drop(guard);

  let mut stdin_guard = state
    .listen_stdin
    .lock()
    .map_err(|_| "failed to lock listen stdin state".to_string())?;
  *stdin_guard = child_stdin;
  drop(stdin_guard);

  let mut listen_port = state
    .listen_port
    .lock()
    .map_err(|_| "failed to lock listen port state".to_string())?;
  *listen_port = Some(request.port);
  drop(listen_port);

  let payload = ListenStatePayload {
    running: true,
    pid: Some(pid),
  };
  let _ = app.emit("listen-state", payload.clone());
  Ok(payload)
}

#[tauri::command]
fn stop_listen(app: AppHandle, state: State<AppState>) -> Result<ListenStatePayload, String> {
  let mut guard = state
    .listen_child
    .lock()
    .map_err(|_| "failed to lock listen process state".to_string())?;

  if let Some(mut child) = guard.take() {
    let _ = child.kill();
    let _ = child.wait();
  }
  drop(guard);

  let mut stdin_guard = state
    .listen_stdin
    .lock()
    .map_err(|_| "failed to lock listen stdin state".to_string())?;
  *stdin_guard = None;
  drop(stdin_guard);

  let mut listen_port = state
    .listen_port
    .lock()
    .map_err(|_| "failed to lock listen port state".to_string())?;
  *listen_port = None;
  drop(listen_port);

  let payload = ListenStatePayload {
    running: false,
    pid: None,
  };
  let _ = app.emit("listen-state", payload.clone());
  Ok(payload)
}

#[tauri::command]
fn respond_transfer_confirm(
  state: State<AppState>,
  response: TransferConfirmResponse,
) -> Result<(), String> {
  let mut stdin_guard = state
    .listen_stdin
    .lock()
    .map_err(|_| "failed to lock listen stdin state".to_string())?;

  let stdin = stdin_guard
    .as_mut()
    .ok_or_else(|| "listen process is not running".to_string())?;

  let action = if response.accept { "approve" } else { "reject" };
  writeln!(stdin, "{action} {}", response.id)
    .map_err(|err| format!("failed to write confirm response: {err}"))?;
  stdin
    .flush()
    .map_err(|err| format!("failed to flush confirm response: {err}"))?;
  Ok(())
}

#[tauri::command]
fn listen_status(state: State<AppState>) -> Result<ListenStatePayload, String> {
  let snapshot = inspect_listen_state(&state)?;
  Ok(ListenStatePayload {
    running: snapshot.running,
    pid: snapshot.pid,
  })
}

fn spawn_log_reader<R>(reader: R, stream: &'static str, app: AppHandle)
where
  R: Read + Send + 'static,
{
  thread::spawn(move || {
    let mut reader = reader;
    let mut chunk = [0u8; 4096];
    let mut pending = String::new();

    loop {
      let read_size = match reader.read(&mut chunk) {
        Ok(size) => size,
        Err(_) => break,
      };
      if read_size == 0 {
        break;
      }

      let text = String::from_utf8_lossy(&chunk[..read_size]);
      pending.push_str(&text);

      let normalized = pending.replace('\r', "\n");
      let mut parts: Vec<&str> = normalized.split('\n').collect();
      let tail = parts.pop().unwrap_or_default().to_string();
      for line in parts {
        emit_listen_line(&app, stream, line);
      }
      pending = tail;
    }

    if !pending.trim().is_empty() {
      emit_listen_line(&app, stream, &pending);
    }
  });
}

fn parse_confirm_request(line: &str) -> Option<CliConfirmRequest> {
  const PREFIX: &str = "[confirm-request] ";
  let raw = line.strip_prefix(PREFIX)?;
  serde_json::from_str::<CliConfirmRequest>(raw).ok()
}

fn emit_listen_line(app: &AppHandle, stream: &'static str, raw_line: &str) {
  let line = raw_line.trim();
  if line.is_empty() {
    return;
  }

  if stream == "stdout" {
    if let Some(request) = parse_confirm_request(line) {
      let payload = TransferConfirmRequestPayload {
        id: request.id,
        from: request.from.unwrap_or_else(|| "unknown".to_string()),
        path: request.path,
        size: request.size,
      };
      let _ = app.emit("transfer-confirm-request", payload);
      return;
    }
  }

  let payload = ListenLogPayload {
    stream: stream.to_string(),
    line: line.to_string(),
  };
  let _ = app.emit("listen-log", payload);
}

fn inspect_listen_state(state: &State<AppState>) -> Result<ListenStateSnapshot, String> {
  let (running, pid) = {
    let mut guard = state
      .listen_child
      .lock()
      .map_err(|_| "failed to lock listen process state".to_string())?;

    if let Some(child) = guard.as_mut() {
      match child.try_wait() {
        Ok(Some(_)) => {
          *guard = None;
        }
        Ok(None) => {}
        Err(err) => {
          return Err(format!("failed to inspect listen process: {err}"));
        }
      }
    }
    (guard.is_some(), guard.as_ref().map(|child| child.id()))
  };

  if !running {
    let mut listen_stdin = state
      .listen_stdin
      .lock()
      .map_err(|_| "failed to lock listen stdin state".to_string())?;
    *listen_stdin = None;

    let mut listen_port = state
      .listen_port
      .lock()
      .map_err(|_| "failed to lock listen port state".to_string())?;
    *listen_port = None;
    return Ok(ListenStateSnapshot {
      running: false,
      pid: None,
    });
  }

  Ok(ListenStateSnapshot { running, pid })
}

fn local_address_set() -> HashSet<String> {
  let mut addresses: HashSet<String> = ["127.0.0.1", "::1", "localhost"]
    .into_iter()
    .map(str::to_string)
    .collect();

  if let Ok(ifaces) = get_if_addrs() {
    for iface in ifaces {
      let ip = iface.ip().to_string();
      addresses.insert(ip.clone());
      addresses.insert(canonical_discovery_address(&ip));
    }
  }

  addresses
}

fn is_local_discovered_device(device: &DiscoverDevice, local_addresses: &HashSet<String>) -> bool {
  if local_addresses.contains(&device.host) {
    return true;
  }

  if local_addresses.contains(&canonical_discovery_address(&device.host)) {
    return true;
  }

  device.addresses.iter().any(|address| {
    local_addresses.contains(address) || local_addresses.contains(&canonical_discovery_address(address))
  })
}

fn canonical_discovery_address(raw: &str) -> String {
  let value = raw.trim();
  if let Some(stripped) = value.strip_prefix("::ffff:") {
    return stripped.to_string();
  }
  value.to_string()
}

#[tauri::command]
fn pick_send_path(kind: String) -> Result<Option<String>, String> {
  let selected = match kind.as_str() {
    "file" => FileDialog::new().pick_file(),
    "directory" => FileDialog::new().pick_folder(),
    _ => return Err("invalid picker kind, expected `file` or `directory`".to_string()),
  };

  Ok(selected.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
fn default_output_dir() -> String {
  default_download_dir()
    .map(|path| path.to_string_lossy().to_string())
    .unwrap_or_else(|| "./received".to_string())
}

async fn run_cli_capture_async(args: Vec<String>) -> Result<CommandResult, String> {
  tauri::async_runtime::spawn_blocking(move || run_cli_capture(args))
    .await
    .map_err(|err| format!("failed to join CLI task: {err}"))?
}

async fn run_cli_capture_streaming_async(app: AppHandle, args: Vec<String>) -> Result<CommandResult, String> {
  tauri::async_runtime::spawn_blocking(move || run_cli_capture_streaming(app, args))
    .await
    .map_err(|err| format!("failed to join CLI task: {err}"))?
}

fn run_cli_capture(args: Vec<String>) -> Result<CommandResult, String> {
  let mut command = build_cli_command(&args)?;
  let output = command
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .output()
    .map_err(|err| format!("failed to execute CLI: {err}"))?;

  Ok(CommandResult {
    success: output.status.success(),
    code: output.status.code().unwrap_or(-1),
    stdout: String::from_utf8_lossy(&output.stdout).to_string(),
    stderr: String::from_utf8_lossy(&output.stderr).to_string(),
  })
}

fn run_cli_capture_streaming(app: AppHandle, args: Vec<String>) -> Result<CommandResult, String> {
  let mut command = build_cli_command(&args)?;
  let mut child = command
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|err| format!("failed to execute CLI: {err}"))?;

  let stdout = child
    .stdout
    .take()
    .ok_or_else(|| "failed to capture CLI stdout".to_string())?;
  let stderr = child
    .stderr
    .take()
    .ok_or_else(|| "failed to capture CLI stderr".to_string())?;

  let stdout_app = app.clone();
  let stdout_reader = thread::spawn(move || stream_output(stdout, "stdout", stdout_app));
  let stderr_reader = thread::spawn(move || stream_output(stderr, "stderr", app));

  let status = child
    .wait()
    .map_err(|err| format!("failed to wait CLI process: {err}"))?;
  let stdout = join_stream_reader(stdout_reader, "stdout")?;
  let stderr = join_stream_reader(stderr_reader, "stderr")?;

  Ok(CommandResult {
    success: status.success(),
    code: status.code().unwrap_or(-1),
    stdout,
    stderr,
  })
}

fn join_stream_reader(
  reader: thread::JoinHandle<Result<String, String>>,
  stream: &'static str,
) -> Result<String, String> {
  match reader.join() {
    Ok(output) => output,
    Err(_) => Err(format!("failed to join CLI {stream} reader")),
  }
}

fn stream_output<R>(mut reader: R, stream: &'static str, app: AppHandle) -> Result<String, String>
where
  R: Read,
{
  let mut output = Vec::new();
  let mut buffer = [0u8; 4096];

  loop {
    let read_size = reader
      .read(&mut buffer)
      .map_err(|err| format!("failed to read CLI {stream}: {err}"))?;
    if read_size == 0 {
      break;
    }

    let chunk = &buffer[..read_size];
    output.extend_from_slice(chunk);
    let payload = SendOutputPayload {
      stream: stream.to_string(),
      chunk: String::from_utf8_lossy(chunk).to_string(),
    };
    let _ = app.emit("send-output", payload);
  }

  Ok(String::from_utf8_lossy(&output).to_string())
}

fn default_download_dir() -> Option<PathBuf> {
  let home = if cfg!(target_os = "windows") {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))
  } else {
    std::env::var_os("HOME")
  }?;

  Some(PathBuf::from(home).join("Downloads"))
}

fn render_cli_error(command: &str, output: &CommandResult) -> String {
  let mut lines = vec![format!("{command} failed (exit code {})", output.code)];
  if !output.stderr.trim().is_empty() {
    lines.push(output.stderr.trim().to_string());
  }
  if !output.stdout.trim().is_empty() {
    lines.push(output.stdout.trim().to_string());
  }
  lines.join("\n")
}

fn build_cli_command(args: &[String]) -> Result<Command, String> {
  match resolve_cli_runtime()? {
    CliRuntime::Binary(path) => {
      let mut command = Command::new(path);
      command.args(args);
      configure_cli_command_for_platform(&mut command);
      Ok(command)
    }
    CliRuntime::NodeScript(path) => {
      let root = project_root()?;
      let mut command = Command::new("node");
      command.arg(path).args(args).current_dir(root);
      configure_cli_command_for_platform(&mut command);
      Ok(command)
    }
  }
}

#[cfg(target_os = "windows")]
fn configure_cli_command_for_platform(command: &mut Command) {
  use std::os::windows::process::CommandExt;
  const CREATE_NO_WINDOW: u32 = 0x08000000;
  command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn configure_cli_command_for_platform(_command: &mut Command) {}

fn resolve_cli_runtime() -> Result<CliRuntime, String> {
  if let Some(path) = std::env::var_os("LOCAL_SENT_CLI_PATH").map(PathBuf::from) {
    if path.exists() {
      return Ok(CliRuntime::Binary(path));
    }
  }

  if let Some(path) = bundled_cli_binary_path() {
    return Ok(CliRuntime::Binary(path));
  }

  if let Some(path) = release_cli_binary_path() {
    return Ok(CliRuntime::Binary(path));
  }

  if let Ok(path) = node_cli_script_path() {
    return Ok(CliRuntime::NodeScript(path));
  }

  Err(
    "missing bundled CLI binary and dist/cli.js. Rebuild desktop package (npm run tauri:build) or run npm run build in project root."
      .to_string(),
  )
}

fn bundled_cli_binary_path() -> Option<PathBuf> {
  bundled_cli_binary_candidates_from_exe()
    .into_iter()
    .find(|path| path.exists())
}

fn release_cli_binary_path() -> Option<PathBuf> {
  let root = project_root().ok()?;
  let path = root.join("release").join(host_release_binary_name());
  path.exists().then_some(path)
}

fn bundled_cli_binary_name_candidates() -> &'static [&'static str] {
  if cfg!(target_os = "windows") {
    &[
      "local_sent_cli.exe",
      "local_sent_cli-x86_64-pc-windows-msvc.exe",
      "local_sent_cli-aarch64-pc-windows-msvc.exe",
    ]
  } else if cfg!(target_os = "linux") {
    &[
      "local_sent_cli",
      "local_sent_cli-x86_64-unknown-linux-gnu",
      "local_sent_cli-aarch64-unknown-linux-gnu",
      "local_sent_cli-x86_64-unknown-linux-musl",
      "local_sent_cli-aarch64-unknown-linux-musl",
    ]
  } else if cfg!(target_os = "macos") {
    &[
      "local_sent_cli",
      "local_sent_cli-aarch64-apple-darwin",
      "local_sent_cli-x86_64-apple-darwin",
    ]
  } else {
    &["local_sent_cli"]
  }
}

fn bundled_cli_binary_candidates_from_exe() -> Vec<PathBuf> {
  let mut candidates = Vec::new();
  let exe = match std::env::current_exe() {
    Ok(path) => path,
    Err(_) => return candidates,
  };
  let Some(exe_dir) = exe.parent() else {
    return candidates;
  };

  for name in bundled_cli_binary_name_candidates() {
    candidates.push(exe_dir.join("bin").join(name));
    candidates.push(exe_dir.join(name));
    candidates.push(exe_dir.join("resources").join("bin").join(name));
    candidates.push(exe_dir.join("resources").join(name));

    if let Some(contents_dir) = exe_dir.parent() {
      candidates.push(contents_dir.join("Resources").join("bin").join(name));
      candidates.push(contents_dir.join("Resources").join(name));
    }

    if let Some(resources_dir) = exe_dir.ancestors().find(|path| path.ends_with("Resources")) {
      candidates.push(resources_dir.join("bin").join(name));
      candidates.push(resources_dir.join(name));
    }
  }

  candidates
}

fn host_release_binary_name() -> &'static str {
  if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
    "local_sent-macos-arm64"
  } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
    "local_sent-macos-x64"
  } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
    "local_sent-win-x64.exe"
  } else if cfg!(all(target_os = "windows", target_arch = "aarch64")) {
    "local_sent-win-arm64.exe"
  } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
    "local_sent-linux-x64"
  } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
    "local_sent-linux-arm64"
  } else {
    "local_sent"
  }
}

fn node_cli_script_path() -> Result<PathBuf, String> {
  let path = project_root()?.join("dist").join("cli.js");
  if path.exists() {
    return Ok(path);
  }
  Err("missing dist/cli.js. Run `npm run build` in project root first.".to_string())
}

fn project_root() -> Result<PathBuf, String> {
  let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
  let desktop_dir = manifest_dir
    .parent()
    .ok_or_else(|| "failed to resolve desktop directory".to_string())?;
  let root_dir = desktop_dir
    .parent()
    .ok_or_else(|| "failed to resolve project root".to_string())?;
  Ok(root_dir.to_path_buf())
}

fn configure_bundled_cli_env(app: &tauri::AppHandle) {
  for name in bundled_cli_binary_name_candidates() {
    if let Ok(path) = app.path().resolve(format!("bin/{name}"), BaseDirectory::Resource) {
      if path.exists() {
        set_cli_path_env(path);
        return;
      }
    }
    if let Ok(path) = app.path().resolve(name.to_string(), BaseDirectory::Resource) {
      if path.exists() {
        set_cli_path_env(path);
        return;
      }
    }
  }

  if let Some(path) = bundled_cli_binary_path() {
    set_cli_path_env(path);
  }
}

fn set_cli_path_env(path: PathBuf) {
  unsafe {
    std::env::set_var("LOCAL_SENT_CLI_PATH", path);
  }
}

fn main() {
  tauri::Builder::default()
    .manage(AppState::default())
    .setup(|app| {
      configure_bundled_cli_env(app.handle());
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      discover,
      send_file,
      pick_send_path,
      default_output_dir,
      start_listen,
      stop_listen,
      respond_transfer_confirm,
      listen_status
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri app");
}
