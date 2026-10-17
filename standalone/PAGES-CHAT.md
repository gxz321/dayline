# GitHub Pages 内嵌私人聊天

前端继续使用 `https://gxz321.github.io/dayline/`。Node 24 后端已部署到 Railway，模型密钥只放服务器环境变量。`public/chat-service.json` 指向 `https://private-assistant-production-418e.up.railway.app`，用户在助手中使用私人访问密码登录。

## 部署

仓库包含 `railway.json` 和 `standalone/Dockerfile`，使用一个实例、一个挂载在 `/var/lib/dayline` 的持久卷。Docker 启动时只调整卷根目录所有者，再切换为 node 用户运行；部署健康检查路径为 `/healthz`。容器启动先取得随进程退出自动释放的系统文件锁，只有持锁者可以清理上次崩溃留下的 Node 启动标记，避免持久卷上的旧标记阻止自动恢复。

非敏感环境变量：

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
DATA_DIR=/var/lib/dayline
PUBLIC_ORIGIN=https://实际后端域名
BRIDGE_ORIGIN=https://gxz321.github.io
AUTO_REFRESH=false
CHAT_ENABLED=true
AI_PROVIDER=openai
OPENAI_MODEL=gpt-6-luna
TELEGRAM_ENABLED=false
```

`STANDALONE_PASSWORD_HASH`、`STANDALONE_SESSION_SECRET` 和 `OPENAI_API_KEY` 必须安全配置到服务器，不提交到 GitHub、不放入网页或 VITE_*。站主确认新托管目的地后才能迁移既有密钥。登录值可由 `standalone/setup.mjs` 安全生成，配置缺失时付费模型调用保持关闭。

本次生产连接的 `public/chat-service.json`：

```json
{"schemaVersion":1,"origin":"https://private-assistant-production-418e.up.railway.app"}
```

推送 main 后，Pages 发布流程会自动更新前端。用户在助手中输入私人访问密码，随后在同一页面发送问题。前端使用短期会话令牌，不依赖跨站 Cookie；令牌只保留在页面内存与当前标签的 sessionStorage，不进入日程备份或对话导出。状态检查和登录最多等待 45 秒，以容纳服务唤醒；后端重启后需要重新登录。

## 接口与保护

仅启用 BRIDGE_ORIGIN 指定的一个精确 HTTPS 来源。公开入口仅有 `/bridge/session`、`/bridge/status`、`/bridge/login`、`/bridge/logout` 和 `/bridge/chat`，拒绝任意路径转发、查询参数、伪造身份和不匹配的 CORS 预检。浏览器不能指定服务端用户身份。

登录返回单独的会话令牌；接口不返回模型密钥。退出撤销令牌。每日最多 20 次请求、单次最多 800 输出 token，重复请求不会再次发送；额度与去重记录写入持久卷。后端不保存问题或回复文本。模型错误不会自动重试，以免重复计费。

## 验证界限

2026-10-17：Railway 镜像构建、持久卷挂载与生产健康检查成功。生产 CORS 预检、私人登录、状态检查和退出均通过。仅发送过一条真实短测试：模型服务返回额度或速率限制，接口归类为 provider_limit，没有取得真实模型回复，也未自动重试。当前后台部署成功与模型可回答是两个分别核验的状态；此时不能宣称已验证真实回答。请站主检查 OpenAI 账户的账单和限额后，再手动发送一条问题；无需改网页代码。

本机 77 项桥接与前端契约检查通过，测试中的模型调用全部模拟。另有 47 项静态日程/资料运行时检查通过，Pages 和独立版生产构建通过。实体 iPhone 尚未进行实际验收。

本次使用已有免费/试用额度，没有升级付费套餐。运行上限为单实例、0.5 vCPU、500 MB 内存及 500 MB 持久卷，并启用空闲休眠；平台额度耗尽后服务可能暂停。Railway 额度与 OpenAI 模型账户额度分别管理。

现有 ChatGPT 官网登录会话不是本接口。OpenAI 的开源订阅授权目前面向其文档支持的客户端/自托管场景；面向远程托管网页的准入需要另行确认。这里使用站主此前授权的独立模型接口。
