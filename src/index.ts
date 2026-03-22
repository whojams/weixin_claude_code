import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createMcpServer, setOnLoginSuccess, setPollLoopRunning } from "./mcp-server.js";
import { startPollLoop } from "./poll-loop.js";
import { listIndexedWeixinAccountIds, resolveWeixinAccount } from "./auth/accounts.js";
import { logger } from "./util/logger.js";
import { cleanupTempMedia } from "./media/media-download.js";

async function main() {
  logger.info("weixin-claude-code channel starting...");

  // 清理过期临时文件
  await cleanupTempMedia().catch((err: unknown) =>
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
