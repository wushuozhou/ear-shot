# 听屿 · Tingyu

一个可以直接运行的终端语音助手：它会听你说话、等待你说完、被你打断，并把回复逐句念出来。

本仓库把 Earshot、Tidemark 的本地化思路和 `tone.skill` 的语气规则整理成了一个小白可用的程序。无需数据库、无需 npm 依赖安装，Node.js 20+ 即可运行。

## 来源与署名

- 本项目基于 [facc33176-rgb/earshot](https://github.com/facc33176-rgb/earshot)（MIT）二次开发，原始版权归 Earshot authors 所有，完整许可见仓库根目录 [LICENSE](./LICENSE)。
- 语气规则引用自 [facc33176-rgb/tone.skill](https://github.com/facc33176-rgb/tone.skill)（MIT），包含 5 个规则参考文档和听屿整理的中文预设；完整许可见 [licenses/tone.skill.MIT.txt](./licenses/tone.skill.MIT.txt)。
- 记忆功能可选对接 [Tidemark](https://github.com/facc33176-rgb/Tidemark-anchor-memory-)（AGPL-3.0），仅通过其 HTTP 接口调用，仓库中不包含其任何代码。
- 桌面外壳、模型供应商适配层、图形界面为新增部分。

功能代码与原场景资源的许可边界分别列于 [第三方声明](./THIRD-PARTY-NOTICES.md) 和 [许可审计](./COMMERCIAL_LICENSE_AUDIT.md)。ActiveTheory 归档、字体和衍生森林点云按当前自用要求保留，根 MIT 许可不覆盖它们；当前整包不作为已清权的商业发行版。

## 三步使用

### Windows

1. 安装 [Node.js 20+](https://nodejs.org/)。
2. 双击 `start.bat`。
3. 第一次运行按菜单选择供应商、粘贴密钥，之后浏览器打开显示的地址。

### macOS / Linux

```bash
chmod +x start.command
./start.command
```

Linux/macOS 一行安装时，脚本会询问安装目录；直接回车使用 `~/earshot`。也可以提前指定：

```bash
EARSHOT_DIR="$HOME/apps/earshot" bash install.sh
```

Windows 直接把整个项目文件夹移动到任意位置，再双击 `start.bat` 即可；如果使用快捷方式，也可以编辑 `start.bat` 顶部的 `EARSHOT_DIR`。

也可以使用终端菜单：

```bash
npm run earshot
```

菜单提供：

1. 首次配置 / 修改供应商
2. 检查模型、转写、声音连接
3. 启动通话服务
4. 查看当前状态

## 已支持的连接

| 部分 | 可用服务 |
| --- | --- |
| 大脑（聊天模型） | OpenAI、DeepSeek、OpenRouter、Groq、Ollama，以及任何 OpenAI 兼容 API |
| 耳朵（语音转文字） | OpenAI Whisper、SiliconFlow SenseVoice、Groq Whisper，以及任何 `/audio/transcriptions` 兼容 API |
| 声音（文字转语音） | ElevenLabs v3/v4、OpenAI TTS、SiliconFlow CosyVoice，以及任何 `/audio/speech` 兼容 API |
| 服务器 | 本机 HTTP 服务，可选访问口令，支持手机通过 HTTPS 隧道访问 |

配置向导内置三种组合：

1. OpenAI 一站式
2. DeepSeek + 硅基流动 SenseVoice + CosyVoice（中文推荐）
3. 任意模型 + OpenAI Whisper + ElevenLabs（表现力最好）

自定义供应商可在 `.env` 中填写，向导会保留已有设置。

## 常用命令

```bash
npm run earshot setup    # 重新配置
npm run earshot check    # 用真实请求检测模型、声音、转写
npm run earshot status   # 只查看本地配置，不发请求
npm start                # 直接启动服务
npm test                 # 运行测试
```

## 安全与费用

API 密钥只保存在本机 `.env`，不要提交到 Git。每次通话会消耗你自己的供应商额度。准备从手机或外网访问时，请在向导中开启访问口令，并使用 HTTPS 隧道；不要把无口令的服务直接暴露到公网。

这是语音助手，不是真人；不要用于紧急、医疗、法律或危机沟通。项目代码采用 MIT 许可证。

## 自定义人格和语气

- 修改 `persona.md` 可改变它是谁、怎么称呼你。
- `desktop/skills/` 包含来自 `tone.skill` 的整理语气规则和提示词（`tones.json` 与 `README.md`），可用于进一步调整模型表达。
- 中文安装与使用说明见 `docs/使用教程.md`。

## 桌面应用（桌面版使用方式）

桌面版安装完成后，直接双击 Earshot 图标就能启动，不需要另外安装 Node.js 或 Python。

第一次启动会自动准备配置文件。配置文件放在：

`%APPDATA%\Earshot\config.json`（Windows）

桌面版会优先使用这个配置文件；没有填写的项目才会继续读取程序目录里的 `.env`。
API 密钥只保存在本机，不会显示在启动页面，也不会写进日志。

默认服务端口是 8787。如果这个端口已经被别的软件占用，Earshot 会自动换一个空闲端口。
这不会影响正常使用。

桌面版日志放在 `%APPDATA%\Earshot\logs\desktop.log`。
遇到启动问题时，可以把这个文件交给维护人员查看。

安装程序可以选择安装目录。额外的数据目录和模型目录可以在 `config.json` 中填写
`dataDir` 和 `installDirHint`；留空时使用默认目录。
发版时运行 `npm run release <版本号>`，然后手动执行脚本打印的 git commit、tag 和 push 命令。

## 模型供应商与第三方接入

桌面版内置了 OpenAI、DeepSeek、硅基流动、OpenRouter、Groq、Ollama，
以及 OpenAI Whisper、SenseVoice、CosyVoice、ElevenLabs 等常用服务。

如果列表里没有你的服务，选择“自定义供应商”，填写名称、Base URL、API Key 和模型名称。
只要服务兼容 OpenAI 接口，就不需要改代码：

- DeepSeek：`https://api.deepseek.com/v1`，模型填 `deepseek-chat`
- 硅基流动：`https://api.siliconflow.cn/v1`，模型可填 `deepseek-ai/DeepSeek-V3`
- OpenRouter：`https://openrouter.ai/api/v1`，模型例如 `openai/gpt-4o-mini`
- Ollama：`http://127.0.0.1:11434/v1`，模型填你本机已有的模型

模型、STT 和 TTS 都可以单独添加自定义项目；STT 使用 `/audio/transcriptions`，
TTS 使用 `/audio/speech`。保存后点击“测试连接”，失败时会告诉你是网络、密钥、
地址、模型还是额度问题。API Key 会加密保存在本机，不会提交到仓库。

一个 Profile 就是一组“模型 + 转文字 + 朗读声音”。你可以保存多组 Profile，
在桌面版里一键切换，例如“国内推荐”和“声音最有感情”。切换后重新启动服务即可生效。

## 桌面版智能体对话

桌面版首页是智能体对话，可以选择温柔陪伴、直率毒舌、克制专业或俏皮放松四种语气。
语气规则会在每轮请求前自动加入提示词，助手的回复也会保留适合朗读的节奏和语气标记。

每个联系人各有独立的聊天记录、头像、模型、人设与号码。左侧列表点击即可切换联系人，
列表会显示最近一条消息，重启后仍会回到上次打开的联系人。聊天记录保存在
`%APPDATA%\earshot-desktop\conversations\`，一个联系人一个 JSON 文件。

想清理聊天内容有三个入口：对话页工具栏的「清空记录」、左侧列表项左滑露出的
「清空记录」与「删除」、以及设置页「联系人」卡片里的单个清空、删除与「清空全部聊天记录」。
清空只删除聊天内容，联系人本身及其头像、人设、号码都会保留；删除联系人才会一并移除记录。

侧边栏从上到下是「聊天 / 通话 / 收藏 / 设置」四项，供应商管理收在设置里。

聊天支持文字、语音、图片、视频和普通文件。点麦克风开始录音，再点一次结束并发送，
录音会先转写成文字再连同语音条一起存进记录；图片和视频**直接粘贴或拖进输入框**就能发送，
其他文件走旁边的文件按钮，单个附件上限 20MB。输入区的「AI 语音」开关（设置页也有）
打开后，AI 的回答会合成语音，在聊天里以语音条显示，合成失败会自动退回文字，不会打断聊天。
通话中只能说话或打字，在通话里粘贴图片会提示去聊天页发送。

桌面版采用统一的 iOS 风格界面。窗口右上角保留系统原生最小化、最大化/还原和关闭按钮，上栏可以拖动窗口或双击最大化。

0.12.0 桌面产品更名为「听屿」。功能首页完整复用用户提供的 ActiveTheory 场景：滚动文字、脊柱、环绕画廊、粒子与鼠标流体效果保留；@ 改为听屿三维产品图标。十四个作品位适配为实际功能入口，英文标题配中文标注。原场景在独立本地来源运行，打开功能后暂停，返回继续原位置。聊天、通话、设置、模型和收藏页统一为双栏液态磨砂玻璃。通话采用参考 Shopify Spring ’26 的本地森林点云、水面倒影和增强极光，支持自定义颜色、图案及减少动态效果。品牌内部为心电波形，三维模型、导航与 Windows 图标一致。原始聊天、通话、收藏、模型与记忆数据格式保持兼容。

液态玻璃侧边栏可以点左下角的小箭头收起，收起后只剩一列图标，状态会记住，下次打开保持原样。聊天列表支持按姓名或号码搜索，输入框的草稿和引用会在切换联系人时保留；阅读历史消息时，新回复不会把页面强行拉回底部。生成中可点「停止」取消模型与记忆请求。语音转写完成前会保留当前联系人，避免语音发送到其他对话。

点一下气泡（或右键）会弹出微信式的操作条：复制、收藏、引用、多选、删除。
「引用」会在输入框上方挂一条引用，发出去后在气泡里显示成引用块；「多选」进入
勾选模式，可以一次收藏好几条。收藏按来源分成「来自聊天」和「来自通话」两栏，
文字、语音和图片都能收。

想让 AI 看懂图片，在「设置 → 通话与聊天」里打开「让 AI 看图片」。开启后发出的
图片会随消息一起交给模型，需要模型支持视觉输入（例如 gpt-4o）；模型不支持时会
明确提示换模型或关掉这个开关，不会只甩一个 HTTP 错误。

通话页按 iOS 电话的习惯分成「通话记录 / 联系人 / 拨号键盘」三个标签：通话记录会
记下每次通话的方向与时长，拨号键盘输入号码可以直接呼叫对应联系人。通话界面本身
只保留通话，听写、打断与访问令牌这些开关都挪进了设置页的「通话与聊天」。

聊天和通话的背景都能在设置里换成纯色或自定义图片，通话背景默认是纯黑。

记忆服务是可选的：在“设置”里打开开关并填写 Tidemark 地址（默认 `http://127.0.0.1:8765`）。
开启后，聊天前会尝试召回相关记忆，聊天后会保存本轮摘要；记忆服务没启动时不会打断聊天。
召回使用 `GET /api/recall`，例如：

```bash
curl -G 'http://127.0.0.1:8765/api/recall' \
  --data-urlencode 'query=下雨天喝什么' \
  --data-urlencode 'budget=3' \
  --data-urlencode 'policy=conversation'
```
