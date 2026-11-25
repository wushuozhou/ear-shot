# 听屿商用许可审计

审计范围：当前仓库、桌面安装包中实际包含的 `desktop/app`、归档场景资源、构建依赖和本项目生成资源。

更新日期：2026-11-25。下列提交号是上游许可核验快照，不是全部本地文件的导入提交。Earshot 作为本地基线导入时未记录准确上游提交；未把当前上游版本号冒充原始来源版本。

本轮结论先区分功能代码与参考场景：Earshot 和 tone.skill 的功能/规则来源已核实为 MIT；Tidemark 只以外部 HTTP 适配存在，没有发现其 AGPL 服务端代码被复制进仓库。ActiveTheory 归档场景按用户要求继续保留用于个人自用，不把它的权利边界混同为功能代码的 MIT 许可。

## 可按当前项目许可商用

| 内容 | 结论 | 依据 |
| --- | --- | --- |
| Earshot/听屿新增桌面代码、服务代码、测试 | 可商用，遵循仓库 MIT | 根目录 `LICENSE`、`package.json` |
| 听屿品牌图标、头像预设、功能入口预览图和功能预览视频 | 本地生成记录可查；其中如含原归档画面，仍受原素材权利约束，不能一概判为已清权 | 本项目生成脚本与提交记录；尚未逐帧核验所有媒体 |
| `three.module.js` | 可商用，需保留 MIT 声明 | 文件头部 `SPDX-License-Identifier: MIT` |
| `qrcode-generator` 2.0.4 | 可商用，需保留 MIT 声明 | 本地文件头部和 npm 包元数据 |
| npm / Electron 依赖 | 按 `desktop/package-lock.json` 中的 MIT、ISC、BSD、Apache-2.0、BlueOak 等许可分别履行声明 | 锁文件 license 字段 |

## 功能来源核验

| 功能来源 | 核验版本 | 当前处理 |
| --- | --- | --- |
| Earshot | `facc33176-rgb/earshot@2462f5b4d9baa2d8285f04a84ce16e2f9c7d7b3a`，MIT | 保留成熟服务、流式响应、语音和取消逻辑；仅做听屿适配，不做无必要重写 |
| tone.skill | `facc33176-rgb/tone.skill@e88c99e51cebb4a9a7c5d85cf4362399a3b07210`，MIT | 保留 5 个规则参考文档，中文预设由听屿整理；补齐独立 MIT 正文 |
| Tidemark Anchor Memory | `facc33176-rgb/Tidemark-anchor-memory-@3e087a18073eaaeaec0f8ebfdeae1d38f8de8563`，AGPL-3.0 | 仅保留 `GET /api/recall` 与 `POST /api/store` 客户端；不打包服务端代码 |
| CC Switch | `farion1231/cc-switch@e6fd4accd257406bf9141baa402caaa78f975ba1`，MIT | 仅作为供应商管理交互参考，未发现其源码被复制 |

## 不能直接按商用处理

| 内容 | 当前结论 | 处理方式 |
| --- | --- | --- |
| ActiveTheory 原站代码、压缩运行时代码、场景几何、材质、纹理、原站图形和原站媒体 | 未发现随项目附带的商用授权或开源许可；不能按 MIT 使用 | 需要 ActiveTheory 书面商用授权，或用自有 clean-room 场景、几何、纹理和动效替换 |
| `NBArchitektStd` 字体文件 | 未发现字体授权文件；字体本身不能因代码 MIT 而自动商用 | 需要字体商用授权，或替换为有明确商用许可的字体 |
| 原站 `AT` 标识、原站社交图标和原站内容元数据 | 可能涉及商标、版权和品牌权利 | 已从产品导航与品牌入口移除；剩余引用需在清洁重写时移除 |
| 原站旧音乐/旧捕获页面 | 未发现授权，且不属于听屿功能 | 已删除旧背景音乐；本轮同时移除未使用的旧捕获页面 |
| `web/assets/spring-forest.bin` | 从原归档森林点云筛选、量化，仍为第三方衍生素材 | 与 ActiveTheory 场景一同保留自用，本轮不替换 |
| Basis、Draco、Resonance 解码器 | 上游项目通常有开源许可，但归档文件的具体版本与完整声明仍未完成追溯 | 保留现有自用场景；不视为已完成发行审计 |

## 明确替换记录

- 删除 GPLv3 的 `qrious.js`，改用 MIT 的 `qrcode-generator` 2.0.4，并保留文件头部声明。
- GPL/AGPL 本身允许商用；本次二维码替换是为了采用宽松许可并简化未来分发义务，不是因为 GPL 禁止收费或商用。更改变量名、颜色或局部改写不能消除已有派生代码的许可义务。
- 删除未使用的旧捕获页面、旧原站入口文件和旧音乐包装页面，避免它们进入安装包。
- 保留现有本地生成资源；包含原归档画面的功能预览继续按第三方衍生资源处理，未经逐帧核验的媒体不一概视为已清权。
- 桌面安装包显式携带根 `LICENSE`、`THIRD-PARTY-NOTICES.md` 和 `licenses/` 下 tone.skill、Three.js、qrcode-generator 的完整许可，避免只在源码仓库保留声明。

## 发布前阻断条件

在未取得 ActiveTheory 和 NBArchitekt 的书面商用授权前，不应把当前“原始归档场景”版本作为对外商业发行版。可以发行的路径是：保留功能交互和动效思路，完成自有 clean-room 场景、字体、几何、纹理和品牌资源替换，并重新跑安装包审计。

这份文件是工程资产审计，不替代律师对具体发行地区和商业模式的法律意见。
