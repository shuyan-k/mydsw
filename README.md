# @c7sh8y9/mydsw

[![npm version](https://img.shields.io/npm/v/@c7sh8y9/mydsw.svg)](https://www.npmjs.com/package/@c7sh8y9/mydsw)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

在 DSH 里直接使用 **chat.deepseek.com 网页版**（与浏览器里同一个账号、同一份对话记录）的插件。

- **对话列表直接长在 DSH 侧边栏里**：插件会在左侧「工作区」列表下方注入一个「DeepSeek 网页版」分组，网页版的会话就列在那儿——点一条即在中间面板打开它，重命名 / 删除在行上悬停出现。分组是通过 DOM 注入进去的（不占用 DSH 的 slot），所以 DSH 大版本改动侧边栏结构时可能需要跟着修；万一注入失败，面板会自己把左侧那一列会话列表显示出来兜底，列表不会消失。
- **中间是完整的对话界面**：点分组里的任意一条对话，或点分组标题栏上的 `＋`（新建对话），中间就会打开面板——读历史 / 发消息 / 新建 / 重命名 / 删除 / 深度思考 / 联网搜索 / 停止。插件**不再**往「插件」区里放入口图标（会和分组重复），那个入口会被自动隐藏。
- **跟随 DSH 主题，也能和壁纸类主题插件共存**：面板不写死颜色，全部走 DSH 的语义 token；深浅色切换、第三方主题、`dsh-dream-skin` 这类「壁纸 + 半透明」主题都不会把字糊在背景里（见下面「主题适配」）。
- **回答按 Markdown 渲染**：标题、表格、代码块（带语言标签与「复制」）、嵌套列表、引用、分割线、`**粗体**`／`*斜体*`／`` `行内码` ``／链接／图片。渲染器是插件自带的（纯 React 元素，不用 `innerHTML`，`javascript:`/`data:` 链接不放行），流式输出中途也稳定。
- **图片上传**：输入框左侧「添加图片」、直接粘贴剪贴板图片、或把图片拖给 Agent 工具，随消息一起发给网页版（走 `/api/v0/file/upload_file` + `ref_file_ids`）。
- **Agent 工具 `deepseek_web`**：让 Agent 自己列出、读取、并往网页版对话里发消息（可附带本地图片）。

## 主题适配

面板本身不定义任何颜色，所有着色都映射到 DSH 的语义 token（`--dsw-alias-bg-base` / `-bg-layer-1` / `-bg-overlay` / `-label-primary` / `-label-secondary` / `-label-tertiary` / `-border-l1` / `-brand-primary` / `-state-*` / `--dsw-specific-sidebar-fill` 等），所以换主题、切深浅色都会跟着走。某个 token 不存在时会往上一级回退（例如 `--dsw-alias-label-tertiary` 缺失就用 `label-secondary`），不依赖任何主题插件。

针对「壁纸 + 半透明」类主题（`dsh-dream-skin` 等）额外做了三件事：

- **不直接把 `--dsw-alias-bg-base` 当底色。** 这类主题会故意把这个 token 洗成半透明好让壁纸透上来；面板于是改用主题给侧边栏的 `--dsw-specific-sidebar-fill` 做分组底色，其余大块面拿自身色按 42%–55% 叠在页面上，输入区是一张独立的圆角玻璃卡（`backdrop-filter: blur(12px) saturate(140%)`），和 DSH 自己的输入框是一套质感。
- **深色模式下不会和壁纸糊在一起。** 插件会把当前主题的文字色喂给浏览器解析成 rgb、算相对亮度，据此判断深浅：深色主题时自动往面板底色里掺 70% 的不透明基色（`--dsw-web-veil`），保证浅色文字不落在浅色壁纸上；浅色主题下这层是 0%，保持全透。
- **换主题 / 换壁纸会重算。** 用 `MutationObserver` 盯着 `<html>` 的属性与 `<head>` 的增删，重算幂等，不会来回抖。

想调手感，改 `client.js` 里这几个地方即可：`VEIL_DARK`（深色时掺多少）、`THEME_CSS` 里各面的百分比、输入卡的 `borderRadius` / `margin`。

## 它和「登录同一个 DeepSeek 账号」的区别

网页版不是 OpenAI 兼容接口：发一条消息要走「取 PoW 挑战 → 本地解 hashcash → 带 `x-ds-pow-response` 提交 → 解析 SSE 补丁流」这一整套。
本插件在 Node 侧完整实现了这套协议（`lib/pow.js` + wasm 求解器），所以它用的是你网页版里真实的对话历史，不是另一条 API 通道。

## 安装

已发布到 npm：<https://www.npmjs.com/package/@c7sh8y9/mydsw>

```js
plugin_manager({ action: 'install_bundle', target: '@c7sh8y9/mydsw' })
plugin_manager({ action: 'set_bundle', target: '@c7sh8y9/mydsw', enabled: true })
```

装完文件落在 `${DSH_HOME:-~/.dsh}/profiles/<你的 profile>/node_modules/@c7sh8y9/mydsw`。

如果启用后工具没出现，重启一次 DSH 进程（bundle 首次加载需要新进程）。

## 配置登录态

面板第一次打开会显示引导卡：

1. 浏览器登录 <https://chat.deepseek.com>；
2. `F12` → Application → Local Storage → `https://chat.deepseek.com` → 复制 **`userToken`** 的值；
   值是 `{"value":"…","__version":"0"}`，**只需要里面 `…` 那一串**（64 字符 base64）。
   备选取法：Network → 任意 `/api/...` 请求 → 请求头里的 `authorization: Bearer <这一串>`。
3. 粘贴进面板 → 「保存并验证」。宿主会打一次 `/api/v0/users/current` 验证，成功后写到
   `${DSH_HOME:-~/.dsh}/deepseek-web/token.json`（权限 0600）。

也可以用环境变量 `DEEPSEEK_WEB_TOKEN` 提供（优先级低于已保存的文件）。

## Agent 工具用法

| action | 说明 |
| --- | --- |
| `list_conversations` | 列出最近的网页版对话（`limit`，默认 20） |
| `read_conversation` | 读取某个对话的完整消息（含思考过程、联网检索词） |
| `send_message` | 在对话里发一条消息并等回答（`session_id` 省略时用当前选中的会话，没有就新建）；`images` 传本地图片绝对路径数组即可附图 |
| `new_conversation` | 新建对话（可选 `title`） |
| `delete_conversation` | 删除对话 |

## 图片上传的限制

- 单张 ≤ 10 MB，一条消息最多 8 张，格式限 `png / jpg / jpeg / webp / gif`。
- **服务端按文件名后缀判类型**，不看 multipart 的 content-type：没有合法后缀的图片会被改名为 `clipboard-<时间戳>.png` 再上传。
- 上传是串行的，上传完成（`SUCCESS` / `processed` / `ready`）才算数；面板上未传完或失败的图片会**拦住发送**而不是悄悄丢掉——因为网页端一旦收到非法的 `ref_file_ids`，会让这一轮乃至该会话后续每一轮都失败。
- 图片只在**发送那一轮**通过 `ref_file_ids` 提交；历史消息里的图片靠服务端上下文保留，插件不会重复引用（重复 id 同样会被判非法）。因此网页端历史回读时看不到本地文件的字节，面板会把刚发出那轮的缩略图接回最后一条用户消息上。
- 图片进模型上下文有端到端验证：用真实 token 上传「左红右蓝」的测试图并提问，网页端回答「红色 蓝色」。

## 可靠性细节

- 网页端有时会对一个失效的 `chat_session_id` 返回 **HTTP 200 + `{"code":0,"data":{"biz_code":1,"biz_msg":"invalid chat session id"}}`**。插件识别这种情况并自动新建会话重发（面板里那条消息仍会被回答）。
- 错误既可能在外层 `code`，也可能在内层 `biz_code`；两层都会被检查，不会再把失败当「空回答」。

## 限制与风险（请务必知悉）

- **没有停止端点。** 网页端协议里不存在「停止生成」的 HTTP 接口，面板上的「停止」只是本地 abort（断开 SSE）。断开后服务端可能仍在为自己生成一小段时间。
- **同一账号同时只允许一条生成。** 并发触发会被网页端拒绝（`请稍后再试`），社区实测短时间内反复并发会导致账号被限流数小时到一天。**建议请求间隔 2–4 秒**，工具也声明了 `isConcurrencySafe: () => false`。
- **限流以「HTTP 200 + SSE 错误帧」返回**，不是 429：
  - `消息发送过于频繁，请稍后重试` → 账号级限流，等 20 秒以上；
  - `请稍后再试` → 并发被拒，等约 5 秒。
  插件会把这两种情况翻译成人类可读的错误。
- 一次模型调用 ≈ 4 个 HTTP 请求（创建 PoW 挑战、hif 指纹、补全、后续拉取）。
- 凭据就是你的登录态，等同网页版登录 cookie 的能力。别把它贴到不可信的地方；`token.json` 已按 0600 落盘。

## 结构

```
index.js           宿主半边：HTTP 路由 /deepseek-web/{rpc,stream} + deepseek_web 工具 + 图片上传 + 同源围栏
client.js          客户端半边（React，无 JSX）：
                     · 中间面板：对话流 + 输入卡 + 图片交互 + 自写 Markdown 渲染器
                     · 往 DSH 侧边栏注入的「DeepSeek 网页版」会话分组（几何找锚点 + 自我纠正放置）
                     · 主题适配层：注入 <head> 的 CSS + 一层 --dsw-* 语义 token 映射 + 深色探测
lib/pow.js         PoW 求解胶水（WebAssembly）
lib/sha3_wasm_bg.wasm  求解器（26612 字节）
cordis.patch.yml   插入 id=deepseek-web
locale/{zh,en}.json
```

客户端 → 宿主只走 `fetch('/deepseek-web/rpc' | '/stream')`，没有使用任何 `@deepseek-ai/*` 包的导入，因此装进任意 profile 都不依赖裸模块解析。

改了 **`index.js`（宿主半边）必须重启 DSH 进程**才生效；只改 **`client.js`（客户端半边）刷新页面**即可。

## 变更历史

见 [CHANGELOG.md](CHANGELOG.md)。
