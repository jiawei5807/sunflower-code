# 葵花码 · 邀请制工作台

网页链接 / 二维码转葵花码，支持单次邀请注册、账号登录、管理员控制台、生成用量统计和私有图片历史。

当前开发分支：`feature/invite-console`。**不修改 main，也不自动迁移现有生产环境。**

> 原创代码使用 MIT。协议数据、默认中心图标与角标再分发授权仍待确认，详见 [NOTICE](NOTICE)。商业上线前需解决该授权事项。

## 当前功能

- 管理员批量生成一次性邀请链接，支持有效期、备注、撤销和已使用账号查看。
- 注册成功才消耗邀请码；并发注册同一邀请只有一个账号可成功。
- 用户登录后才能使用生成器、转链、图片下载和历史记录；未登录不能调用生成 API。
- 生成核心、保存与计数由 Pages Functions 执行；超长链接由浏览器直接调用 Ace Data。
- Token 仍配置在 Cloudflare，通过登录保护的接口下发，用户无需填写；登录用户可在开发者工具中读取并复用 Token。
- D1 记录成功生成事件；R2 保存包含头像的 SVG 原图。历史中可再次下载 SVG 或由浏览器导出 PNG。
- 管理员可查看任意账号的生成记录、预览和下载图片，支持分页和停用账号。
- 管理员查看账号、累计 / 今日 / 指定日期生成次数、最近登录；停用账号立即撤销所有会话。
- 同一个请求标识重试不重复计数。生成失败不计数，下载、复制、头像与尺寸调整不重复计数。
- 普通用户通过管理员签发的一次性链接重置密码；管理员可启用验证器二次验证和备用恢复码。
- 联系方式由管理员配置；手机后台采用卡片布局，历史记录支持搜索和长链接折叠。
- 天蓝色响应式界面；支持二维码上传、拖放与粘贴，PNG/JPEG/WebP 头像。

## 部署到 Cloudflare Pages

建议先为此分支建**独立预览项目**，使用单独的 D1 和 R2，不连接生产数据。

### 1. 构建设置

| 配置 | 值 |
| --- | --- |
| 仓库分支 | `feature/invite-console` |
| 框架预设 | None |
| 构建命令 | `npm run build:pages` |
| 输出目录 | `dist` |
| 根目录 | 仓库根目录 |
| 构建变量 | `NODE_VERSION=22` |

需要 Python 3.9+ 生成文档。当前版本必须运行 Pages Functions；不支持直接把 HTML 当成免登录静态工具使用。

### 2. 创建 D1 并初始化表

Cloudflare 控制台 → **存储与数据库 → D1 → 创建数据库**，例如 `sunflower-preview`。

新数据库在 Console 中依次执行 [0001_accounts.sql](migrations/0001_accounts.sql) 和 [0002_account_security.sql](migrations/0002_account_security.sql) 的完整内容，或使用 CLI：

```sh
npx wrangler d1 execute sunflower-preview --remote --file=migrations/0001_accounts.sql
npx wrangler d1 execute sunflower-preview --remote --file=migrations/0002_account_security.sql
```

每个脚本只执行一次。`sunflower-preview` 替换成你的实际数据库名称。

**已有邀请制站点升级：只执行 `0002_account_security.sql`，不要重跑 0001。** 先备份 D1，安排短暂维护窗口，执行 0002 后立即部署此版本。迁移期间旧版本的登录可能失败；新版本在迁移前无法正常使用。迁移保留账号、邀请、历史和图片，无需重新创建数据库或 R2。不要把迁移后的数据库交给旧版本代码运行。

### 3. 创建私有 R2 桶

Cloudflare 控制台 → **R2 → 创建存储桶**，例如 `sunflower-images-preview`。

保持私有：**不要开启 r2.dev 公共访问或绑定公开图片域名**。图片由登录用户通过受保护 API 读取。管理员可从账号表点击“查看记录”，查看任意用户的成功生成记录与图片，并下载 PNG/SVG；普通用户只能读取自己的记录。

### 4. 配置 Pages 绑定

Pages 项目 → **设置 → 绑定 → 添加**：

| 类型 | 变量名称（必须一致） | 选择资源 |
| --- | --- | --- |
| D1 数据库 | `DB` | 上一步的 D1 数据库 |
| R2 存储桶 | `IMAGES` | 上一步的私有 R2 桶 |

### 5. 设置变量和机密

Pages 项目 → **设置 → 变量和机密**，为实际部署环境添加：

| 类型 | 名称 | 值 |
| --- | --- | --- |
| 普通变量 | `ADMIN_USERNAME` | 初始管理员账号，例如 `admin`；3～32 位字母、数字或下划线 |
| Secret | `ADMIN_PASSWORD` | 初始管理员密码，12～128 位，使用随机强密码 |
| Secret | `ACEDATA_TOKEN` | Ace Data Token 本体，不加 `Bearer ` 前缀 |
| Secret | `MFA_ENCRYPTION_KEY` | 可选；启用管理员二次验证前必填，64 位十六进制随机值 |

