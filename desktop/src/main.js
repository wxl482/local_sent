import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Swal from "sweetalert2";

markPlatformClass();

const translations = {
  zh: {
    eyebrow: "局域网传输控制台",
    title: "Local Sent 桌面端",
    themeLabel: "主题",
    themeLight: "浅色",
    themeDark: "深色",
    languageLabel: "语言",
    navSend: "我要发送",
    navReceive: "我要接收",
    discoverTitle: "设备发现",
    discoverTimeoutLabel: "超时（毫秒）",
    discoverButton: "扫描局域网",
    receiverTitle: "接收端",
    receiverPortLabel: "端口",
    receiverOutputLabel: "输出目录",
    receiverOutputPlaceholder: "~/Downloads",
    pickOutputDirButton: "选择输出目录",
    receiverNameLabel: "设备名称",
    receiverNamePlaceholder: "local-sent-我的设备",
    receiverStartButton: "启动接收端",
    receiverStopButton: "停止",
    sendTitle: "发送",
    sendPathKindLabel: "发送类型",
    sendPathKindFile: "文件",
    sendPathKindDirectory: "目录",
    sendPathLabel: "待发送内容",
    sendPathEmpty: "点击此处选择文件或目录",
    sendPathChosen: "已选择：{name}",
    sendPathClearLabel: "清除已选择项",
    sendHostLabel: "主机（可选，留空自动发现）",
    sendHostPlaceholder: "192.168.1.10",
    sendPortLabel: "端口",
    sendPairLabel: "配对码（可选）",
    sendPairPlaceholder: "123456",
    sendButton: "立即发送",
    sendResumeButton: "继续发送",
    sendInterrupted: "发送已中断。请在接收端重新启动并同意后，点击“继续发送”。",
    logsTitle: "运行日志",
    progressSendLabel: "发送进度",
    progressRecvLabel: "接收进度",
    progressIdle: "等待中",
    listenOffline: "接收端未运行",
    listenOnline: "接收端运行中（pid {pid}）",
    resultNoScanYet: "尚未扫描。",
    resultNoReceiver: "未发现接收端。",
    resultReceiverNotRunning: "接收端未运行。",
    resultScanning: "正在扫描...",
    resultFoundDevices: "发现 {count} 台设备。",
    resultTargetSelected: "已选择目标：{name} ({host}:{port})",
    resultOutputDirSelected: "输出目录已设置。",
    resultStartingReceiver: "正在启动接收端...",
    resultReceiverStarted: "接收端已启动。",
    resultStoppingReceiver: "正在停止接收端...",
    resultReceiverStopped: "接收端已停止。",
    resultSending: "正在发送...",
    resultPathSelected: "已选择发送项：{name}",
    resultSendDone: "发送完成（exit={code}）。",
    confirmReceivePrompt: "来自 {from} 的传输请求：\n{name}\n大小：{size}\n\n是否接受？",
    logConfirmAccepted: "已接受传输请求：{name}（来自 {from}）",
    logConfirmRejected: "已拒绝传输请求：{name}（来自 {from}）",
    alertSendDone: "传输完毕",
    popupTitleInfo: "提示",
    popupTitleSuccess: "成功",
    popupTitleError: "错误",
    popupTitleConfirm: "确认",
    popupConfirmButton: "确定",
    popupCancelButton: "取消",
    errorPathRequired: "请先选择文件或目录。",
    useButton: "使用",
    logStartupReady: "应用已启动，等待操作。",
    logStartupHint: "你可以先选择待发送内容，或切换到接收端启动监听。"
  },
  en: {
    eyebrow: "LAN Transfer Console",
    title: "Local Sent Desktop",
    themeLabel: "Theme",
    themeLight: "Light",
    themeDark: "Dark",
    languageLabel: "Language",
    navSend: "Send",
    navReceive: "Receive",
    discoverTitle: "Discover",
    discoverTimeoutLabel: "Timeout (ms)",
    discoverButton: "Scan LAN",
    receiverTitle: "Receiver",
    receiverPortLabel: "Port",
    receiverOutputLabel: "Output Directory",
    receiverOutputPlaceholder: "~/Downloads",
    pickOutputDirButton: "Pick Output Directory",
    receiverNameLabel: "Device Name",
    receiverNamePlaceholder: "local-sent-my-device",
    receiverStartButton: "Start Receiver",
    receiverStopButton: "Stop",
    sendTitle: "Send",
    sendPathKindLabel: "Send Type",
    sendPathKindFile: "File",
    sendPathKindDirectory: "Directory",
    sendPathLabel: "Send Item",
    sendPathEmpty: "Click to pick file or directory.",
    sendPathChosen: "Selected: {name}",
    sendPathClearLabel: "Clear selected item",
    sendHostLabel: "Host (optional, leave empty for discover mode)",
    sendHostPlaceholder: "192.168.1.10",
    sendPortLabel: "Port",
    sendPairLabel: "Pair Code (optional)",
    sendPairPlaceholder: "123456",
    sendButton: "Send Now",
    sendResumeButton: "Resume Send",
    sendInterrupted: "Transfer interrupted. Restart receiver and approve it, then click \"Resume Send\".",
    logsTitle: "Logs",
    progressSendLabel: "Send Progress",
    progressRecvLabel: "Receive Progress",
    progressIdle: "Idle",
    listenOffline: "Receiver Offline",
    listenOnline: "Receiver Online (pid {pid})",
    resultNoScanYet: "No scan yet.",
    resultNoReceiver: "No receiver found.",
    resultReceiverNotRunning: "Receiver not running.",
    resultScanning: "Scanning...",
    resultFoundDevices: "Found {count} device(s).",
    resultTargetSelected: "Target selected: {name} ({host}:{port})",
    resultOutputDirSelected: "Output directory updated.",
    resultStartingReceiver: "Starting receiver...",
    resultReceiverStarted: "Receiver started.",
    resultStoppingReceiver: "Stopping receiver...",
    resultReceiverStopped: "Receiver stopped.",
    resultSending: "Sending...",
    resultPathSelected: "Selected item: {name}",
    resultSendDone: "Send done (exit={code}).",
    confirmReceivePrompt: "Incoming transfer from {from}:\n{name}\nSize: {size}\n\nAccept?",
    logConfirmAccepted: "Accepted transfer request: {name} (from {from})",
    logConfirmRejected: "Rejected transfer request: {name} (from {from})",
    alertSendDone: "Transfer completed",
    popupTitleInfo: "Notice",
    popupTitleSuccess: "Success",
    popupTitleError: "Error",
    popupTitleConfirm: "Confirm",
    popupConfirmButton: "OK",
    popupCancelButton: "Cancel",
    errorPathRequired: "Please pick a file or directory first.",
    useButton: "Use",
    logStartupReady: "Application started and ready.",
    logStartupHint: "Pick content to send, or switch to Receiver and start listening."
  }
};

