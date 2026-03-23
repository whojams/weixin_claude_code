import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

import { getUpdates } from "./api/api.js";
import { WeixinConfigManager } from "./api/config-cache.js";
import { SESSION_EXPIRED_ERRCODE, pauseSession } from "./api/session-guard.js";
import { getSyncBufFilePath, loadGetUpdatesBuf, saveGetUpdatesBuf } from "./storage/sync-buf.js";
import { bodyFromItemList, setContextToken, isMediaItem } from "./messaging/inbound.js";
import { downloadMediaFromItem } from "./media/media-download.js";
import type { InboundMediaResult } from "./media/media-download.js";
import type { WeixinMessage, MessageItem } from "./api/types.js";
import { MessageItemType } from "./api/types.js";
import { startTyping, stopTyping, setLastInboundAt, setPollLoopRunning, getPendingPermissionRequestId, clearPendingPermissionRequestId } from "./mcp-server.js";
import { logger } from "./util/logger.js";

// 匹配权限审批回复：
// - 不带 ID："y", "yes", "n", "no"（使用缓存的 pending request_id）
// - 带 ID："yes abcde", "no abcde"（[a-km-z] 是 Claude Code 的 ID 字母表，跳过 l）
const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)(?:\s+([a-km-z]{5}))?\s*$/i;

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
          stopTyping(allowedUserId);
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

  stopTyping(allowedUserId);
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

  // 权限审批回复拦截：匹配 "yes" / "no"（可选带 request_id）
  const textBody = bodyFromItemList(msg.item_list);
  const permMatch = PERMISSION_REPLY_RE.exec(textBody);
  if (permMatch) {
    // 优先使用消息中显式提供的 ID，否则使用缓存的 pending ID
    const requestId = permMatch[2]?.toLowerCase() ?? getPendingPermissionRequestId();
    if (requestId) {
      await deps.server.notification({
        method: "notifications/claude/channel/permission" as any,
        params: {
          request_id: requestId,
          behavior: permMatch[1].toLowerCase().startsWith("y") ? "allow" : "deny",
        },
      });
      // notification 成功后再清理，避免发送失败时状态丢失
      clearPendingPermissionRequestId();
      return; // 已处理为权限审批，不作为普通消息转发
    }
    // 没有 pending request_id 且消息中也没有 ID，fall through 作为普通消息
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
