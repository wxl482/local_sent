#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use if_addrs::get_if_addrs;
use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
struct AppState {
  listen_child: Mutex<Option<Child>>,
  listen_port: Mutex<Option<u16>>,
}

#[derive(Debug, Clone)]
struct ListenStateSnapshot {
  running: bool,
  pid: Option<u32>,
  port: Option<u16>,
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

  let listen_state = inspect_listen_state(&state)?;
  if listen_state.running {
    if let Some(local_port) = listen_state.port {
      let local_addresses = local_address_set();
      devices.retain(|device| !is_self_discovered_device(device, local_port, &local_addresses));
    }
  }

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

  let mut command = build_cli_command(&args)?;
  let mut child = command
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|err| format!("failed to start listen process: {err}"))?;

  let pid = child.id();
  if let Some(stdout) = child.stdout.take() {
    spawn_log_reader(stdout, "stdout", app.clone());
  }
  if let Some(stderr) = child.stderr.take() {
    spawn_log_reader(stderr, "stderr", app.clone());
  }

  *guard = Some(child);
  drop(guard);

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
    let line_reader = BufReader::new(reader);
    for line in line_reader.lines().map_while(Result::ok) {
      let payload = ListenLogPayload {
        stream: stream.to_string(),
        line,
      };
      let _ = app.emit("listen-log", payload);
    }
  });
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
    let mut listen_port = state
      .listen_port
      .lock()
      .map_err(|_| "failed to lock listen port state".to_string())?;
    *listen_port = None;
    return Ok(ListenStateSnapshot {
      running: false,
      pid: None,
      port: None,
    });
  }

  let port = {
    let listen_port = state
      .listen_port
      .lock()
      .map_err(|_| "failed to lock listen port state".to_string())?;
    *listen_port
  };

  Ok(ListenStateSnapshot { running, pid, port })
}

fn local_address_set() -> HashSet<String> {
  let mut addresses: HashSet<String> = ["127.0.0.1", "::1", "localhost"]
    .into_iter()
    .map(str::to_string)
    .collect();

  if let Ok(ifaces) = get_if_addrs() {
    for iface in ifaces {
      addresses.insert(iface.ip().to_string());
    }
  }

  addresses
}

fn is_self_discovered_device(device: &DiscoverDevice, local_port: u16, local_addresses: &HashSet<String>) -> bool {
  if device.port != local_port {
    return false;
  }

  if local_addresses.contains(&device.host) {
    return true;
  }

  device.addresses.iter().any(|address| local_addresses.contains(address))
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
      Ok(command)
    }
    CliRuntime::NodeScript(path) => {
      let root = project_root()?;
      let mut command = Command::new("node");
      command.arg(path).args(args).current_dir(root);
      Ok(command)
    }
  }
}

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
  let exe = std::env::current_exe().ok()?;
  let exe_dir = exe.parent()?;
  let mut candidates = Vec::new();
  let bin_name = bundled_cli_binary_name();

  candidates.push(exe_dir.join("resources").join("bin").join(bin_name));
  candidates.push(exe_dir.join("resources").join(bin_name));

  if let Some(contents_dir) = exe_dir.parent() {
    candidates.push(contents_dir.join("Resources").join("bin").join(bin_name));
    candidates.push(contents_dir.join("Resources").join(bin_name));
  }

  if let Some(resources_dir) = exe_dir.ancestors().find(|path| path.ends_with("Resources")) {
    candidates.push(resources_dir.join("bin").join(bin_name));
  }

  candidates.into_iter().find(|path| path.exists())
}

fn release_cli_binary_path() -> Option<PathBuf> {
  let root = project_root().ok()?;
  let path = root.join("release").join(host_release_binary_name());
  path.exists().then_some(path)
}

fn bundled_cli_binary_name() -> &'static str {
  if cfg!(target_os = "windows") {
    "local_sent_cli.exe"
  } else {
    "local_sent_cli"
  }
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

fn main() {
  tauri::Builder::default()
    .manage(AppState::default())
    .invoke_handler(tauri::generate_handler![
      discover,
      send_file,
      pick_send_path,
      default_output_dir,
      start_listen,
      stop_listen,
      listen_status
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri app");
}
