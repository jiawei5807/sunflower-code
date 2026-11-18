# 部署说明

## Cloudflare Pages 与静态托管

选择生产分支 `main`，构建命令 `npm run build:pages`，输出目录 `dist`。也可以运行 `npm run build`，将同一份静态产物上传至其他托管平台。构建需要 Node.js 22+ 和 Python 3。无需 Functions、数据库或转链密钥。更新部署后可移除旧的 `ACEDATA_TOKEN`。

## 本地预览

运行 `npm run dev`，打开 `http://127.0.0.1:5173`。超长网址由浏览器直接提交至 is.gd，开发服务器只提供静态文件。

## 更新

源文档位于 docs/usage.md、docs/algorithm.md；`npm run build` 自动生成 HTML 和脚本内容摘要，避免缓存旧版本。dist/、release/ 和私人环境配置均不进 Git。

## 内容安全策略

如启用 CSP，允许同源脚本和样式、Blob 与 data 图片，并在 `connect-src` 中允许 `https://is.gd`。

## 发布前

阅读 NOTICE 与 docs/release-checklist.md。当前协议数据、默认图标的授权尚未确认，不能因为构建通过就认定可以完整按 MIT 分发。
