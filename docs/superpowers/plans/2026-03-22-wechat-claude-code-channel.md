# 微信 Claude Code Channel 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 openclaw-weixin 的微信通信层移植为 Claude Code Channel MCP 服务器，实现微信 ↔ Claude Code 双向通信。

**Architecture:** MCP stdio 服务器，声明 `claude/channel` capability。通过 iLink Bot API long-poll 接收微信消息，推送为 MCP notification；通过 MCP reply 工具发送回复。底层通信代码从 vendor 复制并去除 openclaw/plugin-sdk 依赖。

**Tech Stack:** TypeScript, Node.js >= 22, @modelcontextprotocol/sdk, qrcode-terminal, zod, silk-wasm

**Spec:** `docs/superpowers/specs/2026-03-22-wechat-claude-code-channel-design.md`

**Vendor 参考:** `vendor/package/src/` — 原始 openclaw-weixin 源码

---

### Task 1: 项目脚手架

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "weixin-claude-code-channel",
  "version": "0.1.0",
  "description": "WeChat Channel for Claude Code via iLink Bot API",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsc --watch",
    "typecheck": "tsc --noEmit",
    "test": "node --test dist/**/*.test.js"
  },
  "engines": {
    "node": ">=22"
  },
  "dependencies": {
    "qrcode-terminal": "0.12.0",
    "zod": "4.3.6"
  }
}
```

注意：`qrcode-terminal` 和 `zod` 版本与 vendor 的 `package.json` 保持一致。其余依赖通过 pnpm add 安装，使用安装时的最新版本：

```bash
pnpm add @modelcontextprotocol/sdk silk-wasm
pnpm add -D typescript @types/node @types/qrcode-terminal
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "vendor"]
}
```

- [ ] **Step 3: 创建 .gitignore**

```
node_modules/
dist/
*.tgz
```

- [ ] **Step 4: 安装依赖**

Run: `pnpm install && pnpm add @modelcontextprotocol/sdk silk-wasm && pnpm add -D typescript @types/node @types/qrcode-terminal`
Expected: 成功安装所有依赖，生成 node_modules/ 和 pnpm-lock.yaml

- [ ] **Step 5: 提交**

```bash
git add package.json tsconfig.json .gitignore pnpm-lock.yaml
git commit -m "chore: scaffold project with pnpm and dependencies"
```

---

### Task 2: 工具层（util）

从 vendor 复制 `util/random.ts`、`util/redact.ts`，重写 `util/logger.ts` 输出到 stderr。

**Files:**
- Create: `src/util/logger.ts`
- Create: `src/util/random.ts`
- Create: `src/util/redact.ts`

- [ ] **Step 1: 创建 src/util/logger.ts**

重写为 stderr 输出（stdout 是 MCP 协议通道）。

```typescript
type LogLevel = "debug" | "info" | "warn" | "error";

let currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

function log(level: LogLevel, msg: string): void {
  if (!shouldLog(level)) return;
  const ts = new Date().toISOString();
  process.stderr.write(`[${ts}] [${level.toUpperCase()}] ${msg}\n`);
}

export const logger = {
  debug: (msg: string) => log("debug", msg),
  info: (msg: string) => log("info", msg),
  warn: (msg: string) => log("warn", msg),
  error: (msg: string) => log("error", msg),
  setLevel: (level: LogLevel) => { currentLevel = level; },
  withAccount: (accountId: string) => ({
    debug: (msg: string) => log("debug", `[${accountId}] ${msg}`),
    info: (msg: string) => log("info", `[${accountId}] ${msg}`),
    warn: (msg: string) => log("warn", `[${accountId}] ${msg}`),
    error: (msg: string) => log("error", `[${accountId}] ${msg}`),
    getLogFilePath: () => "stderr",
  }),
};

export type Logger = ReturnType<typeof logger.withAccount>;
```

- [ ] **Step 2: 复制 src/util/random.ts**

从 `vendor/package/src/util/random.ts` 直接复制，无需修改。

- [ ] **Step 3: 复制 src/util/redact.ts**

从 `vendor/package/src/util/redact.ts` 直接复制，无需修改。

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add src/util/
git commit -m "feat: add util layer (logger, random, redact)"
```

---

### Task 3: API 类型与底层通信

复制 `api/types.ts`，适配 `api/api.ts`（移除 `loadConfigRouteTag`），适配 `api/config-cache.ts` 和 `api/session-guard.ts`。

**Files:**
- Create: `src/api/types.ts`
- Create: `src/api/api.ts`
- Create: `src/api/config-cache.ts`
- Create: `src/api/session-guard.ts`

- [ ] **Step 1: 复制 src/api/types.ts**

从 `vendor/package/src/api/types.ts` 直接复制，无需修改。

- [ ] **Step 2: 适配 src/api/api.ts**

从 `vendor/package/src/api/api.ts` 复制，做以下修改：
- 移除 `import { loadConfigRouteTag } from "../auth/accounts.js"`
- `buildHeaders` 函数中移除 `loadConfigRouteTag()` 调用，SKRouteTag 相关代码直接删除（MCP Channel 场景不需要路由标签）
- 修正 `import` 路径确保指向新的 `../util/logger.js` 和 `../util/redact.js`

- [ ] **Step 3: 适配 src/api/config-cache.ts**

从 `vendor/package/src/api/config-cache.ts` 复制，修改：
- 移除顶部的 SDK import（该文件只 import 了 `./api.js` 中的 `getConfig`，不依赖 SDK）
- 确认 import 路径正确

实际检查：vendor 版本不依赖 SDK，只需确保 import 路径正确。

- [ ] **Step 4: 适配 src/api/session-guard.ts**

从 `vendor/package/src/api/session-guard.ts` 复制，做以下修改：
- 设计变更：将 `SESSION_PAUSE_DURATION_MS` 改为无限大（不自动恢复），等待用户手动 login
- 新增 `resetSession(accountId)` 函数，供 login 成功后清除暂停状态
- 修正 logger import 路径

