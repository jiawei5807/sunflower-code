# 葵花码 · Sunflower Code

将网页链接或二维码图片转换为葵花码。桌面与手机自适应，支持头像、PNG/SVG 下载和图片复制。

> 项目原创代码使用 MIT。协议数据及默认图标的再分发授权尚未确认，已单独列于 [NOTICE](NOTICE)。当前为开源整理版本，请勿将整包描述为全部 MIT 或已完成授权清理。

## 部署到 Cloudflare Pages（推荐）

公开版使用静态托管。长网址由访客浏览器直接提交至 da.gd，无需配置转链密钥。

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

构建完成后从 Pages 地址打开站点，用一个超容量的公开网址试生成。浏览器会向 `https://da.gd/s` 发送表单，容量内的网址直接本地生成。现有项目可继续使用 `npm run build:pages` 和 `dist`，更新后无需创建 Functions 或设置机密。

## 本地运行

需要 Node.js 22+、Python 3.9+（用于文档生成和浏览器测试）。应用无 npm 运行时依赖。

```sh
npm ci
npm run build
npm run dev
```

打开 http://127.0.0.1:5173 。默认不预填用户内容：粘贴网页链接后生成，或上传二维码自动生成。二维码与头像在浏览器本地处理。

## 项目结构

```text
src/core/          编码、回读、SVG 绘制与兼容数据
src/services/      二维码识别与短链客户端
src/ui/            页面状态和交互
src/styles/        响应式页面与文档样式
public/vendor/     固定版本的 jsQR 与许可证
scripts/           开发服务器、构建、检查与发布工具
tests/unit/       编码和服务接口测试
tests/browser/    页面、自动转链、二维码完整流程测试
docs/              使用、算法、部署、来源与验收说明
```

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 本地预览 |
| `npm run build:pages` | 生成 Cloudflare Pages 静态部署目录 |
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
- 本地生成，超容量时通过 da.gd 自动转链；不使用短链时无需联网 API。
- 内部回读检查不替代微信实机验证，国内网络可达性也需要实际测试。
- 不解析微信专用小程序码、Wi-Fi 二维码或普通文字。

[使用说明](docs/usage.md) · [算法说明](docs/algorithm.md) · [来源说明](docs/provenance.md) · [参与贡献](CONTRIBUTING.md) · [安全说明](SECURITY.md)
