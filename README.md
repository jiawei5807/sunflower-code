# 葵花码 · Sunflower Code

将网页链接或二维码图片转换为葵花码。桌面与手机自适应，支持头像、PNG/SVG 下载和图片复制。

> 项目原创代码使用 MIT。协议数据及默认图标的再分发授权尚未确认，已单独列于 [NOTICE](NOTICE)。当前为开源整理版本，请勿将整包描述为全部 MIT 或已完成授权清理。

## 部署到 Cloudflare Pages（推荐）

此方式由 Pages Functions 在服务端调用 Ace Data。**你在 Cloudflare 配置一次密钥，访客无需填写 Token，网页源码也不会包含密钥。**

### 1. 连接仓库并设置构建

在 Cloudflare 控制台进入 **Workers & Pages → 创建应用 → Pages → 连接 Git 仓库**，选择 `jiawei5807/sunflower-code`。已有 Pages 项目则进入该项目的构建设置修改：

| 配置项 | 填写内容 |
| --- | --- |
| 生产分支 | `main` |
| 框架预设 | `None`（无） |
| 构建命令 | `npm run build:pages` |
| 构建输出目录 | `dist` |
| 根目录 | 留空，使用仓库根目录 |
| Node.js 版本 | `22`，可通过构建变量 `NODE_VERSION=22` 指定 |

构建还需 `python3` 生成说明页面，使用 Cloudflare Pages 当前构建镜像即可；本地构建需自行安装 Python 3.9+。

**必须使用 `build:pages`，不要使用普通的 `build`。** 它会在 dist 中生成 `_worker.js`（Pages Functions 高级模式）和 `_routes.json`，自动接入 `/api/shorten`。无需另建 Worker、数据库或手改 config.js，也无需在“绑定”中添加存储或服务。

### 2. 配置一次服务端密钥

进入 **Pages 项目 → Settings（设置）→ Variables and Secrets（变量与机密）**，选择 **Production（生产环境）**，添加：

| 类型 | 名称 | 值 |
| --- | --- | --- |
| Secret（机密 / 加密变量） | `ACEDATA_TOKEN` | 你的 Ace Data Token 本体，不加 `Bearer ` 前缀 |

这是 **Pages Functions 运行时机密**，不是写入源码的前端变量。无需设置 `HOST`、`PORT`、`PUBLIC_ORIGIN`，无需把 `.env.local` 上传。

如果需要分支预览地址也能自动转链，在 **Preview（预览环境）** 中另配同名机密。只配置生产环境不会自动配置预览环境。

### 3. 保存后重新部署

保存变量后，在 **Deployments（部署）** 中重新部署最新提交，让新的机密绑定生效。之后从项目的 `*.pages.dev` 地址或绑定的自定义域名访问。

已经用 `npm run build` 部署过的项目，也要将构建命令改成 `npm run build:pages` 后重新部署。不要只添加变量而不更换构建命令。

### 4. 验证部署

- 短网址可直接生成；足够长的网址会自动转链并生成葵花码。
- “高级设置”中不再显示要求访客填写 Token 的入口。
- 浏览器请求应发往本站 `/api/shorten`，不会直接向 Ace Data 发送密钥。
- 打开本站 `/config.js` 应看到 `shortenEndpoint: "/api/shorten"`，不应看到任何 Token。

| 问题 | 检查方法 |
| --- | --- |
| 仍要求填写 Token | 确认构建命令为 `npm run build:pages`，最新部署成功，刷新页面；检查 /config.js。 |
| 转链返回 503 | 对应生产 / 预览环境未配置 `ACEDATA_TOKEN`，或修改后未重新部署。 |
| 转链返回 401 / 403 | 检查 Token 是否有效、账号权限以及是否误加 `Bearer ` 前缀；403 也可能是请求来源不匹配。 |
| 转链返回 402 | 检查 Ace Data 余额或额度。 |
| 转链返回 429 | 等待后重试，检查服务商限流和站点流量。 |
| 转链返回 502 | 上游网络、超时或响应异常；在 Functions 日志检查状态后重试。 |

公开访客使用的是站点账号的转链额度。函数有基础限流，但不是跨节点全局额度控制；需要严格保护额度时配置 Cloudflare 限流或访问控制。二维码图片和头像仍只在浏览器本地处理。

## 本地运行

需要 Node.js 22+、Python 3.9+（用于文档生成和浏览器测试）。应用无 npm 运行时依赖。

```sh
npm ci
npm run build
npm run dev
```

打开 http://127.0.0.1:5173 。默认不预填用户内容：粘贴网页链接后生成，或上传二维码自动生成。二维码与头像在浏览器本地处理。

## 本地开发的自动转链

容量内链接无需配置。需要超长链接自动转链时，在项目根目录创建 `.env.local`（已被 Git 忽略）：

```sh
cp .env.example .env.local
```

填写 `ACEDATA_TOKEN` 后重启开发服务。密钥只由服务端读取，不下发到浏览器、dist 或发布包。纯静态部署可在页面“自动转链”中填写个人 Token，仅在当前页面内存中使用。

不要提交真实 Token。公开托管需配置自身访问控制和服务额度；部署方式见 [部署说明](docs/deployment.md)。

## 项目结构

```text
src/core/          编码、回读、SVG 绘制与兼容数据
src/services/      二维码识别与短链客户端
src/ui/            页面状态和交互
src/styles/        响应式页面与文档样式
public/vendor/     固定版本的 jsQR 与许可证
cloudflare/        Pages Functions 服务端转链接口
scripts/           开发服务器、构建、检查与发布工具
tests/unit/       编码和服务接口测试
tests/browser/    页面、自动转链、二维码完整流程测试
docs/              使用、算法、部署、来源与验收说明
```

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 本地预览，可选服务端转链 |
| `npm run build:pages` | 生成带 Pages Functions 的 Cloudflare Pages 部署目录 |
| `npm run build` | 生成文档和可静态部署的 dist/ |
| `npm test` | 编码与服务接口测试 |
| `npm run check` | JavaScript 语法与常见密钥模式检查 |
| `npm run test:browser` | 启动隔离服务，运行浏览器完整流程 |
| `npm run release` | 检查、测试、构建并生成白名单源码包目录 |

浏览器测试首次运行前：

```sh
python3 -m pip install -r tests/requirements.txt
python3 -m playwright install chromium
npm run test:browser
```

`release/sunflower-code/` 不包含 `.env.local`、历史实验、私人数据或 Git 历史。执行发布命令不代表第三方授权已经确认。

## 能力与边界

- HTTP/HTTPS 网页链接，36 / 54 / 72 条射线，L/M/Q/H 纠错。
- 上传、拖放、粘贴普通二维码；PNG/JPEG/WebP，最大 10 MB。
- 本地生成，超容量时可选 Ace Data 转链；不使用短链时无需联网 API。
- 内部回读检查不替代微信实机验证，国内网络可达性也需要实际测试。
- 不解析微信专用小程序码、Wi-Fi 二维码或普通文字。

[使用说明](docs/usage.md) · [算法说明](docs/algorithm.md) · [来源说明](docs/provenance.md) · [参与贡献](CONTRIBUTING.md) · [安全说明](SECURITY.md)
