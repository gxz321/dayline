# 私人 Telegram 助手接入指南

外部 Telegram 通道交付的是可配置后运行的接口和脚本，当前尚未创建机器人或配置 Telegram token、个人白名单，保持关闭。网页内置聊天已位于主导航「助手」，不需要 Telegram；详见 [网页私人助手指南](CHAT.md)。

2026-10-15，经用户明确授权，既有 OpenAI 密钥已作为服务端机密保存到 Dayline 托管站点，并启用仅本人 ChatGPT 登录可用的网页聊天。密钥不在源码或浏览器里。本地短测试在收到 HTTP 响应前连接超时，正式站点的验收浏览器也出现连接中断，尚未取得真实模型回复；不能据此判断密钥、额度或模型权限，也不能声称 GPT 已接通。网页配置不会自动启用外部 Telegram 通道。

## 使用方式

| 你在自己的私人聊天发送 | 行为 |
| --- | --- |
| `/help` 或 `/start` | 免费说明 |
| `/radar` | 固定官方来源雷达前 5 条，显示来源、原始链接和缓存日期 |
| `/leads` | 真实需求线索前 5 条；仍需核验买方、履约范围与付款证据 |
| `/sources` | 雷达来源健康 |
| `/refresh` | 等待现有雷达更新，保留一小时采集冷却 |
| `/ask 你的问题` | 调用 GPT，计入每日请求额度 |
| `/research 研究问题` | 可选付费联网研究，默认关闭 |
| 普通消息、未知命令 | 只显示说明，**不会自动调用 GPT** |

机器人只回复已配置白名单内的原始私人聊天。群、频道、其他用户、其他机器人、guest/business 更新被静默忽略。没有广播、转发、代发给联系人、模型执行任意动作或修改私人日程功能。网页中浏览器本地的日程、预算、收藏不会自动传给模型。

## 接入顺序