const supportedLanguages = ["zh", "en"];
const supportedThemes = ["light", "dark"];
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const IPV4_MAPPED_PATTERN = /::ffff:(\d{1,3}(?:\.\d{1,3}){3})/g;
const RECEIVE_SAVED_LOG_DELAY_MS = 260;

const ui = {
  topbar: document.querySelector(".topbar"),
  sidebarShell: document.querySelector(".sidebar-shell"),
  themeSelect: document.querySelector("#themeSelect"),
  languageSelect: document.querySelector("#languageSelect"),
  navSendBtn: document.querySelector("#navSendBtn"),
  navReceiveBtn: document.querySelector("#navReceiveBtn"),
  sendView: document.querySelector("#sendView"),
  receiveView: document.querySelector("#receiveView"),
  listenState: document.querySelector("#listenState"),

  discoverForm: document.querySelector("#discoverForm"),
  discoverTimeout: document.querySelector("#discoverTimeout"),
  discoverResult: document.querySelector("#discoverResult"),
  discoverBtn: document.querySelector("#discoverBtn"),
  deviceList: document.querySelector("#deviceList"),

  listenForm: document.querySelector("#listenForm"),
  listenPort: document.querySelector("#listenPort"),
  listenOutput: document.querySelector("#listenOutput"),
  pickOutputDirBtn: document.querySelector("#pickOutputDirBtn"),
  listenName: document.querySelector("#listenName"),
  startListenBtn: document.querySelector("#startListenBtn"),
  stopListenBtn: document.querySelector("#stopListenBtn"),
  listenResult: document.querySelector("#listenResult"),

  sendForm: document.querySelector("#sendForm"),
  sendPathKind: document.querySelector("#sendPathKind"),
  sendPathSummary: document.querySelector("#sendPathSummary"),
  clearSendPathBtn: document.querySelector("#clearSendPathBtn"),
  sendHost: document.querySelector("#sendHost"),
  sendPort: document.querySelector("#sendPort"),
  sendPairCode: document.querySelector("#sendPairCode"),
  sendBtn: document.querySelector("#sendBtn"),
  resumeSendBtn: document.querySelector("#resumeSendBtn"),
  sendResult: document.querySelector("#sendResult"),
  progressPanel: document.querySelector("#transferProgress"),
  sendProgressSection: document.querySelector("#sendProgressSection"),
  recvProgressSection: document.querySelector("#recvProgressSection"),
  sendProgressBar: document.querySelector("#sendProgressBar"),
  sendProgressText: document.querySelector("#sendProgressText"),
  recvProgressBar: document.querySelector("#recvProgressBar"),
  recvProgressText: document.querySelector("#recvProgressText"),

  logPane: document.querySelector("#logPane")
};