```typescript
import { logger } from "../util/logger.js";

export const SESSION_EXPIRED_ERRCODE = -14;

const pausedAccounts = new Set<string>();

export function pauseSession(accountId: string): void {
  pausedAccounts.add(accountId);
  logger.info(`session-guard: paused accountId=${accountId}, waiting for manual re-login`);
}

export function isSessionPaused(accountId: string): boolean {
  return pausedAccounts.has(accountId);
}

export function resetSession(accountId: string): void {
  pausedAccounts.delete(accountId);
  logger.info(`session-guard: reset accountId=${accountId}`);
}

export function assertSessionActive(accountId: string): void {
  if (isSessionPaused(accountId)) {
    throw new Error(`session paused for accountId=${accountId}, please re-login`);
  }
}
```

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 6: 提交**

```bash
git add src/api/
git commit -m "feat: add API layer (types, api, config-cache, session-guard)"
```

---

### Task 4: 存储层（accounts + sync-buf）

适配 `auth/accounts.ts`（新存储路径、自实现 `normalizeAccountId`），适配 `storage/sync-buf.ts`（去除 legacy 兼容）。

**Files:**
- Create: `src/auth/accounts.ts`
- Create: `src/storage/sync-buf.ts`

- [ ] **Step 1: 创建 src/auth/accounts.ts**

从 `vendor/package/src/auth/accounts.ts` 复制，做以下修改：
- 移除所有 `openclaw/plugin-sdk` import（`normalizeAccountId`、`OpenClawConfig`）
- 自行实现 `normalizeAccountId`：将 `@` 和 `.` 替换为 `-`
- 存储路径从 `~/.openclaw/openclaw-weixin/` 改为 `~/.claude/channels/wechat/`
- 移除 `deriveRawAccountId`、`loadLegacyToken`、legacy 兼容回退逻辑
- 移除 `loadConfigRouteTag`（已移入 api.ts 处理）
- 移除 `resolveWeixinAccount` 中对 `OpenClawConfig` 的依赖，改为直接从文件加载
- 移除 `triggerWeixinChannelReload` 空函数
- 常量 `DEFAULT_BASE_URL` 和 `CDN_BASE_URL` 保留

关键函数签名：

```typescript
export const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
export const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";

export function normalizeAccountId(raw: string): string {
  return raw.replace(/[@.]/g, "-");
}

// 存储路径
function resolveWeixinStateDir(): string {
  return path.join(os.homedir(), ".claude", "channels", "wechat");
}

// 保留的函数（签名不变）：
export function listIndexedWeixinAccountIds(): string[]
export function registerWeixinAccountId(accountId: string): void
export function loadWeixinAccount(accountId: string): WeixinAccountData | null
export function saveWeixinAccount(accountId: string, update: {...}): void
export function clearWeixinAccount(accountId: string): void

// 简化版的 resolveAccount（不依赖 OpenClawConfig）：
export type ResolvedWeixinAccount = {
  accountId: string;
  baseUrl: string;
  cdnBaseUrl: string;
  token?: string;
  configured: boolean;
  userId?: string;
};

export function resolveWeixinAccount(accountId: string): ResolvedWeixinAccount {
  const data = loadWeixinAccount(accountId);
  return {
    accountId,
    baseUrl: data?.baseUrl?.trim() || DEFAULT_BASE_URL,
    cdnBaseUrl: CDN_BASE_URL,
    token: data?.token?.trim() || undefined,
    configured: Boolean(data?.token?.trim()),
    userId: data?.userId?.trim() || undefined,
  };
}
```

- [ ] **Step 2: 创建 src/storage/sync-buf.ts**

从 `vendor/package/src/storage/sync-buf.ts` 复制，做以下修改：
- 移除 `import { deriveRawAccountId }` 和 legacy 兼容逻辑
- 存储路径改为 `~/.claude/channels/wechat/sync/`
- 保留 `getSyncBufFilePath`、`loadGetUpdatesBuf`、`saveGetUpdatesBuf`

```typescript
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function resolveSyncDir(): string {
  return path.join(os.homedir(), ".claude", "channels", "wechat", "sync");
}

export function getSyncBufFilePath(accountId: string): string {
  return path.join(resolveSyncDir(), `${accountId}.sync.json`);
}

export function loadGetUpdatesBuf(filePath: string): string | undefined {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as { get_updates_buf?: string };
    if (typeof data.get_updates_buf === "string") {
      return data.get_updates_buf;
    }
  } catch {
    // file not found or invalid
  }
  return undefined;
}

export function saveGetUpdatesBuf(filePath: string, getUpdatesBuf: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ get_updates_buf: getUpdatesBuf }, null, 0), "utf-8");
}
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add src/auth/accounts.ts src/storage/
git commit -m "feat: add storage layer (accounts, sync-buf)"
```

---

### Task 5: 媒体基础 + CDN 层

先创建 `media/mime.ts`（CDN 的 `upload.ts` 依赖它），然后复制所有 CDN 文件，最后创建剩余媒体文件。

**Files:**
- Create: `src/media/mime.ts`
- Create: `src/cdn/aes-ecb.ts`
- Create: `src/cdn/cdn-url.ts`
- Create: `src/cdn/pic-decrypt.ts`
- Create: `src/cdn/cdn-upload.ts`
- Create: `src/cdn/upload.ts`
- Create: `src/media/silk-transcode.ts`
- Create: `src/media/media-download.ts`

- [ ] **Step 1: 复制 src/media/mime.ts**

从 `vendor/package/src/media/mime.ts` 直接复制，无需修改。CDN 层的 `upload.ts` 依赖此文件。

- [ ] **Step 2: 复制 CDN 文件**

从 `vendor/package/src/cdn/` 复制以下文件到 `src/cdn/`：
- `aes-ecb.ts` — 直接复制，无需修改
- `cdn-url.ts` — 直接复制，无需修改
- `pic-decrypt.ts` — 确认 import 路径指向 `./aes-ecb.js`、`./cdn-url.js`、`../util/logger.js`
- `cdn-upload.ts` — 确认 import 路径指向 `./aes-ecb.js`、`./cdn-url.js`、`../util/logger.js`、`../util/redact.js`
- `upload.ts` — 确认 import 路径正确；此文件 import `../api/api.js`、`../api/types.js`、`../media/mime.js`、`../util/random.js`

