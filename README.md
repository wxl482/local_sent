# local-sent

跨平台局域网文件传输工具，包含：

- CLI（TypeScript）：Windows / macOS / Linux
- Desktop GUI（Tauri）：macOS / Windows / Linux

## 功能

- 局域网设备发现（mDNS + UDP 广播兜底）
- 发送单文件或目录（递归）
- 断点续传
- 同名文件自动避让（`file(1).ext`、`file(2).ext`）
- 实时进度与 SHA-256 校验
- 可选 TLS 加密（指纹固定 / TOFU）
- CLI / Desktop 中英双语

## 环境要求

### CLI

- Node.js >= 20（已在 Node 22 验证）
- npm

### Desktop（本地构建）

- Node.js >= 20
- Rust stable + Cargo
- Tauri 构建依赖（Linux 需额外系统库）

## 安装

```bash
npm install
```

## CLI 快速开始

### 1) 启动接收端

```bash
npm run dev -- listen -p 37373 -o ./received -n my-laptop
```

常用参数：

- `-p, --port` 监听端口（默认 `37373`）
- `-o, --output` 接收目录（默认 `./received`）
- `-n, --name` 设备名（默认主机名 `hostname()`）
- `--pair-code` / `--pair-generate` / `--pair-once` / `--pair-ttl`
- `--tls-cert` + `--tls-key`
- `--confirm-each` 每次传输先确认

### 2) 扫描设备

```bash
npm run dev -- discover -t 3000
npm run dev -- discover -t 3000 --json
```

### 3) 发送文件/目录

指定主机：

```bash
npm run dev -- send /path/to/file-or-dir --host 192.168.1.10 --port 37373
```

自动发现并发送（可按名称过滤）：

```bash
npm run dev -- send /path/to/file-or-dir --device my-laptop -t 3000
```

TLS 示例：

```bash
npm run dev -- send /path/to/file --host 192.168.1.10 --port 37373 --tls --tls-insecure
npm run dev -- send /path/to/file --host 192.168.1.10 --port 37373 --tls --tls-fingerprint <SHA256_HEX>
npm run dev -- send /path/to/file --host 192.168.1.10 --port 37373 --tls --tls-tofu
```

### 4) 自检

```bash
npm run dev -- doctor -p 37373 -o ./received -t 3000
npm run dev -- doctor --json
```

### 5) 语言

```bash
npm run dev -- --lang zh --help
npm run dev -- --lang en --help
```

环境变量（优先级低于 `--lang`）：

```bash
LOCAL_SENT_LANG=zh npm run dev -- discover
LOCAL_SENT_LANG=en npm run dev -- discover
```

## 构建与测试

```bash
npm run build
npm run test
npm run check
```

构建后运行：

```bash
node dist/cli.js --help
```

全局命令（可选）：

```bash
npm run build
npm link
local-sent --help
```

## CLI 二进制发布（pkg）

构建四端可执行文件：

```bash
npm run release
```

仅构建当前平台：

```bash
npm run release:current
```

默认产物目录：`release/`

## Desktop GUI（Tauri）

安装 GUI 依赖：

```bash
npm run desktop:install
```

开发运行：

```bash
npm run desktop:dev
```

构建（当前平台）：

```bash
npm run desktop:build
```

macOS DMG（本地 ad-hoc）：

```bash
npm --prefix desktop run tauri:build:dmg
```

## 三平台桌面包（GitHub Actions）

仓库内工作流：

- `.github/workflows/desktop-bundles.yml`

说明：

- 仅手动触发（`workflow_dispatch`）
- 在对应系统 runner 打包：
  - macOS -> `dmg`
  - Windows -> `nsis` + `portable zip`
  - Linux -> `appimage`

## CI 说明

仓库内工作流：

- `.github/workflows/ci.yml`

行为：

- `pull_request`：执行 `npm run check`
- `push(main/master)` / `tag(v*)` / `workflow_dispatch`：
  - 先执行 `npm run check`
  - 再构建并上传 CLI 四端可执行文件

## 常见问题

### 1) `missing bundled CLI binary and dist/cli.js`

先在仓库根目录构建 CLI：

```bash
npm run build
```

再执行 Desktop 打包：

```bash
npm run desktop:build
```

### 2) 本机能否直接打 Windows / Linux 桌面包？

通常不建议跨系统本地打包。最稳定做法是：

- 在目标系统本机打包，或
- 使用 GitHub Actions 的三平台 runner 打包

### 3) 同名文件会不会覆盖？

不会。接收端会自动改名（如 `file(1).ext`），并与续传逻辑兼容。