let currentLanguage = detectInitialLanguage();
let currentTheme = detectInitialTheme();
let currentView = "send";
let selectedSendPath = "";
let selectedSendLabel = "";
const streamBuffers = new Map();
let sendProgressResetTimer = null;
let recvProgressResetTimer = null;
const progressState = {
  send: { lastUpdatedAt: 0, lastPercent: -1, lastSignature: "" },
  recv: { lastUpdatedAt: 0, lastPercent: -1, lastSignature: "" }
};
const progressActivity = {
  send: false,
  recv: false
};
const lastLogByStream = new Map();
let lastSendRequest = null;
let sendTaskRunning = false;

function markPlatformClass() {
  const uaData = String(navigator.userAgentData?.platform ?? "").toLowerCase();
  const ua = String(navigator.userAgent ?? "").toLowerCase();
  const platformText = `${uaData} ${ua}`;

  if (platformText.includes("mac") || platformText.includes("darwin")) {
    document.documentElement.classList.add("platform-macos");
    return;
  }

  if (platformText.includes("win")) {
    document.documentElement.classList.add("platform-windows");
    return;
  }

  if (platformText.includes("linux")) {
    document.documentElement.classList.add("platform-linux");
  }
}

function detectInitialLanguage() {
  const stored = window.localStorage.getItem("local_sent_language");
  if (stored && supportedLanguages.includes(stored)) {
    return stored;
  }
  const browserLang = navigator.language?.toLowerCase() ?? "";
  return browserLang.startsWith("zh") ? "zh" : "en";
}

function detectInitialTheme() {
  const stored = window.localStorage.getItem("local_sent_theme");
  if (stored && supportedThemes.includes(stored)) {
    return stored;
  }
  return "light";
}

function applyTheme() {
  document.documentElement.setAttribute("data-theme", currentTheme);
  if (ui.themeSelect) {
    ui.themeSelect.value = currentTheme;
  }
}

function t(key, vars) {
  const dict = translations[currentLanguage] ?? translations.en;
  const template = dict[key] ?? translations.en[key] ?? key;
  if (!vars) {
    return template;
  }
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => {
    const value = vars[name];
    return value === undefined ? `{${name}}` : String(value);
  });
}

function popupTheme() {
  return currentTheme === "dark" ? "dark" : "light";
}

async function showPopup(message, type = "info") {
  const titleMap = {
    info: t("popupTitleInfo"),
    success: t("popupTitleSuccess"),
    error: t("popupTitleError")
  };

  await Swal.fire({
    title: titleMap[type] ?? t("popupTitleInfo"),
    text: String(message ?? "").trim() || "-",
    icon: type,
    confirmButtonText: t("popupConfirmButton"),
    customClass: {
      popup: "localsent-swal-popup",
      title: "localsent-swal-title",
      actions: "localsent-swal-actions",
      confirmButton: "localsent-swal-confirm",
      cancelButton: "localsent-swal-cancel"
    },
    buttonsStyling: false,
    allowOutsideClick: false,
    allowEscapeKey: true,
    background: popupTheme() === "dark" ? "#0c1830" : "#f5faff",
    color: popupTheme() === "dark" ? "#e6efff" : "#102345"
  });
}

async function showConfirmPopup(message) {
  const result = await Swal.fire({
    title: t("popupTitleConfirm"),
    text: String(message ?? "").trim() || "-",
    icon: "question",
    showCancelButton: true,
    confirmButtonText: t("popupConfirmButton"),
    cancelButtonText: t("popupCancelButton"),
    customClass: {
      popup: "localsent-swal-popup",
      title: "localsent-swal-title",
      actions: "localsent-swal-actions",
      confirmButton: "localsent-swal-confirm",
      cancelButton: "localsent-swal-cancel"
    },
    buttonsStyling: false,
    allowOutsideClick: false,
    allowEscapeKey: false,
    background: popupTheme() === "dark" ? "#0c1830" : "#f5faff",
    color: popupTheme() === "dark" ? "#e6efff" : "#102345"
  });
  return result.isConfirmed;
}

function toErrorMessage(err) {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object";
}