- [ ] **Step 3: 复制 src/media/silk-transcode.ts**

从 `vendor/package/src/media/silk-transcode.ts` 复制，确认 logger import 路径正确。

- [ ] **Step 4: 适配 src/media/media-download.ts**

从 `vendor/package/src/media/media-download.ts` 复制，做以下修改：
- 移除 `SaveMediaFn` 类型定义（原来依赖 framework 的 `saveMediaBuffer`）
- 将 `saveMedia` 回调替换为本地文件写入
- 新增 `saveTempMedia` 内部函数：写入 `os.tmpdir()/weixin-claude-code/media/inbound/`
- `deps` 参数中移除 `saveMedia`，不再需要外部注入

```typescript
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { MessageItem } from "../api/types.js";
import { MessageItemType } from "../api/types.js";
import { downloadAndDecryptBuffer, downloadPlainCdnBuffer } from "../cdn/pic-decrypt.js";
import { silkToWav } from "./silk-transcode.js";
import { getMimeFromFilename, getExtensionFromMime } from "./mime.js";
import { logger } from "../util/logger.js";
import { tempFileName } from "../util/random.js";

const WEIXIN_MEDIA_MAX_BYTES = 100 * 1024 * 1024;
const INBOUND_MEDIA_DIR = path.join(os.tmpdir(), "weixin-claude-code", "media", "inbound");

export type InboundMediaResult = {
  decryptedPicPath?: string;
  decryptedVoicePath?: string;
  voiceMediaType?: string;
  decryptedFilePath?: string;
  fileMediaType?: string;
  decryptedVideoPath?: string;
};

async function saveTempMedia(
  buf: Buffer,
  contentType: string | undefined,
  originalFilename?: string,
): Promise<{ path: string }> {
  if (buf.length > WEIXIN_MEDIA_MAX_BYTES) {
    throw new Error(`media too large: ${buf.length} bytes (max ${WEIXIN_MEDIA_MAX_BYTES})`);
  }
  await fs.mkdir(INBOUND_MEDIA_DIR, { recursive: true });
  const ext = originalFilename
    ? path.extname(originalFilename)
    : contentType
      ? getExtensionFromMime(contentType)
      : ".bin";
  const name = tempFileName("wx-inbound", ext);
  const filePath = path.join(INBOUND_MEDIA_DIR, name);
  await fs.writeFile(filePath, buf);
  return { path: filePath };
}

// downloadMediaFromItem：从 vendor 复制完整逻辑
// 关键变更：参数类型从推断类型改为 MessageItem，移除 saveMedia 依赖
// vendor 中 `await saveMedia(buf, contentType, "inbound", MAX_BYTES, filename)` 替换为：
//   `await saveTempMedia(buf, contentType, filename)`
// 完整函数体从 vendor/package/src/media/media-download.ts 第 27-141 行复制，
// 逐个 saveMedia 调用替换如下：
//
//   IMAGE:  saveMedia(buf, undefined, "inbound", MAX)         → saveTempMedia(buf, undefined)
//   VOICE(wav):  saveMedia(wavBuf, "audio/wav", "inbound", MAX) → saveTempMedia(wavBuf, "audio/wav")
//   VOICE(silk): saveMedia(silkBuf, "audio/silk", "inbound", MAX) → saveTempMedia(silkBuf, "audio/silk")
//   FILE:   saveMedia(buf, mime, "inbound", MAX, fileName)    → saveTempMedia(buf, mime, fileName)
//   VIDEO:  saveMedia(buf, "video/mp4", "inbound", MAX)       → saveTempMedia(buf, "video/mp4")
export async function downloadMediaFromItem(
  item: MessageItem,
  deps: {
    cdnBaseUrl: string;
    log: (msg: string) => void;
    errLog: (msg: string) => void;
    label: string;
  },
): Promise<InboundMediaResult> {
  const { cdnBaseUrl, log, errLog, label } = deps;
  const result: InboundMediaResult = {};

  if (item.type === MessageItemType.IMAGE) {
    const img = item.image_item;
    if (!img?.media?.encrypt_query_param) return result;
    const aesKeyBase64 = img.aeskey
      ? Buffer.from(img.aeskey, "hex").toString("base64")
      : img.media.aes_key;
    try {
      const buf = aesKeyBase64
        ? await downloadAndDecryptBuffer(img.media.encrypt_query_param, aesKeyBase64, cdnBaseUrl, `${label} image`)
        : await downloadPlainCdnBuffer(img.media.encrypt_query_param, cdnBaseUrl, `${label} image-plain`);
      const saved = await saveTempMedia(buf, undefined);
      result.decryptedPicPath = saved.path;
    } catch (err) {
      errLog(`${label} image download failed: ${String(err)}`);
    }
  } else if (item.type === MessageItemType.VOICE) {
    const voice = item.voice_item;
    if (!voice?.media?.encrypt_query_param || !voice.media.aes_key) return result;
    try {
      const silkBuf = await downloadAndDecryptBuffer(voice.media.encrypt_query_param, voice.media.aes_key, cdnBaseUrl, `${label} voice`);
      const wavBuf = await silkToWav(silkBuf);
      if (wavBuf) {
        const saved = await saveTempMedia(wavBuf, "audio/wav");
        result.decryptedVoicePath = saved.path;
        result.voiceMediaType = "audio/wav";
      } else {
        const saved = await saveTempMedia(silkBuf, "audio/silk");
        result.decryptedVoicePath = saved.path;
        result.voiceMediaType = "audio/silk";
      }
    } catch (err) {
      errLog(`${label} voice download failed: ${String(err)}`);
    }
  } else if (item.type === MessageItemType.FILE) {
    const fileItem = item.file_item;
    if (!fileItem?.media?.encrypt_query_param || !fileItem.media.aes_key) return result;
    try {
      const buf = await downloadAndDecryptBuffer(fileItem.media.encrypt_query_param, fileItem.media.aes_key, cdnBaseUrl, `${label} file`);
      const mime = getMimeFromFilename(fileItem.file_name ?? "file.bin");
      const saved = await saveTempMedia(buf, mime, fileItem.file_name ?? undefined);
      result.decryptedFilePath = saved.path;
      result.fileMediaType = mime;
    } catch (err) {
      errLog(`${label} file download failed: ${String(err)}`);
    }
  } else if (item.type === MessageItemType.VIDEO) {
    const videoItem = item.video_item;
    if (!videoItem?.media?.encrypt_query_param || !videoItem.media.aes_key) return result;
    try {
      const buf = await downloadAndDecryptBuffer(videoItem.media.encrypt_query_param, videoItem.media.aes_key, cdnBaseUrl, `${label} video`);
      const saved = await saveTempMedia(buf, "video/mp4");
      result.decryptedVideoPath = saved.path;
    } catch (err) {
      errLog(`${label} video download failed: ${String(err)}`);
    }
  }

  return result;
}
```

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 6: 提交**

