# Dayline 独立网页部署

这是普通网页的 **Node 24 单实例版本**，复用相同的前端和 Worker 业务逻辑。网址可以使用自己的域名；聊天在页面内完成，不需要 ChatGPT 网站登录。静态界面部署成功不代表模型已连接：真正的回答仍需要可用 API 密钥、服务端出站网络和额度。

当前只提供可部署代码；没有替你购买主机、注册域名或开通 Telegram/微信账号。原来的 Sites 网站继续运行，不会自动变成新域名。推荐先使用支持 Node 24 或 Docker、**单实例和持久磁盘**的主机，再绑定 HTTPS 域名。VPS 配 Docker 与 Caddy/Nginx 是兼容路径；此文件存储包不能原样用于 Cloudflare Workers 或 Vercel 无状态函数。

## 本机先运行

1. 在项目根目录安装依赖并构建：`npm install`、`npm run build`。
2. 执行 `node standalone/setup.mjs`。终端隐藏输入两次私人密码，至少 12 字符。脚本只把 scrypt 哈希和随机会话密钥写到被忽略的 `.env.local`，保留已有 API 设置，不输出密码。更改密码后请重启服务使旧会话失效。
3. 在本机 `.env.local` 安全配置 `CHAT_ENABLED=true` 及对应服务的 API 参数；已有 OpenAI 密钥可保留。不要把密钥放进前端或 `VITE_*`。没有配置私人密码或随机会话密钥时，付费接口始终关闭。
4. 执行 `node standalone/server.mjs --env-file=.env.local`，打开 `http://127.0.0.1:3000`。默认只监听本机，不会暴露给局域网。

若需要脚本配置密码，可通过可信的**单行 stdin 管道**运行 `node standalone/setup.mjs --stdin`；不要把明文密码写进命令参数、终端历史、聊天、共享文件或截图。不要直接覆盖你原有的 `.env.local`。

## 正式托管

配置 `NODE_ENV=production`、`HOST=0.0.0.0`、`PORT=3000`、`PUBLIC_ORIGIN=https://你的域名`、`DATA_DIR=/var/lib/dayline` 以及上面的私人登录和 API 机密。`PUBLIC_ORIGIN` 必须是精确 HTTPS origin，不包含路径；反向代理保留该域名的 Host，服务不信任任意 `X-Forwarded-*`。

构建：`docker build -f standalone/Dockerfile -t dayline .`。构建使用固定 pnpm 版本和提交的 lockfile；最终镜像只复制构建产物和三个运行时模块，不复制整个本地目录。启动时通过平台的 secret 管理注入环境变量，挂载 `/var/lib/dayline` 的持久磁盘，只运行一个副本。端口 3000 应仅向 HTTPS 反向代理开放。`standalone/Dockerfile.dockerignore` 只允许所需构建文件进入上下文，排除环境文件、私钥、源码包和本地缓存。

没有域名时，先使用主机提供的 HTTPS 子域名作为 `PUBLIC_ORIGIN`。选择主机前检查它允许访问所选模型的官方 API；代码不能解除网络地域限制。国内访问体验可另行配置百炼/通义的服务端密钥，不能复用 ChatGPT 订阅或 OpenAI 密钥。

### 数据与更新

`DATA_DIR` 保存公共雷达缓存和额度/请求去重元数据；**不保存用户问题或模型回答**。当前个人勾选、日程和对话记录仍在浏览器本地。换域名或换设备前，在旧站导出备份，再由你在新站导入；新域名不能自动读取旧域名的 localStorage。

`AUTO_REFRESH=true` 可在此 Node 进程启动及每四小时更新固定公开来源；默认 false。它不调用付费模型。公开 GET 只读取已有缓存；登录后的同源 POST 才能手动更新。新主机不继承原 Sites 云端定时任务。建议备份持久盘；不要把运行中的同一目录分给第二个进程。

新站首次打开、还没有采集缓存时，会返回符合前端格式的「暂无来源」状态、完整方向和来源名单，不会把空数据误报为网络或格式错误；每个来源会提示登录后更新。关闭自动采集时不会宣称每四小时自动更新。

单进程通过互斥队列实现条件写入和原子替换；主进程在数据目录创建 `.instance.lock`，第二个实例拒绝启动。崩溃后锁会保留：先确认没有 Dayline 进程运行，再手工删除该锁。不要用多副本、PM2 cluster、共享盘多实例；要水平扩容需替换为真正具备条件写入的数据库/对象存储，不能把该适配器当分布式数据库。

### 接口和登录

- `GET /api/health`：部署健康状态。
- `GET /api/session`：`{mode:'standalone', authenticated, configured}`，不返回身份、密码哈希或密钥。
- `POST /api/login`：JSON `{password}`；`POST /api/logout`：JSON `{}`。必须同源，登录有次数和并发限制。
- 会话 Cookie 为 HttpOnly、SameSite=Strict；生产额外 Secure，七天过期，重启服务会清空会话。注销立即撤销当前会话。
- 公开 GET `/api/radar`、`/api/demand` 只读取缓存。登录同源 POST `/api/refresh/radar`、`/api/refresh/demand`，JSON `{}` 才更新。
- `/api/chat` 继续使用原先的请求去重、20 次/日、800 输出 token 保护。网络或模型异常不自动重试，可能已经计费。

任何客户端提交的 `oai-authenticated-user-*` 和 `OAI-Sites-Authorization` 都会剥离；登录成功后，服务器在内部生成固定的单用户身份。不会因为伪造 Sites 头部而得到聊天权限。`/mcp` 不在独立服务器开放。

Telegram webhook 复用原项目代码，但默认关闭，需你自己通过 BotFather 创建机器人及设置全部私有配置；本版本没有代你发送消息。微信小程序需要单独主体/域名白名单与小程序前端，不能把普通网页上传就称为原生小程序。当前最少操作的路径是 Safari 打开 HTTPS 网页后添加到主屏幕。

## 验收边界

零新增运行时依赖，Node 24 标准库承接 HTTP、会话和文件存储。自动测试只用虚构的密钥与模型响应，不读取真实 `.env.local`，不产生 API 费用。Docker 构建与实体 iPhone、正式域名反向代理需要部署后验收；代码级 HTTP 测试不能替代这些环境验收。