function basenameFromPath(path) {
  const normalized = String(path).replace(/[\\/]+/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(path);
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) {
    return "0 B";
  }
  if (value < 1024) {
    return `${value.toFixed(0)} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function normalizeIpv4(address) {
  const raw = String(address ?? "").trim();
  if (!raw) {
    return null;
  }
  const value = raw.startsWith("::ffff:") ? raw.slice("::ffff:".length) : raw;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!match) {
    return null;
  }
  const octets = match.slice(1).map((item) => Number.parseInt(item, 10));
  if (octets.some((item) => Number.isNaN(item) || item < 0 || item > 255)) {
    return null;
  }
  return octets.join(".");
}

function isLanIpv4(address) {
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

function normalizeLanIpv4(address) {
  const ipv4 = normalizeIpv4(address);
  if (!ipv4) {
    return null;
  }
  if (!isLanIpv4(ipv4)) {
    return null;
  }
  return ipv4;
}

function normalizeDisplayLine(rawLine) {
  return String(rawLine ?? "")
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(IPV4_MAPPED_PATTERN, "$1")
    .replace(/\u0000/g, "")
    .trim();
}

function formatPeerAddress(address) {
  const cleaned = normalizeDisplayLine(address);
  if (!cleaned) {
    return "unknown";
  }
  return cleaned;
}

function normalizeDiscoveredDevice(rawDevice) {
  if (!isObject(rawDevice)) {
    return null;
  }
  const host = normalizeLanIpv4(rawDevice.host);
  if (!host) {
    return null;
  }
  const addresses = Array.isArray(rawDevice.addresses)
    ? [...new Set(rawDevice.addresses.map((item) => normalizeLanIpv4(item)).filter(Boolean))]
    : [];
  const name = String(rawDevice.name ?? "").trim() || host;
  const port = Number.parseInt(String(rawDevice.port ?? ""), 10);
  if (!Number.isFinite(port) || port <= 0) {
    return null;
  }
  return { name, host, port, addresses };
}

function setResult(target, message, isError = false) {
  if (!target) {
    return;
  }
  target.textContent = "";
  target.classList.remove("error");
}

function progressKindForView(view) {
  return view === "receive" ? "recv" : "send";
}

function resolveVisibleProgressKind() {
  if (progressActivity.send && !progressActivity.recv) {
    return "send";
  }
  if (progressActivity.recv && !progressActivity.send) {
    return "recv";
  }
  if (progressActivity.send && progressActivity.recv) {
    return progressKindForView(currentView);
  }
  return null;
}

function syncProgressVisibility() {
  if (!ui.progressPanel || !ui.sendProgressSection || !ui.recvProgressSection) {
    return;
  }

  const visibleKind = resolveVisibleProgressKind();
  ui.progressPanel.classList.toggle("is-collapsed", !visibleKind);
  ui.sendProgressSection.classList.toggle("is-collapsed", visibleKind !== "send");
  ui.recvProgressSection.classList.toggle("is-collapsed", visibleKind !== "recv");
}

function setProgressActive(kind, active) {
  const normalizedKind = kind === "recv" ? "recv" : "send";
  const next = Boolean(active);
  if (next) {
    if (normalizedKind === "send" && sendProgressResetTimer) {
      window.clearTimeout(sendProgressResetTimer);
      sendProgressResetTimer = null;
    }
    if (normalizedKind === "recv" && recvProgressResetTimer) {
      window.clearTimeout(recvProgressResetTimer);
      recvProgressResetTimer = null;
    }
  }
  if (progressActivity[normalizedKind] === next) {
    return;
  }
  progressActivity[normalizedKind] = next;
  syncProgressVisibility();
}

function setProgress(kind, percent, text, force = false) {
  const bar = kind === "send" ? ui.sendProgressBar : ui.recvProgressBar;
  const label = kind === "send" ? ui.sendProgressText : ui.recvProgressText;
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  const safeText = String(text ?? "").trim() || `${safePercent.toFixed(1)}%`;
  const state = kind === "send" ? progressState.send : progressState.recv;
  const now = Date.now();
  const signature = `${safePercent.toFixed(1)}|${safeText}`;
  const percentDelta = Math.abs(safePercent - state.lastPercent);

  if (!force && now - state.lastUpdatedAt < 80 && percentDelta < 0.35) {
    return;
  }

  if (!force && signature === state.lastSignature && now - state.lastUpdatedAt < 220) {
    return;
  }

  state.lastUpdatedAt = now;
  state.lastPercent = safePercent;
  state.lastSignature = signature;

  if (bar) {
    bar.style.width = `${safePercent}%`;
    bar.setAttribute("aria-valuenow", safePercent.toFixed(1));
  }
  if (label) {
    label.textContent = safeText;
  }
}

function resetProgress(kind) {
  const state = kind === "send" ? progressState.send : progressState.recv;
  state.lastUpdatedAt = 0;
  state.lastPercent = -1;
  state.lastSignature = "";
  setProgress(kind, 0, t("progressIdle"), true);
}

function queueProgressReset(kind) {
  const timerKey = kind === "send" ? "send" : "recv";
  if (timerKey === "send" && sendProgressResetTimer) {
    window.clearTimeout(sendProgressResetTimer);
  }
  if (timerKey === "recv" && recvProgressResetTimer) {
    window.clearTimeout(recvProgressResetTimer);
  }

  const timer = window.setTimeout(() => {
    if (timerKey === "send") {
      sendProgressResetTimer = null;
    } else {
      recvProgressResetTimer = null;
    }
    resetProgress(kind);
    setProgressActive(kind, false);
  }, 1600);

  if (timerKey === "send") {
    sendProgressResetTimer = timer;
  } else {
    recvProgressResetTimer = timer;
  }
}

function parseTransferProgressLine(line) {
  const matched =
    /\[(send|recv)\s+([^\]]+)\]\s+(\d+(?:\.\d+)?)%\s*(?:\(([^)]*)\))?\s*([^\s]+\/s)?\s*(?:ETA\s+(\d+)s)?/i.exec(
      line
    );
  if (!matched) {
    return null;
  }
  const eta = matched[6] ? Number.parseInt(matched[6], 10) : null;
  return {
    kind: matched[1].toLowerCase() === "send" ? "send" : "recv",
    label: matched[2],
    percent: Number.parseFloat(matched[3]),
    amount: matched[4] ?? "",
    speed: matched[5] ?? "",
    eta: Number.isFinite(eta) ? eta : null
  };
}

function handleProgressLine(stream, line) {
  const progress = parseTransferProgressLine(line);
  if (progress) {
    setProgressActive(progress.kind, true);
    const compactLabel = basenameFromPath(progress.label);
    const text = [
      `${progress.percent.toFixed(1)}%`,
      compactLabel,
      progress.amount,
      progress.speed,
      progress.eta !== null ? `ETA ${progress.eta}s` : ""
    ]
      .filter(Boolean)
      .join(" · ");
    setProgress(progress.kind, progress.percent, text);
    return true;
  }

  if (/^\[send\]\s+done:/i.test(line)) {
    setProgressActive("send", true);
    setProgress("send", 100, line, true);
    queueProgressReset("send");
    return false;
  }

  if (/^\[receive\]\s+saved\s+/i.test(line)) {
    setProgressActive("recv", true);
    setProgress("recv", 100, line.replace(/^\[receive\]\s+saved\s+/i, "saved: "), true);
    window.setTimeout(() => {
      appendLog(stream, line);
    }, RECEIVE_SAVED_LOG_DELAY_MS);
    queueProgressReset("recv");
    return true;
  }

  if (/^\[receive\]\s+failed:/i.test(line)) {
    setProgressActive("recv", true);
    queueProgressReset("recv");
    return false;
  }

  return false;
}

function setActiveView(view) {
  currentView = view;
  const sendActive = view === "send";
  ui.navSendBtn.classList.toggle("active", sendActive);
  ui.navReceiveBtn.classList.toggle("active", !sendActive);
  ui.sendView.classList.toggle("is-active", sendActive);
  ui.receiveView.classList.toggle("is-active", !sendActive);
  syncProgressVisibility();
}

function refreshSendPathSummary() {
  if (selectedSendLabel) {
    ui.sendPathSummary.textContent = t("sendPathChosen", { name: selectedSendLabel });
    if (ui.clearSendPathBtn) {
      ui.clearSendPathBtn.classList.remove("is-hidden");
    }
  } else {
    ui.sendPathSummary.textContent = t("sendPathEmpty");
    if (ui.clearSendPathBtn) {
      ui.clearSendPathBtn.classList.add("is-hidden");
    }
  }
}

function clearSendPathSelection() {
  selectedSendPath = "";
  selectedSendLabel = "";
  lastSendRequest = null;
  setResumeSendVisible(false);
  refreshSendPathSummary();
}

function currentSendPathKind() {
  return ui.sendPathKind?.value === "directory" ? "directory" : "file";
}

function applyI18n() {
  document.documentElement.lang = currentLanguage;
  ui.languageSelect.value = currentLanguage;

  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.getAttribute("data-i18n");
    if (!key) {
      return;
    }
    element.textContent = t(key);
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    const key = element.getAttribute("data-i18n-placeholder");
    if (!key || !("placeholder" in element)) {
      return;
    }
    element.placeholder = t(key);
  });

  refreshSendPathSummary();
  if (ui.clearSendPathBtn) {
    ui.clearSendPathBtn.setAttribute("aria-label", t("sendPathClearLabel"));
    ui.clearSendPathBtn.setAttribute("title", t("sendPathClearLabel"));
  }
  setResult(ui.discoverResult, t("resultNoScanYet"));
  setResult(ui.listenResult, t("resultReceiverNotRunning"));
  setResult(ui.sendResult, "");
  resetProgress("send");
  resetProgress("recv");
  syncProgressVisibility();
}

function toPositiveInt(value, fallback) {
  const num = Number.parseInt(value, 10);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

async function waitForNextFrame() {
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
}

function setListeningUi(state) {
  const running = Boolean(state?.running);
  const pid = typeof state?.pid === "number" ? state.pid : null;
  ui.listenState.classList.toggle("online", running);
  ui.listenState.classList.toggle("offline", !running);
  ui.listenState.textContent = running ? t("listenOnline", { pid }) : t("listenOffline");

  ui.startListenBtn.disabled = running;
  ui.stopListenBtn.disabled = !running;

  if (!running) {
    setProgressActive("recv", false);
    resetProgress("recv");
  }
}

function setupWindowDragging() {
  const bindDragZone = (zone, blockedSelector) => {
    if (!zone) {
      return;
    }

    zone.addEventListener("mousedown", (event) => {
      if (event.button !== 0) {
        return;
      }

      const rawTarget = event.target;
      const target =
        rawTarget instanceof Element
          ? rawTarget
          : rawTarget instanceof Node
            ? rawTarget.parentElement
            : null;
      if (!target) {
        return;
      }

      if (blockedSelector && target.closest(blockedSelector)) {
        return;
      }

      event.preventDefault();
      void getCurrentWindow().startDragging().catch((err) => {
        console.warn("startDragging failed:", err);
      });
    });
  };

  // Top bar: keep language controls interactive.
  bindDragZone(ui.topbar, ".header-actions");
  // Sidebar: keep menu buttons interactive; drag from other area.
  bindDragZone(ui.sidebarShell, "button, select, input, textarea, a");
}

function appendLog(stream, line) {
  const normalizedLine = normalizeDisplayLine(line);
  if (!normalizedLine) {
    return;
  }
  const now = Date.now();
  const previous = lastLogByStream.get(stream);
  if (previous && previous.line === normalizedLine && now - previous.at < 600) {
    return;
  }
  lastLogByStream.set(stream, { line: normalizedLine, at: now });
  const stamp = new Date().toLocaleTimeString();
  const text = `[${stamp}] [${stream}] ${normalizedLine}`.trim();
  ui.logPane.textContent += `${text}\n`;
  ui.logPane.scrollTop = ui.logPane.scrollHeight;
}

function processLogLine(stream, rawLine) {
  const line = normalizeDisplayLine(rawLine);
  if (!line) {
    return;
  }
  if (handleProgressLine(stream, line)) {
    return;
  }
  appendLog(stream, line);
}

function appendChunkToLog(stream, chunk) {
  const normalized = String(chunk ?? "");
  const previous = streamBuffers.get(stream) ?? "";
  const merged = previous + normalized;
  const segments = merged.split(/\r|\n/);
  const tail = segments.pop() ?? "";

  segments.forEach((line) => processLogLine(stream, line));
  const liveTail = normalizeDisplayLine(tail);
  if (liveTail && handleProgressLine(stream, liveTail)) {
    streamBuffers.set(stream, "");
    return;
  }
  streamBuffers.set(stream, tail);
}

function flushStreamBuffer(stream) {
  const pending = streamBuffers.get(stream);
  if (!pending || !pending.trim()) {
    return;
  }
  processLogLine(stream, pending);
  streamBuffers.set(stream, "");
}

function appendStartupLogs() {
  if (ui.logPane.textContent.trim()) {
    return;
  }
  appendLog("system", t("logStartupReady"));
  appendLog("system", t("logStartupHint"));
}

function setSendControlsDisabled(disabled) {
  ui.sendBtn.disabled = disabled;
  if (ui.resumeSendBtn) {
    ui.resumeSendBtn.disabled = disabled || ui.resumeSendBtn.classList.contains("state-hidden");
  }
  if (ui.sendPathKind) {
    ui.sendPathKind.disabled = disabled;
  }
  if (ui.clearSendPathBtn) {
    ui.clearSendPathBtn.disabled = disabled;
  }
  if (ui.sendPathSummary) {
    ui.sendPathSummary.classList.toggle("is-disabled", disabled);
    ui.sendPathSummary.setAttribute("aria-disabled", String(disabled));
    ui.sendPathSummary.tabIndex = disabled ? -1 : 0;
  }
}

function setResumeSendVisible(visible) {
  if (!ui.resumeSendBtn) {
    return;
  }
  ui.resumeSendBtn.classList.toggle("state-hidden", !visible);
  ui.resumeSendBtn.disabled = !visible || sendTaskRunning;
}

function isSendInterruptedError(rawMessage) {
  const message = String(rawMessage ?? "").toLowerCase();
  return [
    "connection closed before ack",
    "connection reset",
    "econnreset",
    "econnaborted",
    "write epipe",
    "broken pipe",
    "socket hang up",
    "receiver rejected transfer"
  ].some((pattern) => message.includes(pattern));
}

function buildSendRequestFromUi() {
  if (!selectedSendPath.trim()) {
    throw new Error(t("errorPathRequired"));
  }

  return {
    path: selectedSendPath,
    host: ui.sendHost.value.trim() || null,
    port: toPositiveInt(ui.sendPort.value, 37373),
    timeoutMs: 3000,
    pairCode: ui.sendPairCode.value.trim() || null
  };
}

async function runSendRequest(request, options = {}) {
  const resumeMode = Boolean(options.resumeMode);
  if (sendTaskRunning) {
    return;
  }

  sendTaskRunning = true;
  setSendControlsDisabled(true);
  setResumeSendVisible(false);
  setProgressActive("send", true);
  if (!resumeMode) {
    resetProgress("send");
  }
  streamBuffers.set("send", "");
  streamBuffers.set("send-err", "");
  setResult(ui.sendResult, t("resultSending"));
  await waitForNextFrame();

  try {
    const output = await invoke("send_file", { request });
    lastSendRequest = null;
    setResumeSendVisible(false);
    const resultMessage = t("resultSendDone", { code: output.code });
    setResult(ui.sendResult, resultMessage);
    setProgress("send", 100, t("alertSendDone"), true);
    queueProgressReset("send");
    await showPopup(t("alertSendDone"), "success");
  } catch (err) {
    const message = toErrorMessage(err);
    if (isSendInterruptedError(message)) {
      lastSendRequest = { ...request };
      setProgressActive("send", true);
      setResumeSendVisible(true);
      const interruptedMessage = t("sendInterrupted");
      appendLog("send", interruptedMessage);
      await showPopup(interruptedMessage, "error");
    } else {
      lastSendRequest = null;
      setProgressActive("send", false);
      resetProgress("send");
      setResumeSendVisible(false);
      setResult(ui.sendResult, message, true);
      await showPopup(message, "error");
    }
  } finally {
    sendTaskRunning = false;
    setSendControlsDisabled(false);
  }
}

function renderDevices(devices) {
  ui.deviceList.innerHTML = "";
  const normalizedDevices = devices
    .map((device) => normalizeDiscoveredDevice(device))
    .filter((device) => Boolean(device));

  if (!normalizedDevices.length) {
    return 0;
  }

  normalizedDevices.forEach((device) => {
    const item = document.createElement("article");
    item.className = "device-item";

    const header = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = device.name;

    const useBtn = document.createElement("button");
    useBtn.type = "button";
    useBtn.textContent = t("useButton");
    useBtn.addEventListener("click", () => {
      ui.sendHost.value = device.host;
      ui.sendPort.value = String(device.port);
      const message = t("resultTargetSelected", {
        name: device.name,
        host: device.host,
        port: device.port
      });
      setResult(ui.sendResult, message);
      void showPopup(message, "info");
      setActiveView("send");
    });

    header.append(title, useBtn);

    const detail = document.createElement("p");
    const addresses =
      Array.isArray(device.addresses) && device.addresses.length
        ? device.addresses.join(", ")
        : "N/A";
    detail.textContent = `${device.host}:${device.port} | ${addresses}`;

    item.append(header, detail);
    ui.deviceList.append(item);
  });

  return normalizedDevices.length;
}

async function refreshListenState() {
  try {
    const state = await invoke("listen_status");
    setListeningUi(state);
  } catch (err) {
    setListeningUi({ running: false });
    const message = toErrorMessage(err);
    setResult(ui.listenResult, message, true);
    await showPopup(message, "error");
  }
}

async function ensureDefaultOutputDirectory() {
  if (ui.listenOutput.value.trim()) {
    return;
  }
  try {
    const outputDir = await invoke("default_output_dir");
    ui.listenOutput.value =
      typeof outputDir === "string" && outputDir.trim()
        ? outputDir
        : "./received";
  } catch {
    ui.listenOutput.value = "./received";
  }
}

async function pickSendPath(kind) {
  try {
    const selectedPath = await invoke("pick_send_path", { kind });
    if (typeof selectedPath === "string" && selectedPath.trim()) {
      selectedSendPath = selectedPath;
      selectedSendLabel = basenameFromPath(selectedPath);
      lastSendRequest = null;
      setResumeSendVisible(false);
      refreshSendPathSummary();
    }
  } catch (err) {
    const message = toErrorMessage(err);
    setResult(ui.sendResult, message, true);
    await showPopup(message, "error");
  }
}

async function pickOutputDirectory() {
  try {
    const selectedPath = await invoke("pick_send_path", { kind: "directory" });
    if (typeof selectedPath === "string" && selectedPath.trim()) {
      ui.listenOutput.value = selectedPath;
      const message = t("resultOutputDirSelected");
      setResult(ui.listenResult, message);
      await showPopup(message, "success");
    }
  } catch (err) {
    const message = toErrorMessage(err);
    setResult(ui.listenResult, message, true);
    await showPopup(message, "error");
  }
}

ui.languageSelect.addEventListener("change", () => {
  const selected = ui.languageSelect.value;
  if (!supportedLanguages.includes(selected)) {
    return;
  }
  currentLanguage = selected;
  window.localStorage.setItem("local_sent_language", selected);
  applyI18n();
  void refreshListenState();
});

if (ui.themeSelect) {
  ui.themeSelect.addEventListener("change", () => {
    const selected = ui.themeSelect.value;
    if (!supportedThemes.includes(selected)) {
      return;
    }
    currentTheme = selected;
    window.localStorage.setItem("local_sent_theme", selected);
    applyTheme();
  });
}

ui.navSendBtn.addEventListener("click", () => {
  setActiveView("send");
});

ui.navReceiveBtn.addEventListener("click", () => {
  setActiveView("receive");
});

if (ui.sendPathKind) {
  ui.sendPathKind.addEventListener("change", () => {
    clearSendPathSelection();
  });
}

if (ui.sendPathSummary) {
  ui.sendPathSummary.addEventListener("click", () => {
    if (ui.sendPathSummary.classList.contains("is-disabled")) {
      return;
    }
    void pickSendPath(currentSendPathKind());
  });

  ui.sendPathSummary.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    if (ui.sendPathSummary.classList.contains("is-disabled")) {
      return;
    }
    void pickSendPath(currentSendPathKind());
  });
}

if (ui.clearSendPathBtn) {
  ui.clearSendPathBtn.addEventListener("click", () => {
    if (ui.clearSendPathBtn.disabled) {
      return;
    }
    clearSendPathSelection();
  });
}

ui.pickOutputDirBtn.addEventListener("click", () => {
  void pickOutputDirectory();
});

ui.discoverForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  ui.discoverBtn.disabled = true;
  setResult(ui.discoverResult, t("resultScanning"));
  await waitForNextFrame();

  try {
    const timeoutMs = toPositiveInt(ui.discoverTimeout.value, 3000);
    const devices = await invoke("discover", { timeoutMs });
    const visibleCount = renderDevices(devices);
    const message = t("resultFoundDevices", { count: visibleCount });
    setResult(ui.discoverResult, message);
    await showPopup(message, "success");
  } catch (err) {
    renderDevices([]);
    const message = toErrorMessage(err);
    setResult(ui.discoverResult, message, true);
    await showPopup(message, "error");
  } finally {
    ui.discoverBtn.disabled = false;
  }
});

ui.listenForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  ui.startListenBtn.disabled = true;
  setResult(ui.listenResult, t("resultStartingReceiver"));

  try {
    const request = {
      port: toPositiveInt(ui.listenPort.value, 37373),
      outputDir: ui.listenOutput.value.trim() || "./received",
      name: ui.listenName.value.trim() || null
    };

    const state = await invoke("start_listen", { request });
    setListeningUi(state);
    const message = t("resultReceiverStarted");
    setResult(ui.listenResult, message);
    await showPopup(message, "success");
  } catch (err) {
    const message = toErrorMessage(err);
    setResult(ui.listenResult, message, true);
    await showPopup(message, "error");
    await refreshListenState();
  } finally {
    ui.startListenBtn.disabled = false;
  }
});

ui.stopListenBtn.addEventListener("click", async () => {
  ui.stopListenBtn.disabled = true;
  setResult(ui.listenResult, t("resultStoppingReceiver"));

  try {
    const state = await invoke("stop_listen");
    setListeningUi(state);
    const message = t("resultReceiverStopped");
    setResult(ui.listenResult, message);
    await showPopup(message, "success");
  } catch (err) {
    const message = toErrorMessage(err);
    setResult(ui.listenResult, message, true);
    await showPopup(message, "error");
    await refreshListenState();
  }
});

ui.sendForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const request = buildSendRequestFromUi();
    await runSendRequest(request, { resumeMode: false });
  } catch (err) {
    const message = toErrorMessage(err);
    setResult(ui.sendResult, message, true);
    await showPopup(message, "error");
  }
});

if (ui.resumeSendBtn) {
  ui.resumeSendBtn.addEventListener("click", async () => {
    if (!lastSendRequest) {
      return;
    }
    await runSendRequest({ ...lastSendRequest }, { resumeMode: true });
  });
}

async function bootstrap() {
  applyTheme();
  setActiveView(currentView);
  applyI18n();
  setupWindowDragging();
  appendStartupLogs();

  await listen("listen-log", (event) => {
    const payload = event.payload;
    if (!isObject(payload)) {
      return;
    }
    const stream =
      payload.stream === "stderr"
        ? "recv-err"
        : payload.stream === "system"
          ? "system"
          : "recv";
    processLogLine(stream, payload.line ?? "");
  });

  await listen("listen-state", (event) => {
    setListeningUi(event.payload);
  });

  await listen("transfer-confirm-request", async (event) => {
    const payload = event.payload;
    if (!isObject(payload)) {
      return;
    }
    const id = Number(payload.id);
    if (!Number.isFinite(id) || id <= 0) {
      return;
    }

    const path = typeof payload.path === "string" ? payload.path : "";
    const from = formatPeerAddress(payload.from);
    const size = formatBytes(payload.size);
    const name = basenameFromPath(path || "unknown");

    const accepted = await showConfirmPopup(
      t("confirmReceivePrompt", {
        from,
        name,
        size
      })
    );

    appendLog(
      "confirm",
      accepted
        ? t("logConfirmAccepted", { name, from })
        : t("logConfirmRejected", { name, from })
    );

    try {
      await invoke("respond_transfer_confirm", {
        response: {
          id,
          accept: accepted
        }
      });
    } catch (err) {
      const message = `confirm response failed: ${toErrorMessage(err)}`;
      appendLog("confirm", message);
      await showPopup(message, "error");
    }
  });

  await listen("send-output", (event) => {
    const payload = event.payload;
    if (!isObject(payload)) {
      return;
    }
    const stream = payload.stream === "stderr" ? "send-err" : "send";
    const chunk = typeof payload.chunk === "string" ? payload.chunk : "";
    if (!chunk) {
      flushStreamBuffer(stream);
      return;
    }

    appendChunkToLog(stream, chunk);
  });

  await ensureDefaultOutputDirectory();
  await refreshListenState();
}

void bootstrap();