```bash
git add src/media/ src/cdn/
git commit -m "feat: add media + CDN layer (mime, silk-transcode, media-download, aes-ecb, cdn-url, pic-decrypt, cdn-upload, upload)"
```

---

### Task 6: 消息层（原 Task 7）（inbound + send + send-media）

适配 `messaging/inbound.ts`（简化，去掉 MsgContext），适配 `messaging/send.ts`（从 openclaw 源码复制 `stripMarkdown` 内联），复制 `messaging/send-media.ts`。

**Files:**
- Create: `src/messaging/inbound.ts`
- Create: `src/messaging/send.ts`
- Create: `src/messaging/send-media.ts`

- [ ] **Step 1: 适配 src/messaging/inbound.ts**

从 `vendor/package/src/messaging/inbound.ts` 复制，做以下修改：
- 移除 `WeixinMsgContext` 类型和 `weixinMessageToMsgContext` 函数（不再需要 OpenClaw 的 MsgContext 格式）
- 保留：`contextTokenStore`（Map）、`setContextToken`、`getContextToken`、`isMediaItem`、`bodyFromItemList`
- 保留 `WeixinInboundMediaOpts` 类型（供 media-download 使用），或重命名为 `InboundMediaResult`（已在 Task 6 定义）
- 新增导出 `bodyFromItemList`（原来是内部函数，现在 poll-loop 需要调用）

```typescript
import { logger } from "../util/logger.js";
import type { MessageItem } from "../api/types.js";
import { MessageItemType } from "../api/types.js";

// context_token 缓存
const contextTokenStore = new Map<string, string>();

export function setContextToken(chatId: string, token: string): void {
  logger.debug(`setContextToken: chatId=${chatId}`);
  contextTokenStore.set(chatId, token);
}

export function getContextToken(chatId: string): string | undefined {
  return contextTokenStore.get(chatId);
}

export function isMediaItem(item: MessageItem): boolean {
  return (
    item.type === MessageItemType.IMAGE ||
    item.type === MessageItemType.VIDEO ||
    item.type === MessageItemType.FILE ||
    item.type === MessageItemType.VOICE
  );
}

// bodyFromItemList: 从 vendor 复制完整逻辑（含引用消息 "[引用: ...]" 格式化）
export function bodyFromItemList(itemList?: MessageItem[]): string {
  // 完整实现见 vendor/package/src/messaging/inbound.ts 第 81-106 行
}
```

- [ ] **Step 2: 适配 src/messaging/send.ts**

从 `vendor/package/src/messaging/send.ts` 复制，做以下修改：
- 移除 `import { stripMarkdown } from "openclaw/plugin-sdk"` 和 `import type { ReplyPayload } from "openclaw/plugin-sdk"`
- 内联 `stripMarkdown` 逻辑到 `markdownToPlainText` 函数末尾：

```typescript
/**
 * 从 openclaw/src/line/markdown-to-line.ts 复制的原始 stripMarkdown 实现。
 * 原代码通过 openclaw/plugin-sdk 导出，此处内联以避免依赖整个 SDK。
 */
function stripMarkdown(text: string): string {
  let result = text;
  result = result.replace(/\*\*(.+?)\*\*/g, "$1");
  result = result.replace(/__(.+?)__/g, "$1");
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1");
  result = result.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "$1");
  result = result.replace(/~~(.+?)~~/g, "$1");
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "$1");
  result = result.replace(/^>\s?(.*)$/gm, "$1");
  result = result.replace(/^[-*_]{3,}$/gm, "");
  result = result.replace(/`([^`]+)`/g, "$1");
  result = result.replace(/\n{3,}/g, "\n\n");
  result = result.trim();
  return result;
}

/**
 * vendor 版 markdownToPlainText 先处理代码围栏/图片/链接/表格，
 * 再调用 stripMarkdown 做最终清理。此处保持相同逻辑。
 */
export function markdownToPlainText(text: string): string {
  let result = text;
  result = result.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code: string) => code.trim());
  result = result.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  result = result.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  result = result.replace(/^\|[\s:|-]+\|$/gm, "");
  result = result.replace(/^\|(.+)\|$/gm, (_, inner: string) =>
    inner.split("|").map((cell) => cell.trim()).join("  "),
  );
  result = stripMarkdown(result);
  return result;
}
```

- 删除 `buildSendMessageReq` 函数（它只是对 `buildTextMessageReq` 的透传包装，且依赖 `ReplyPayload` 类型）
- `sendMessageWeixin` 中将 `buildSendMessageReq(...)` 调用改为直接调用 `buildTextMessageReq({ to, text, contextToken: opts.contextToken, clientId })`
- 移除 `import type { ReplyPayload } from "openclaw/plugin-sdk"` 和 `import { stripMarkdown } from "openclaw/plugin-sdk"`
- 其余函数保持不变：`sendMessageWeixin`、`sendImageMessageWeixin`、`sendVideoMessageWeixin`、`sendFileMessageWeixin`

- [ ] **Step 3: 复制 src/messaging/send-media.ts**

从 `vendor/package/src/messaging/send-media.ts` 直接复制，确认 import 路径正确。

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add src/messaging/
git commit -m "feat: add messaging layer (inbound, send, send-media)"
```

