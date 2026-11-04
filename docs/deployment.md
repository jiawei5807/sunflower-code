# 部署说明

## 静态网站

运行 `npm ci && npm run build`，将 dist/ 的完整内容部署至 HTTPS 静态托管服务。GitHub Pages、普通 Web 服务器等均可，支持部署到子路径。

默认不包含公共 Token。容量内链接、图片识别、头像处理和导出都在浏览器完成。超长链接由用户在页面填写个人 Ace Data Token 后直接请求服务商；该 Token 只在当前页内存使用。直接打开 dist/index.html 同样可用，复制图片取决于浏览器权限。

## 服务端保存 Token

`npm run dev` 提供轻量本地服务器和 `/api/shorten`。`.env.local` 配置：

```sh
ACEDATA_TOKEN=填写自己的密钥
HOST=127.0.0.1
PORT=5173
PUBLIC_ORIGIN=
```

服务器只下发是否配置转链的信息，不下发 Token。只接受同源 JSON POST，固定调用 Ace Data，最大请求体 32 KiB，每个连接来源 IP 每分钟最多 30 次请求，上游超时 20 秒。不记录 Token 或请求正文。

公网部署可由 HTTPS 反向代理转发到本地服务，同时设置 `PUBLIC_ORIGIN=https://你的域名`。站点拥有者应增加自己的登录 / 流量限制，避免公共转链额度被滥用。此处的 IP 限流按 TCP 对端计数，不信任 X-Forwarded-For；反向代理后的所有用户会共享这个计数。

也可以自行部署同源 `/api/shorten`，编辑公共 config.js 的 `shortenEndpoint`。请求为 `{ "content": "https://..." }`，成功响应为 `{ "success": true, "data": { "url": "https://surl.id/r/..." } }`。请勿在 config.js 中填写 Token。

## 更新

源文档位于 docs/usage.md、docs/algorithm.md；`npm run build` 自动生成 HTML 和脚本内容摘要，避免缓存旧版本。dist/、release/ 和私人环境配置均不进 Git。

## 内容安全策略

如启用 CSP，静态页面须允许同源脚本和样式、Blob 与 data 图片；个人 Token 直连模式需允许连接 `https://api.acedata.cloud`。服务端模式只需允许同源连接。

## 发布前

阅读 NOTICE 与 docs/release-checklist.md。当前协议数据、默认图标的授权尚未确认，不能因为构建通过就认定可以完整按 MIT 分发。
