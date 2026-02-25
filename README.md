# local-sent (TypeScript MVP)

跨平台局域网文件传输 CLI（Windows/macOS/Linux），当前能力：

- 局域网设备发现（`mDNS + UDP 广播兜底`）
- 发送单文件或目录（目录递归）
- 断点续传（同路径自动续传）
- 进度显示 + 传输完成 `SHA-256` 校验
- 可选 TLS 加密传输

## 环境

- Node.js >= 20（已在 Node 22 验证）
- npm / pnpm

## 安装

```bash
npm install
```

## 开发运行

CLI 支持中英双语输出，可通过全局参数切换：

```bash
npm run dev -- --lang zh --help
npm run dev -- --lang en --help
```

也可通过环境变量指定默认语言（优先级低于 `--lang`）：

```bash
LOCAL_SENT_LANG=zh npm run dev -- discover
LOCAL_SENT_LANG=en npm run dev -- discover
```

### 1) 启动接收端

```bash
npm run dev -- listen -p 37373 -o ./received -n my-laptop
```

参数：

- `-p, --port` 监听端口（默认 `37373`）
- `-o, --output` 接收目录（默认 `./received`）
- `-n, --name` 设备名（默认 `local-sent-<hostname>`）
- `--pair-code` 固定 6 位配对码（可选）
- `--pair-generate` 自动生成 6 位配对码（可选）
- `--pair-once` 每成功传完一个文件后自动换新码（可选）
- `--pair-ttl` 每 N 秒自动换新码（可选）
- `--tls-cert` TLS 证书 PEM 路径（可选）
- `--tls-key` TLS 私钥 PEM 路径（可选，需与 `--tls-cert` 一起使用）

### 2) 发现设备

```bash
npm run dev -- discover -t 3000
```

参数：

- `-t, --timeout` 发现超时毫秒（默认 `3000`）

### 3) 环境自检（doctor）

```bash
npm run dev -- doctor -p 37373 -o ./received -t 3000
```

TLS 自检（会启动临时 TLS 收发并做指纹校验）：

```bash
npm run dev -- doctor --tls-cert ./cert.pem --tls-key ./key.pem
```

JSON 输出：

```bash
npm run dev -- doctor --json
```

参数：

- `-p, --port` 检查监听端口是否可用（默认 `37373`）
- `-o, --output` 检查接收目录是否可写（默认 `./received`）
- `-t, --timeout` 发现超时毫秒（默认 `3000`）
- `--tls-cert` / `--tls-key` 可选，提供后会执行 TLS 主动自检
- `--json` 输出机器可读报告

### 4) 发送文件/目录

指定目标地址：

```bash
npm run dev -- send /path/to/file-or-dir --host 192.168.1.10 --port 37373
```

自动发现并发送（可按设备名筛选）：

```bash
npm run dev -- send /path/to/file-or-dir --device my-laptop -t 3000
```

TLS 发送（自签名示例）：

```bash
npm run dev -- send /path/to/file --host 192.168.1.10 --port 37373 --tls --tls-insecure
```

TLS 指纹固定（推荐）：

```bash
npm run dev -- send /path/to/file --host 192.168.1.10 --port 37373 --tls --tls-fingerprint <SHA256_HEX>
```

TLS 首次信任（TOFU）：

```bash
npm run dev -- send /path/to/file --host 192.168.1.10 --port 37373 --tls --tls-tofu
```

配对码发送：

```bash
npm run dev -- send /path/to/file --host 192.168.1.10 --port 37373 --pair-code 123456
```

一次一换（接收端）：

```bash
npm run dev -- listen --pair-generate --pair-once
```

按时间轮换（接收端）：

```bash
npm run dev -- listen --pair-ttl 60
```

参数：

- `--host` 接收端 IP/域名（不传时自动发现）
- `--port` 接收端端口（默认 `37373`）
- `--device` 自动发现时按名称过滤
- `-t, --timeout` 自动发现超时毫秒（默认 `3000`）
- `--pair-code` 6 位配对码（接收端启用时必填）
- `--tls` 使用 TLS 连接
- `--tls-ca` TLS 校验用 CA/证书 PEM（可选）
- `--tls-insecure` 跳过证书校验（测试环境使用）
- `--tls-fingerprint` 服务器证书 SHA-256 指纹（64 位 hex，支持 `:` 分隔）
- `--tls-tofu` 首次连接信任证书指纹，后续固定校验（SSH 风格）
- `--tls-known-hosts` TOFU 指纹存储文件路径（默认 `~/.local-sent/known_hosts.json`）

说明：

- 开启 `--pair-once` 时，同一次 `send`（即使是目录多文件）会自动跟随新码继续传输。
- 开启 `--pair-ttl` 时，接收端会按秒级周期轮换配对码，并在日志中打印新码。
- 仅设置 `--pair-ttl` 时，接收端会自动生成初始 6 位配对码。
- 开启 `--pair-ttl` 时，日志会显示 `valid-for=<N>s` 作为该码有效期提示。
- 下一次独立 `send` 需要使用接收端日志里最新输出的配对码。
- `--tls-fingerprint` 与 `--tls-tofu` 互斥；推荐至少启用其中一个（或提供受信任 `--tls-ca`）。

## TLS 证书快速生成（测试）

```bash
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -sha256 -days 1 -nodes -subj "/CN=local-sent"
```

## 构建

```bash
npm run build
node dist/cli.js --help
```

## 验收测试

```bash
npm run check
```

或分别执行：

```bash
npm run build
npm run test
```

## 全局命令安装（可选）

```bash
npm run build
npm link
local-sent --help
```

## 免 Node 可执行包（跨平台）

构建 Windows/macOS/Linux 可执行文件：

```bash
npm run release
```

产物输出目录：

- `release/local_sent-linux-x64`
- `release/local_sent-macos-x64`
- `release/local_sent-macos-arm64`
- `release/local_sent-win-x64.exe`

仅打当前机器平台（自动映射到 `node20-<platform>-<arch>`）：

```bash
npm run release:current
```

## CI 自动化（GitHub Actions）

工作流文件：

- `.github/workflows/ci.yml`

行为：

- `pull_request`：自动执行 `npm run check`
- `push(main/master)`、`push tag(v*)`、`workflow_dispatch`：
  1. 执行 `npm run check`
  2. 构建并上传四端可执行产物（Linux/macOS x64/macOS arm64/Windows x64）

## Desktop GUI（Tauri 原型）

安装 GUI 依赖：

```bash
npm run desktop:install
```

启动桌面端（开发模式）：

```bash
npm run desktop:dev
```

构建桌面端：

```bash
npm run desktop:build
```

当前原型能力：

- 扫描局域网设备（Discover）
- 启动/停止接收端（Receiver）
- 发送文件或目录（Send）
- 实时查看接收端日志（Receiver Logs）
- 支持中文/英文一键切换（右上角 Language）

## 协议（当前版本）

- 客户端发送：`header`（JSON line，含 `relativePath/fileSize/sha256`，可选 `pairCode`）
- 服务端响应：`ready`（包含 `offset`，用于续传）
- 客户端发送：payload（从 `offset` 处继续）
- 服务端响应：`ack`（JSON line，可带 `nextPairCode`）

## 当前限制

- Desktop GUI 仍是原型，暂未覆盖 CLI 全部高级参数
- 配对码是共享口令，不是强身份认证机制（建议配合 TLS）
- 单连接顺序发送（未做并发分片）