---

### Task 7: 扫码登录

适配 `auth/login-qr.ts`（移除 SDK 依赖，stderr 输出）。

**Files:**
- Create: `src/auth/login-qr.ts`

- [ ] **Step 1: 适配 src/auth/login-qr.ts**

从 `vendor/package/src/auth/login-qr.ts` 复制，做以下修改：
- 移除 `import { loadConfigRouteTag } from "./accounts.js"` — `fetchQRCode` 和 `pollQRStatus` 中的 `SKRouteTag` header 相关代码直接删除
- **将文件中所有 `process.stdout.write(...)` 替换为 `process.stderr.write(...)`**（stdout 是 MCP 协议通道，任何非 MCP 输出都会破坏协议）。需要替换的位置包括：
  - `waitForWeixinLogin` 中的等待点输出 `process.stdout.write(".")`
  - 已扫码提示 `process.stdout.write("\n... 已扫码...\n")`
  - 二维码过期提示 `process.stdout.write("... 二维码已过期...\n")`
  - 新二维码生成提示 `process.stdout.write("... 新二维码已生成...\n")`
  - QR Code URL 输出 `process.stdout.write("QR Code URL: ...\n")`
- `qrcode-terminal` 默认输出到 stdout，`generate` 回调中手动写 stderr：

```typescript
// 在 waitForWeixinLogin 中，替换 qrcode-terminal 输出方式：
const qrterm = await import("qrcode-terminal");
qrterm.default.generate(qrResponse.qrcode_img_content, { small: true }, (qr: string) => {
  process.stderr.write(qr + "\n");
});
```

