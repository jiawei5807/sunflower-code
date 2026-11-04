# 葵花码 · Sunflower Code

将网页链接或二维码图片转换为葵花码。桌面与手机自适应，支持头像、PNG/SVG 下载和图片复制。

> 项目原创代码使用 MIT。协议数据及默认图标的再分发授权尚未确认，已单独列于 [NOTICE](NOTICE)。当前为开源整理版本，请勿将整包描述为全部 MIT 或已完成授权清理。

## 本地运行

需要 Node.js 22+、Python 3.9+（用于文档生成和浏览器测试）。应用无 npm 运行时依赖。

```sh
npm ci
npm run build
npm run dev
```

打开 http://127.0.0.1:5173 。默认不预填用户内容：粘贴网页链接后生成，或上传二维码自动生成。二维码与头像在浏览器本地处理。

## 自动转链

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
scripts/           开发服务器、构建、检查与发布工具
tests/unit/       编码和服务接口测试
tests/browser/    页面、自动转链、二维码完整流程测试
docs/              使用、算法、部署、来源与验收说明
```

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 本地预览，可选服务端转链 |
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
