# 来源与实现范围

参考页面：https://kuihuama.pages.dev/

观察日期：2026-11-04（Asia/Shanghai）。公开脚本：`https://kuihuama.pages.dev/assets/app.e7312bc69d6e.js`。

`src/core/protocol-data.js` 中的 384 个格式字、3 套数据位置和 32 套掩码表，取自参考页面下发的公开客户端脚本，作为兼容性常量单独保存。未把参考脚本直接打包为应用；`codec.js` 的编码、RS 计算、矩阵回读及 SVG 生成使用重新编写的可读实现。`app.js`、HTML、使用说明为本项目实现；当前主界面 CSS 与交互已重新设计，中心及角标沿用参考站图形路径。

编码对照涉及同样的流式进制转换、字母数字或 UTF-8 载荷、RS 分块交织、格式位、掩码评分与数据位置。不是用随机线条模拟葵花码。

默认中心和右下角图案按参考站的路径、颜色、尺寸和位置绘制。头像、射线数据、定位点布局维持相应功能。

来源页面未展示可确认的开源许可证，本项目不对参考数据声明额外的开源许可，也不宣称是微信官方服务。内部矩阵回读不等于目标扫码器的识别验证。

## 二维码识别依赖

`public/vendor/jsQR-1.4.0.js` 为 jsQR 1.4.0 官方 npm 发布包中的 `dist/jsQR.js`，下载后按 npm 发布信息验证 SHA-512 完整性。库使用 Apache-2.0 许可证，随包保留 `public/vendor/jsQR-LICENSE.txt`。项目地址：https://github.com/cozmo/jsQR 。二维码识别包装逻辑位于 `src/services/qr-reader.js`，在浏览器本地执行。

## 开源许可范围

原创代码采用 MIT。协议兼容数据和默认中心/角标没有获得可确认的再分发授权；按维护者选择暂时保留并标记待确认，不纳入 MIT 授权。详见根目录 NOTICE。二维码依赖按其 Apache-2.0 许可证提供。