- 在 `startWeixinLoginWithQr` 中同样处理 `qrcode-terminal` 和 `console.log`，全部重定向到 stderr
- 保留所有导出类型和函数签名：`WeixinQrStartResult`、`WeixinQrWaitResult`、`startWeixinLoginWithQr`、`waitForWeixinLogin`、`DEFAULT_ILINK_BOT_TYPE`

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/auth/login-qr.ts
git commit -m "feat: add QR code login (adapted for MCP stdio)"
```

---

### Task 8: MCP Channel 服务器

全新编写 `mcp-server.ts`，创建 MCP Server 并注册 reply/login/status 工具。

**Files:**
- Create: `src/mcp-server.ts`

- [ ] **Step 1: 创建 src/mcp-server.ts**

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { getContextToken } from "./messaging/inbound.js";
import { markdownToPlainText, sendMessageWeixin } from "./messaging/send.js";
import { sendWeixinMediaFile } from "./messaging/send-media.js";
import { resolveWeixinAccount, listIndexedWeixinAccountIds } from "./auth/accounts.js";
import { startWeixinLoginWithQr, waitForWeixinLogin, DEFAULT_ILINK_BOT_TYPE } from "./auth/login-qr.js";
import { saveWeixinAccount, registerWeixinAccountId, normalizeAccountId } from "./auth/accounts.js";
import { resetSession, isSessionPaused } from "./api/session-guard.js";
import { sendTyping } from "./api/api.js";
import { TypingStatus } from "./api/types.js";
import { logger } from "./util/logger.js";

// typing 状态管理
type TypingState = {
  timer: NodeJS.Timeout;
  baseUrl: string;
  token?: string;
  typingTicket: string;
};
const typingStates = new Map<string, TypingState>();

export function startTyping(chatId: string, baseUrl: string, token?: string, typingTicket?: string): void {
  stopTyping(chatId);
  if (!typingTicket) return;

  const doTyping = () => {
    sendTyping({
      baseUrl, token,
      body: { ilink_user_id: chatId, typing_ticket: typingTicket, status: TypingStatus.TYPING },
    }).catch((err) => logger.warn(`typing send error: ${String(err)}`));
  };

  doTyping();
  const timer = setInterval(doTyping, 5000);
  typingStates.set(chatId, { timer, baseUrl, token, typingTicket });
}

export function stopTyping(chatId: string): void {
  const state = typingStates.get(chatId);
  if (state) {
    clearInterval(state.timer);
    typingStates.delete(chatId);
    // 向微信发送取消 typing 状态
    sendTyping({
      baseUrl: state.baseUrl, token: state.token,
      body: { ilink_user_id: chatId, typing_ticket: state.typingTicket, status: TypingStatus.CANCEL },
    }).catch((err) => logger.warn(`typing cancel error: ${String(err)}`));
  }
}

// 上次入站消息时间
let lastInboundAt: number | undefined;
export function setLastInboundAt(ts: number): void { lastInboundAt = ts; }

// 状态
let pollLoopRunning = false;
export function setPollLoopRunning(running: boolean): void { pollLoopRunning = running; }

// 登录后的回调
let onLoginSuccess: ((accountId: string) => void) | undefined;
export function setOnLoginSuccess(cb: (accountId: string) => void): void { onLoginSuccess = cb; }

export function createMcpServer(): Server {
  const server = new Server(
    { name: "wechat", version: "0.1.0" },
    {
      capabilities: {
        experimental: { "claude/channel": {} },
        tools: {},
      },
      instructions:
        '微信消息以 <channel source="wechat" chat_id="..." sender="..."> 格式到达。文本内容在标签体内，媒体附件通过 media_path 属性指向本地临时文件。用 reply 工具回复，传入 chat_id。如需发送文件，设置 media_path 为本地文件绝对路径。',
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "reply",
        description: "回复微信消息",
        inputSchema: {
          type: "object" as const,
          properties: {
            chat_id: { type: "string", description: "目标用户 ID（从 <channel> 标签的 chat_id 属性获取）" },
            text: { type: "string", description: "回复文本内容" },
            media_path: { type: "string", description: "可选，本地文件绝对路径（图片/视频/文件）" },
          },
          required: ["chat_id", "text"],
        },
      },
      {
        name: "login",
        description: "发起微信扫码登录，返回二维码 URL",
        inputSchema: { type: "object" as const, properties: {} },
      },
      {
        name: "status",
        description: "查询当前微信连接状态",
        inputSchema: { type: "object" as const, properties: {} },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name } = req.params;
    const args = req.params.arguments as Record<string, string> | undefined;

    if (name === "reply") {
      return handleReply(args ?? {});
    }
    if (name === "login") {
      return handleLogin();
    }
    if (name === "status") {
      return handleStatus();
    }
    throw new Error(`unknown tool: ${name}`);
  });

  return server;
}

async function handleReply(args: Record<string, string>) {
  const chatId = args.chat_id;
  const text = args.text;
  const mediaPath = args.media_path;

  if (!chatId || !text) {
    return { content: [{ type: "text" as const, text: "缺少 chat_id 或 text 参数" }] };
  }

  const contextToken = getContextToken(chatId);
  if (!contextToken) {
    return { content: [{ type: "text" as const, text: "未收到过该用户的消息，无法回复（缺少 context_token）" }] };
  }

  // 取消 typing
  stopTyping(chatId);

  // 查找 account
  const accountIds = listIndexedWeixinAccountIds();
  if (accountIds.length === 0) {
    return { content: [{ type: "text" as const, text: "未登录微信账号" }] };
  }
  const account = resolveWeixinAccount(accountIds[0]);

  const plainText = markdownToPlainText(text);

  try {
    if (mediaPath) {
      await sendWeixinMediaFile({
        filePath: mediaPath,
        to: chatId,
        text: plainText,
        opts: { baseUrl: account.baseUrl, token: account.token, contextToken },
        cdnBaseUrl: account.cdnBaseUrl,
      });
    } else {
      await sendMessageWeixin({
        to: chatId,
        text: plainText,
        opts: { baseUrl: account.baseUrl, token: account.token, contextToken },
      });
    }
    return { content: [{ type: "text" as const, text: "已发送" }] };
  } catch (err) {
    logger.error(`reply failed: ${String(err)}`);
    return { content: [{ type: "text" as const, text: `发送失败: ${String(err)}` }] };
  }
}

async function handleLogin() {
  const accountIds = listIndexedWeixinAccountIds();
  const existingId = accountIds[0];
  const account = existingId ? resolveWeixinAccount(existingId) : null;
  const apiBaseUrl = account?.baseUrl || "https://ilinkai.weixin.qq.com";

  const startResult = await startWeixinLoginWithQr({
    apiBaseUrl,
    botType: DEFAULT_ILINK_BOT_TYPE,
  });

  if (!startResult.qrcodeUrl) {
    return { content: [{ type: "text" as const, text: `登录失败: ${startResult.message}` }] };
  }

  // 后台轮询扫码状态
  (async () => {
    const waitResult = await waitForWeixinLogin({
      sessionKey: startResult.sessionKey,
      apiBaseUrl,
      timeoutMs: 480_000,
    });

    if (waitResult.connected && waitResult.botToken && waitResult.accountId) {
      const normalizedId = normalizeAccountId(waitResult.accountId);
      saveWeixinAccount(normalizedId, {
        token: waitResult.botToken,
        baseUrl: waitResult.baseUrl,
        userId: waitResult.userId,
      });
      registerWeixinAccountId(normalizedId);
      resetSession(normalizedId);
      logger.info(`login success: accountId=${normalizedId}`);
      onLoginSuccess?.(normalizedId);
    } else {
      logger.warn(`login failed: ${waitResult.message}`);
    }
  })();

  return {
    content: [{
      type: "text" as const,
      text: `请用微信扫描二维码登录:\n${startResult.qrcodeUrl}\n\n${startResult.message}`,
    }],
  };
}

async function handleStatus() {
  const accountIds = listIndexedWeixinAccountIds();
  if (accountIds.length === 0) {
    return { content: [{ type: "text" as const, text: JSON.stringify({ connected: false }) }] };
  }
  const account = resolveWeixinAccount(accountIds[0]);
  const paused = isSessionPaused(account.accountId);
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        connected: account.configured && !paused && pollLoopRunning,
        accountId: account.accountId,
        userId: account.userId,
        lastInboundAt,
        sessionPaused: paused,
      }),
    }],
  };
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/mcp-server.ts
git commit -m "feat: add MCP Channel server with reply/login/status tools"
```

---

### Task 9: Long-poll 循环

全新编写 `poll-loop.ts`，基于 vendor `monitor.ts` 简化。

**Files:**
- Create: `src/poll-loop.ts`

- [ ] **Step 1: 创建 src/poll-loop.ts**