1. 在 Telegram 的官方 [@BotFather](https://t.me/BotFather) 创建你自己的机器人。保留 bot token；不要将它写入代码、网址、截图或公开聊天。关闭加入群组能力更符合私人使用场景。
2. 生成独立随机 webhook secret，至少 32 个 URL 安全字符；在本地终端当前进程保存。示例：`node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`。这条命令生成的是本地凭据，请勿把输出粘贴到公开位置。
3. 首次取得自己的 ID：当前进程配置 `TELEGRAM_BOT_TOKEN` 与随机 `TELEGRAM_PAIR_CODE`（16–64 个 URL 安全字符），你自己打开机器人私人聊天，发送 `/start 配对码`。运行 `node scripts/setup-telegram.mjs --ids`，脚本只显示完全匹配这条配对消息的 `chatId` 和 `userId`，不输出其他消息或别人的身份。此步骤仅适用于尚未登记 webhook 的新机器人，不会自动删除现有 webhook。
4. 通过 **原生 Sites 工具**配置下表服务端运行值；本地终端当前进程也配置相同的 Telegram 项。密钥不要放 `.openai/hosting.json`、`src/`、`dist/client/`、命令参数或受跟踪的文件。获取 `OPENAI_API_KEY` 应使用 [OpenAI Developers 插件](plugin://openai-developers@openai-curated-remote)的 `openai-platform-api-key` 流程和它要求的批准；尚未连接时先启用插件，不能把 ChatGPT 订阅登录凭据当作 API key。
5. 发布应用后，在本地当前进程设置 `TELEGRAM_WEBHOOK_URL=https://dayline-gao-2026.oni785065.chatgpt.site/api/telegram/webhook`，明确设置 `TELEGRAM_ENABLED=true` 及个人白名单；再运行 `node scripts/setup-telegram.mjs --set`。脚本只向 Telegram 登记 webhook，不会设置站点运行变量或主动发消息。
6. 运行 `node scripts/setup-telegram.mjs --status` 查看登记与投递错误。**你主动发送 `/help` 并实际收到回复**，才说明私人消息链路可用；再主动发送短 `/ask` 并收到模型回复，才说明 GPT 接通。注册接口返回成功不足以证明链路可用。若 Telegram 报投递失败，应核对站点 HTTPS 可达性、服务端密钥、白名单、是否启用；不要关闭其他账号权限绕过访问问题。

终端输入密钥建议通过 PowerShell 的 `Read-Host -AsSecureString` 或系统凭据界面，再传入当前进程环境，避免写入 shell 历史。退出后清除本次凭据环境；脚本不保存凭据文件。`--delete` 可主动取消 webhook，并保留待处理更新；脚本不会自动执行此操作。

## 服务端配置

| 配置键 | 用途 / 默认值 |
| --- | --- |
| `TELEGRAM_ENABLED` | 默认关闭；只有字面字符串 `true` 才启用 |
| `TELEGRAM_BOT_TOKEN` | BotFather 发给你的机器人 token，服务端密钥 |
| `TELEGRAM_WEBHOOK_SECRET` | 独立随机值，32–256 个 `A–Z a–z 0–9 _ -` 字符；必须与 `setWebhook` 一致 |
| `TELEGRAM_ALLOWED_CHAT_IDS` | 你自己的数字私人 chat ID；逗号分隔，上限 5 个，空配置拒绝运行 |
| `TELEGRAM_ALLOWED_USER_IDS` | 你自己的数字 sender user ID；独立核对白名单，空配置拒绝运行 |
| `OPENAI_API_KEY` | 仅 `/ask` 与 `/research` 需要；没有 key 时免费命令仍能用 |
| `OPENAI_MODEL` | `/ask` 默认 `gpt-6-luna`，也可设已验证兼容的 `gpt-6-sol` |
| `OPENAI_REASONING_EFFORT` | `/ask` 默认 `none`，兼容 `none/low/medium/high/xhigh/max` |
| `TELEGRAM_ALLOW_WEB_SEARCH` | 默认关闭；显式 `true` 才开放 `/research` |
| `OPENAI_SEARCH_MODEL` | `/research` 默认 `gpt-6-sol`；仅接受已经核对工具支持的 Sol 配置 |
| `OPENAI_SEARCH_REASONING_EFFORT` | 默认 `none`，支持同上；模型与 effort 不匹配时不发起收费请求 |
| `TELEGRAM_DAILY_GPT_LIMIT` | 上海日期下每个用户最多 30 次 / 日；可设 0–50 |
| `TELEGRAM_GLOBAL_DAILY_GPT_LIMIT` | 整个机器人最多 30 次 / 日；可设 0–100 |
| `TELEGRAM_DAILY_RESEARCH_LIMIT` | 默认 2 次 / 日；按用户及整个机器人同时限制，可设 0–5 |
| `TELEGRAM_MAX_OUTPUT_TOKENS` | 默认 800，允许 16–1200；包含可见输出与推理 token |

API 密钥与 token 使用运行时环境，代码及生成静态包只有键名，没有凭据。`TELEGRAM_WEBHOOK_URL`、`TELEGRAM_PAIR_CODE` 仅供本地接入脚本使用，不是机器人运行时所需项。

## 可控成本与真实限制

使用原生 `fetch` 调用固定 `https://api.openai.com/v1/responses`，没有自定义代理地址；`store:false`，不链式保存对话，普通问答不附联网工具。问题最多 2000 字符；仅附最多约 3500 字符公开雷达缓存，作为未经信任的资料，而非指令。响应体受字节数与超时限制，Telegram 回复最多 3500 字符，不使用模型给出的地址作为接收者。

每次 GPT 请求发起前原子预留一次额度；超时或 API 报错也保留预留，避免重试造成隐形重复费用。用户 GPT 调用至少间隔 10 秒；所有命令共享一条处理租约。同一时刻新更新遇到繁忙会返回 429，由 Telegram 重试，**不会先确认接收再丢弃提问**。每天请求数与输出上限是调用控制，不等于美元账单硬上限；若调整模型或开启联网，应在 OpenAI 项目账单中设置可接受的限制并查看真实使用量。

`/research` 最多允许一次 built-in 工具调用，使用低搜索上下文与每日独立额度；低上下文不保证固定输入 token 数或固定来源数。只提供有链接的研究资料，仍须验证付费需求，不能把热门程度当作利润。联网工具本身可能收费，即使回答失败仍可能计费。研究默认关闭，有 API 凭据后才可按你的预算主动启用。

入口检查独立 secret header 和私人双白名单，之后先在 R2 持久化 `update_id + chat` 记录，再确认接收。记录只保存 ID、阶段和结果代码，不保存问题、GPT 回答、API key 或 bot token。按 update ID 去重，支持乱序以及 Telegram 在长期无更新后随机编号；不会因消息编号小而自动丢弃。

实现选择 **at-most-once**：同一已接收更新不会再次调用模型或发送回复；发送前先记下 delivery intent。因此进程崩溃、Telegram 发送已成功但响应丢失、或写入失败时可能没有可见回复，系统不会擅自重发，你可以主动发送新问题。它没有声称跨 OpenAI / Telegram / R2 的事务“恰好一次”。

后台任务处理目标在 25 秒内结束，OpenAI 请求最多 18 秒、Telegram 发送最多 5 秒；缓存处理沿用原来的有界采集。`waitUntil` 前已经写入接收记录；没有 `waitUntil` 时同步执行。只有托管环境真实投递测试才能确认具体运行限制与访问情况。R2 记录会累积；以后若加清理，应保留足够去重窗口，并避免删掉尚在处理的记录。本版不自动批量删除记录。

`store:false` 不代表所有服务零留存；Telegram 会保存正常聊天，OpenAI 平台仍适用它的[数据政策](https://developers.openai.com/api/docs/guides/your-data)。私人账号凭据、家庭资产等信息不会自动加入提示词。

## 已核对的官方接口

- [Telegram Bot API](https://core.telegram.org/bots/api)：webhook 与 getUpdates 互斥；非 2xx 投递会重试；secret header、update ID、私人 chat 类型与 sendMessage 限制。
- [OpenAI Responses 文本输出](https://developers.openai.com/api/docs/guides/text)：原始 JSON 输出需遍历 message / output_text 内容，不能假定第一个 output 就是文本。
- [Responses API 存储与迁移](https://developers.openai.com/api/docs/guides/migrate-to-responses)：本适配器显式关闭 Response 保存。
- [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)、[GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol)：当前使用的模型与 reasoning 支持。
- [Web search](https://developers.openai.com/api/docs/guides/tools-web-search)、[API 定价](https://developers.openai.com/api/docs/pricing)：联网上下文、可核查引用及工具调用费用。


## 2026-10-14：提供商选择与验收

默认 `AI_PROVIDER=openai`。`/ask` 使用 OpenAI Responses API；`/research` 显式要求一次联网工具调用，仍受独立额度约束。若所在地区或网络无法访问该服务，请按官方可用条件选择提供商，不修改认证或网络保护。

也可选择 `AI_PROVIDER=dashscope`，配置自己的 `DASHSCOPE_API_KEY`，`DASHSCOPE_MODEL` 默认 `qwen-plus`（支持 qwen-plus、qwen-plus-latest、qwen-flash、qwen-turbo）。`DASHSCOPE_ENDPOINT` 默认 `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`；也接受你账号对应的 `<workspace>.cn-beijing.maas.aliyuncs.com` 同路径。仅接受这些官方 HTTPS 域名，不接受自定义代理、查询参数或跳转。地区、账号和模型权限需按官方文档核对。两家密钥互不替代、互不发送到另一家；通义分支关闭联网研究，不自动转用 GPT。两种提供商共享每日次数、去重和输出上限。

实际完成44项注入响应测试，包括陌生人拒绝、重复事件不重复收费、超时计入额度、提供商密钥隔离和错误端点拒绝。这证明代码行为，不证明真实 Telegram 消息或模型服务已连通。当前 `/api/health` 只报告配置布尔值，不暴露密钥；机器人仍关闭。下一步由你在 BotFather 创建机器人，按上述顺序配置并主动发送 `/help`，再测试 `/ask`。

官方依据：[Telegram Bot API](https://core.telegram.org/bots/api)、[OpenAI 模型说明](https://developers.openai.com/api/docs/models/gpt-6-luna)、[OpenAI 可用国家和地区](https://developers.openai.com/api/docs/supported-countries)、[阿里云 OpenAI 兼容接口](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope)。