首次使用管理员账号登录时，服务端仅在没有管理员的数据库里创建该账号。后续登录使用数据库里的密码哈希，修改环境变量不会重置已有账号。

**首次登录后立即在页面修改密码，并从 Cloudflare 删除 `ADMIN_PASSWORD` 机密，再重新部署。** 管理员已保存在数据库，不会因此丢失。无需在代码里预置固定密码，也不提供公开的初始化接口。

生产环境与预览环境绑定 / 机密分别配置。不要让不受信任的分支预览共享生产数据或生产机密。无需配置 HOST、PORT、PUBLIC_ORIGIN。

浏览器直连需要 Ace Data 允许跨域请求。Token 不写入源码或浏览器持久存储，但请求过程中对登录用户可见；本站无法限制已复制 Token 的站外调用，请在服务商侧设置额度与权限。

启用二次验证时，在自己的终端运行以下命令，将输出填入 `MFA_ENCRYPTION_KEY` Secret，然后重新部署：

```sh
openssl rand -hex 32
```

此密钥用于加密 D1 中的验证器密钥，不是验证器动态码或 Ace Data Token。**启用后需保留原值，并在站点之外安全备份；不要随意替换或删除。** 未配置不影响普通登录、密码重置、支持配置和历史功能，仅不能绑定验证器。

### 6. 保存并重新部署，然后验收

1. 打开站点应进入登录页，未登录直接访问 `/admin`、`/history` 也不能使用。
2. 管理员登录 → 管理后台 → 生成邀请 → 复制链接。
3. 无痕窗口打开邀请 → 注册 → 登录 → 生成图片。
4. 查看历史记录并再次下载图片；后台账号累计次数应增加 1。
5. 再用同一邀请注册应失败；停用账号后用户重新请求应退回登录。
6. 后台“支持与安全”保存联系方式，退出后点击“联系支持”核对；在用户卡片生成重置链接，验证重置后旧登录失效。
7. 如启用二次验证，在后台绑定验证器、下载备用码并保存到站点以外，再退出验证登录；详细操作见使用说明。

更多说明见 [部署与数据维护](docs/deployment.md)、[使用说明](docs/usage.md)。

## 本地开发

Node.js 22+、Python 3.9+：

```sh
npm ci
cp .env.example .env.local
# 在 .env.local 填写 ADMIN_PASSWORD，按需填写 ACEDATA_TOKEN 和 MFA_ENCRYPTION_KEY
npm run dev
```

打开 http://127.0.0.1:5173 。本地通过 Miniflare/workerd 模拟 D1 和 R2，自动执行未应用的迁移，数据保存在被 Git 忽略的 `.wrangler/state/`。修改代码后重启 `npm run dev`。

## 测试

```sh
npm run check
npm run build:pages
npm test
python3 -m pip install -r tests/requirements.txt
python3 -m playwright install chromium
npm run test:browser
```

测试使用隔离 D1/R2 和模拟短链服务，不写生产库、不消耗真实账号额度。

## 目录

```text
cloudflare/          Pages 入口、认证、生成、管理 API
migrations/          D1 版本化迁移
src/core/            服务端编码与 SVG 绘制，不作为静态资源下发
src/services/        本地二维码识别、浏览器直连转链
src/ui/              生成器、账号、历史和管理界面
src/styles/          页面与控制台样式
public/vendor/       jsQR 与许可证
scripts/             构建、本地运行、测试和发布
tests/integration/   workerd + D1 + R2 流程与权限测试
tests/browser/       真实页面完整流程
docs/                操作、部署、算法与验证边界
```

## 第一版边界

当前不包含支付、套餐、短信、邮件找回、图片分享链接、批量删除或多管理员。成功历史不自动删除。短链继续使用 Ace Data；其访问和有效期取决于第三方服务。

图片以 SVG 原图保存，PNG 按需从历史原图转换，不重复占用 R2。一次成功生成以“服务端 SVG 写入 R2 且 D1 标为成功”为准，即使用户关闭页面也会计数。打开历史、下载与外观修改不计数。用户主动再次点生成是新记录。

D1 与 R2 无跨服务事务；实现了失败补偿和状态隔离，极端中断可能留下不计数的 pending 记录或孤立对象，处理方式见部署文档。邀请码、会话只存哈希；密码使用随机盐 PBKDF2-SHA256，100,000 轮（workerd 原生上限），结合数据库限流；商业上线可进一步接入 Turnstile 和更强身份服务。

[来源与许可](NOTICE) · [安全说明](SECURITY.md) · [贡献指南](CONTRIBUTING.md)