```typescript
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

import { getUpdates } from "./api/api.js";
import { WeixinConfigManager } from "./api/config-cache.js";
import { SESSION_EXPIRED_ERRCODE, pauseSession, isSessionPaused } from "./api/session-guard.js";
import { getSyncBufFilePath, loadGetUpdatesBuf, saveGetUpdatesBuf } from "./storage/sync-buf.js";
import { bodyFromItemList, setContextToken, isMediaItem } from "./messaging/inbound.js";
import { downloadMediaFromItem } from "./media/media-download.js";
import type { InboundMediaResult } from "./media/media-download.js";
import type { WeixinMessage, MessageItem } from "./api/types.js";
import { MessageItemType } from "./api/types.js";
import { startTyping, stopTyping, setLastInboundAt, setPollLoopRunning } from "./mcp-server.js";
import { logger } from "./util/logger.js";
import { sendTyping } from "./api/api.js";
import { TypingStatus } from "./api/types.js";

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const BACKOFF_DELAY_MS = 30_000;
const RETRY_DELAY_MS = 2_000;

export type PollLoopOpts = {
  server: Server;
  baseUrl: string;
  cdnBaseUrl: string;
  token?: string;
  accountId: string;
  /** 仅接受此 userId 的消息 */
  allowedUserId: string;
  abortSignal?: AbortSignal;
};

export async function startPollLoop(opts: PollLoopOpts): Promise<void> {
  const { server, baseUrl, cdnBaseUrl, token, accountId, allowedUserId, abortSignal } = opts;
  const aLog = logger.withAccount(accountId);

  aLog.info(`poll-loop started: baseUrl=${baseUrl}`);
  setPollLoopRunning(true);

  const syncFilePath = getSyncBufFilePath(accountId);
  let getUpdatesBuf = loadGetUpdatesBuf(syncFilePath) ?? "";
  if (getUpdatesBuf) {
    aLog.info(`resuming from previous sync buf (${getUpdatesBuf.length} bytes)`);
  }

  const configManager = new WeixinConfigManager({ baseUrl, token }, (msg) => aLog.info(msg));
  let nextTimeoutMs = DEFAULT_LONG_POLL_TIMEOUT_MS;
  let consecutiveFailures = 0;

  while (!abortSignal?.aborted) {
    try {
      const resp = await getUpdates({
        baseUrl,
        token,
        get_updates_buf: getUpdatesBuf,
        timeoutMs: nextTimeoutMs,
      });

      if (resp.longpolling_timeout_ms != null && resp.longpolling_timeout_ms > 0) {
        nextTimeoutMs = resp.longpolling_timeout_ms;
      }

      const isApiError =
        (resp.ret !== undefined && resp.ret !== 0) ||
        (resp.errcode !== undefined && resp.errcode !== 0);

      if (isApiError) {
        const isSessionExpired =
          resp.errcode === SESSION_EXPIRED_ERRCODE || resp.ret === SESSION_EXPIRED_ERRCODE;

        if (isSessionExpired) {
          pauseSession(accountId);
          setPollLoopRunning(false);
          aLog.error(`session expired, pausing poll-loop. Please re-login.`);

          // 通知 Claude
          await server.notification({
            method: "notifications/claude/channel",
            params: {
              content: "微信连接已断开（session 过期），请调用 login 工具重新扫码连接。",
              meta: { type: "session_expired" },
            },
          });
          return; // 退出 poll-loop，等待 login 后重新启动
        }

        consecutiveFailures += 1;
        aLog.error(`getUpdates failed: ret=${resp.ret} errcode=${resp.errcode} (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`);
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          consecutiveFailures = 0;
          await sleep(BACKOFF_DELAY_MS, abortSignal);
        } else {
          await sleep(RETRY_DELAY_MS, abortSignal);
        }
        continue;
      }

      consecutiveFailures = 0;

      if (resp.get_updates_buf != null && resp.get_updates_buf !== "") {
        saveGetUpdatesBuf(syncFilePath, resp.get_updates_buf);
        getUpdatesBuf = resp.get_updates_buf;
      }

      const list = resp.msgs ?? [];
      for (const msg of list) {
        await processMessage(msg, {
          server, baseUrl, cdnBaseUrl, token, accountId, allowedUserId, configManager,
        });
      }
    } catch (err) {
      if (abortSignal?.aborted) break;
      consecutiveFailures += 1;
      aLog.error(`getUpdates error: ${String(err)} (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        consecutiveFailures = 0;
        await sleep(BACKOFF_DELAY_MS, abortSignal);
      } else {
        await sleep(RETRY_DELAY_MS, abortSignal);
      }
    }
  }

  setPollLoopRunning(false);
  aLog.info(`poll-loop ended`);
}

async function processMessage(
  msg: WeixinMessage,
  deps: {
    server: Server;
    baseUrl: string;
    cdnBaseUrl: string;
    token?: string;
    accountId: string;
    allowedUserId: string;
    configManager: WeixinConfigManager;
  },
): Promise<void> {
  const fromUserId = msg.from_user_id ?? "";

  // 安全过滤：仅接受登录者自己的消息
  if (fromUserId !== deps.allowedUserId) {
    logger.debug(`dropping message from ${fromUserId} (allowed: ${deps.allowedUserId})`);
    return;
  }

  setLastInboundAt(Date.now());

  // 缓存 context_token
  if (msg.context_token) {
    setContextToken(fromUserId, msg.context_token);
  }

  // 下载媒体
  const mainMediaItem = findMediaItem(msg.item_list);
  const refMediaItem = !mainMediaItem ? findRefMediaItem(msg.item_list) : undefined;
  const mediaItem = mainMediaItem ?? refMediaItem;

  let mediaResult: InboundMediaResult = {};
  if (mediaItem) {
    mediaResult = await downloadMediaFromItem(mediaItem, {
      cdnBaseUrl: deps.cdnBaseUrl,
      log: (m) => logger.info(m),
      errLog: (m) => logger.error(m),
      label: "inbound",
    });
  }

  // typing
  const cachedConfig = await deps.configManager.getForUser(fromUserId, msg.context_token);
  startTyping(fromUserId, deps.baseUrl, deps.token, cachedConfig.typingTicket);

  // 构建 notification
  const textBody = bodyFromItemList(msg.item_list);
  const meta: Record<string, string> = {
    chat_id: fromUserId,
    sender: fromUserId,
  };

  const mediaPath =
    mediaResult.decryptedPicPath ??
    mediaResult.decryptedVideoPath ??
    mediaResult.decryptedFilePath ??
    mediaResult.decryptedVoicePath;
  const mediaType =
    mediaResult.decryptedPicPath ? "image/*" :
    mediaResult.decryptedVideoPath ? "video/mp4" :
    mediaResult.fileMediaType ?? mediaResult.voiceMediaType;

  if (mediaPath) meta.media_path = mediaPath;
  if (mediaType) meta.media_type = mediaType;

  await deps.server.notification({
    method: "notifications/claude/channel",
    params: { content: textBody || "[媒体消息]", meta },
  });
}

function findMediaItem(itemList?: MessageItem[]): MessageItem | undefined {
  return (
    itemList?.find((i) => i.type === MessageItemType.IMAGE && i.image_item?.media?.encrypt_query_param) ??
    itemList?.find((i) => i.type === MessageItemType.VIDEO && i.video_item?.media?.encrypt_query_param) ??
    itemList?.find((i) => i.type === MessageItemType.FILE && i.file_item?.media?.encrypt_query_param) ??
    itemList?.find((i) => i.type === MessageItemType.VOICE && i.voice_item?.media?.encrypt_query_param && !i.voice_item.text)
  );
}

