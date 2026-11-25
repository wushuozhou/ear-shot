# Third-Party Notices

这是听屿发布包的权威第三方声明。审计更新至 2026-11-25；下列提交号记录上游许可核验快照，不代表所有本地文件都从该提交导入。Earshot 最初作为本地工作区基线导入，未保留准确的原始上游提交；未来上游许可变更不会自动改变已依法取得版本的许可。

| 名称 | 来源与审计版本 | 许可证 | 本项目使用方式 |
| --- | --- | --- | --- |
| Earshot | [facc33176-rgb/earshot](https://github.com/facc33176-rgb/earshot), `2462f5b4d9baa2d8285f04a84ce16e2f9c7d7b3a` | MIT | `server/`、`web/` 与其功能逻辑的二次开发；完整文本见发布包 `LICENSE` |
| tone.skill | [facc33176-rgb/tone.skill](https://github.com/facc33176-rgb/tone.skill), `e88c99e51cebb4a9a7c5d85cf4362399a3b07210` | MIT | `skills/say-it-like-you-mean-it/` 中的 5 个参考文档，以及 `desktop/skills/tones.json` 的中文预设；完整文本见 `licenses/tone.skill.MIT.txt` |
| Tidemark Anchor Memory | [facc33176-rgb/Tidemark-anchor-memory-](https://github.com/facc33176-rgb/Tidemark-anchor-memory-), `3e087a18073eaaeaec0f8ebfdeae1d38f8de8563` | AGPL-3.0 | 仅提供可选的外部 HTTP 适配（`GET /api/recall`、`POST /api/store`）；本仓库不包含其 Python 服务、算法、数据库或依赖 |
| Three.js r164 | [mrdoob/three.js](https://github.com/mrdoob/three.js) | MIT | `desktop/app/archive/assets/vendor/three.module.js`；文件头保留原声明 |
| qrcode-generator 2.0.4 | [kazuhikoarase/qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator), `2.0.4` | MIT | `desktop/app/archive/assets/js/lib/qrcode-generator.js`；文件头保留原声明 |
| npm / Electron 构建依赖 | `desktop/package-lock.json` | MIT、ISC、BSD、Apache-2.0、BlueOak、Python-2.0、WTFPL、0BSD 等 | 依赖包的许可证以锁文件与其包内声明为准；发布包同时保留 Electron 自带声明 |

## 外部资源边界

ActiveTheory 原站归档场景、压缩运行时、几何、材质、纹理、字体、品牌图形、媒体和原点云来自用户提供的参考项目。当前版本按用户要求保留用于个人自用；它们不因本仓库的 MIT 许可而获得商业授权，也不应被描述为听屿自有资产。`NBArchitektStd` 字体尤其没有在归档中发现授权文件。

通话背景的 `web/backdrop.js` 是本地实现，包含程序生成的点云、极光、雾和水面效果。默认森林资源 `web/assets/spring-forest.bin` 从 ActiveTheory 归档 `forest-1024.bin` 筛选、量化而来，仍是第三方衍生资源，按当前自用范围保留。Shopify Editions Spring ’26 是视觉参考；本次代码审查未发现复制其源码或媒体的证据。

## 许可履行

- 发布源码或安装包时保留根目录 `LICENSE`、本文件和 `licenses/tone.skill.MIT.txt`。
- Three.js 和 qrcode-generator 的完整许可正文见 `licenses/`。归档中的 Basis、Draco、Resonance 解码器缺少可追溯版本及完整随附声明，仍需另行核验，不能把它们视作已清权内容。
- 不把 Tidemark 服务端或其 AGPL 派生代码打进听屿；如果未来分发或修改该服务，需另行履行 AGPL-3.0 与其 `NOTICE` 的要求。
- 本文件是工程资产审计与分发提示，不替代针对具体地区和发行方式的法律意见。
