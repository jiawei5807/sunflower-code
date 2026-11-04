# 参与贡献

开始前阅读 README、NOTICE 和 docs/algorithm.md。

1. 使用 Node.js 22+ 与 Python 3.9+，运行 `npm ci`，复制 `.env.example` 为 `.env.local` 并设置本地初始化密码，然后 `npm run dev`。
2. UI 放在 src/ui，本地二维码识别放在 src/services，编码放在 src/core；鉴权、转链、生成和管理 API 放在 cloudflare。编码器不得作为静态资源下发。
3. 数据库变更新增 migrations 文件，不改写已经应用的迁移；本地 workerd 数据保存在 .wrangler/state。
4. 修改后运行 `npm run check && npm run build:pages && npm test`。交互改动还需按 README 安装浏览器测试依赖，运行 `npm run test:browser`，检查桌面和手机流程。
5. 提交 PR 说明用户场景、最终行为、验证结果和截图。邀请、权限、生成计数或存储变化应覆盖并发与失败情形。

不要提交真实 Token、.env.local、数据库、生成包或含私人链接的截图。新增依赖保留来源和许可证；Miniflare 的 sharp / undici overrides 用于修复已知漏洞，升级时需复查依赖审计和本地运行。

协议修改必须维持行为测试或说明差异；内部回读不能宣称为微信扫码成功。原创贡献按 MIT 提供，NOTICE 中待确认内容的许可不因代码贡献而改变。