function findRefMediaItem(itemList?: MessageItem[]): MessageItem | undefined {
  const ref = itemList?.find(
    (i) => i.type === MessageItemType.TEXT && i.ref_msg?.message_item && isMediaItem(i.ref_msg.message_item),
  )?.ref_msg?.message_item;
  return ref ?? undefined;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new Error("aborted")); }, { once: true });
  });
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/poll-loop.ts
git commit -m "feat: add poll-loop (getUpdates long-poll with notification push)"
```

---

### Task 10: 入口与集成

全新编写 `index.ts`，串联所有模块。创建 `.mcp.json` 配置。

**Files:**
- Create: `src/index.ts`
- Create: `.mcp.json`

- [ ] **Step 1: 创建 src/index.ts**

```typescript
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createMcpServer, setOnLoginSuccess, setPollLoopRunning } from "./mcp-server.js";
import { startPollLoop } from "./poll-loop.js";
import { listIndexedWeixinAccountIds, resolveWeixinAccount } from "./auth/accounts.js";
import { logger } from "./util/logger.js";
import { cleanupTempMedia } from "./media/media-download.js";

async function main() {
  logger.info("weixin-claude-code channel starting...");

  // 清理过期临时文件
  await cleanupTempMedia().catch((err) =>
    logger.warn(`temp cleanup failed: ${String(err)}`),
  );

  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("MCP server connected via stdio");

  const abortController = new AbortController();

  // 启动 poll-loop 的函数
  function launchPollLoop(accountId: string) {
    const account = resolveWeixinAccount(accountId);
    if (!account.configured) {
      logger.warn(`account ${accountId} not configured, skipping poll-loop`);
      return;
    }
    if (!account.userId) {
      logger.warn(`account ${accountId} has no userId, skipping poll-loop`);
      return;
    }
    startPollLoop({
      server,
      baseUrl: account.baseUrl,
      cdnBaseUrl: account.cdnBaseUrl,
      token: account.token,
      accountId: account.accountId,
      allowedUserId: account.userId,
      abortSignal: abortController.signal,
    }).catch((err) => {
      if (!abortController.signal.aborted) {
        logger.error(`poll-loop crashed: ${String(err)}`);
        setPollLoopRunning(false);
      }
    });
  }

  // 登录成功后的回调
  setOnLoginSuccess((accountId) => {
    logger.info(`login success callback, launching poll-loop for ${accountId}`);
    launchPollLoop(accountId);
  });

  // 检查已有凭证
  const accountIds = listIndexedWeixinAccountIds();
  if (accountIds.length > 0) {
    logger.info(`found existing account: ${accountIds[0]}, launching poll-loop`);
    launchPollLoop(accountIds[0]);
  } else {
    logger.info("no accounts found, sending login prompt notification");
    // 延迟发送，确保 MCP 连接就绪
    setTimeout(async () => {
      try {
        await server.notification({
          method: "notifications/claude/channel",
          params: {
            content: "微信 Channel 已启动，但尚未登录。请调用 login 工具扫码连接微信。",
            meta: { type: "login_required" },
          },
        });
      } catch (err) {
        logger.warn(`failed to send login prompt: ${String(err)}`);
      }
    }, 1000);
  }

  // 优雅退出
  process.on("SIGINT", () => {
    logger.info("received SIGINT, shutting down...");
    abortController.abort();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    logger.info("received SIGTERM, shutting down...");
    abortController.abort();
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error(`fatal: ${String(err)}`);
  process.exit(1);
});
```

- [ ] **Step 2: 在 media-download.ts 中新增 cleanupTempMedia 函数**

在 `src/media/media-download.ts` 末尾添加：

```typescript
/** 清理超过 24 小时的临时媒体文件 */
export async function cleanupTempMedia(): Promise<void> {
  const dirs = [
    path.join(os.tmpdir(), "weixin-claude-code", "media", "inbound"),
    path.join(os.tmpdir(), "weixin-claude-code", "media", "outbound"),
  ];
  const maxAge = 24 * 60 * 60 * 1000;
  const now = Date.now();

  for (const dir of dirs) {
    try {
      const entries = await fs.readdir(dir);
      for (const entry of entries) {
        const filePath = path.join(dir, entry);
        const stat = await fs.stat(filePath);
        if (now - stat.mtimeMs > maxAge) {
          await fs.unlink(filePath);
          logger.debug(`cleaned up temp file: ${filePath}`);
        }
      }
    } catch {
      // 目录不存在或无权限，跳过
    }
  }
}
```

- [ ] **Step 3: 创建 .mcp.json**

```json
{
  "mcpServers": {
    "wechat": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "."
    }
  }
}
```

- [ ] **Step 4: 构建并检查**

Run: `npm run build`
Expected: 编译成功，dist/ 目录生成

- [ ] **Step 5: 提交**

```bash
git add src/index.ts src/media/media-download.ts .mcp.json
git commit -m "feat: add entry point and MCP config, complete channel implementation"
```

---

### Task 11: 编译修复与冒烟测试

修复所有编译错误，进行基本的冒烟测试。

**Files:**
- Modify: 可能需要修复多个文件的 import 路径和类型问题

- [ ] **Step 1: 完整编译**

Run: `npm run build`

如果有编译错误，逐一修复。常见问题：
- `.js` 后缀缺失（ESM 模块需要 `.js` 后缀）
- 类型不匹配（vendor 代码中某些可选字段）
- import 路径不正确

- [ ] **Step 2: 冒烟测试 — 启动服务器**

Run: `echo '{}' | node dist/index.js 2>stderr.log`

Expected: 进程启动后通过 stderr 输出日志（`weixin-claude-code channel starting...`），因为 stdin 不是有效的 MCP 握手所以会退出。检查 `stderr.log` 确认没有 import 错误。

- [ ] **Step 3: 修复发现的问题**

如果冒烟测试发现问题，逐一修复并重新编译。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "fix: resolve compilation errors and verify smoke test"
```
