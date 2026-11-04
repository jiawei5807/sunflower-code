# 参与贡献

欢迎报告问题和提交改进。开始前请阅读 README、NOTICE 和 docs/algorithm.md。

1. 使用 Node.js 22+ 与 Python 3.9+，运行 `npm ci && npm run build && npm run dev`。
2. UI 逻辑放在 src/ui，识别与网络能力放在 src/services，编码能力放在 src/core。
3. 修改后运行 `npm run check && npm test`；涉及交互时运行 `npm run test:browser`，检查桌面和手机宽度。
4. 提交 PR 时说明用户场景、改变的行为、验证结果和截图。

不要提交真实 Token、.env.local、生成包、截图中的私人链接或未经授权的第三方素材。新增依赖应提供版本、来源和许可证。协议兼容性修改必须维持行为测试或说明差异；不要宣称内部回读即为微信扫码成功。

原创贡献按 MIT 提供。NOTICE 中待确认授权的内容不因贡献而自动改变许可。
