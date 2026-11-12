# Earshot · 听着呢

一个可以直接运行的终端语音助手：它会听你说话、等待你说完、被你打断，并把回复逐句念出来。

本仓库把 Earshot、Tidemark 的本地化思路和 `tone.skill` 的语气规则整理成了一个小白可用的程序。无需数据库、无需 npm 依赖安装，Node.js 20+ 即可运行。

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
- `skills/say-it-like-you-mean-it/` 包含来自 `tone.skill` 的语气规则和提示词，可用于进一步调整模型表达。
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

记忆服务是可选的：在“设置”里打开开关并填写 Tidemark 地址（默认 `http://127.0.0.1:8765`）。
开启后，聊天前会尝试召回相关记忆，聊天后会保存本轮摘要；记忆服务没启动时不会打断聊天。
召回使用 `GET /api/recall`，例如：

```bash
curl -G 'http://127.0.0.1:8765/api/recall' \
  --data-urlencode 'query=下雨天喝什么' \
  --data-urlencode 'budget=3' \
  --data-urlencode 'policy=conversation'
```
