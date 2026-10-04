# 安装 mydsw-v1.0

> 发行包 **mydsw-v1.0**（2025-09 构建）
> 插件包名：`@c7sh8y9/mydsw`　版本：`1.0.0`
> 内容：把 chat.deepseek.com **网页版**接进 DSH —— 侧边栏聊天面板（Markdown 渲染 / 图片上传 / 读历史 / 发消息）+ Agent 工具 `deepseek_web`。

## 1. 环境要求

- 一个能装第三方 bundle 的 DSH（Desktop 或 CLI 版都行）。宿主自带 Node 运行时，不需要额外装 Node。
- 系统：Windows / macOS / Linux 均可（插件只用了 Node 内置模块与自带 wasm）。
- 你需要一个**已登录**的 <https://chat.deepseek.com> 账号（登录凭证由你本机保存，不会上传到任何第三方）。

## 2. 解压

把 `mydsw-v1.0.zip` 解压到任意**不会被移动**的目录，例如：

```
Windows   D:\plugins\mydsw-v1.0
macOS     ~/plugins/mydsw-v1.0
```

解压后目录里应该能看到 `package.json`、`index.js`、`client.js`、`lib/`、`locale/`、`cordis.patch.yml`。

> ⚠️ 安装后 DSH 会用这个目录作为插件本体（Windows 上会建一个 junction 指向它）。
> 装好之后**不要再移动或改名**这个目录，否则插件会加载失败；要升级就覆盖目录内容再重启。

## 3. 安装到 DSH

在 DSH 的 Agent 会话里执行（每次调用都会弹审批，允许即可）：

```
plugin_manager({ action: 'install_bundle', target: 'D:\\plugins\\mydsw-v1.0' })
plugin_manager({ action: 'set_bundle', target: '@c7sh8y9/mydsw', enabled: true })
```

也可以在自己熟悉的 DSH 插件管理界面里选「添加本地包 / 从目录安装」，指向同一个目录。

## 4. 重启并刷新

- **宿主半边（`index.js`）改动必须重启 DSH 进程才生效** —— 首次安装同样需要。重启后 `deepseek_web` 会出现在工具表里。
- **客户端半边（`client.js`）只要刷新页面**（侧边栏出现气泡图标、点开就是面板）。

## 5. 配置登录态（只做一次）

面板第一次打开会显示引导卡：

1. 浏览器登录 <https://chat.deepseek.com>；
2. `F12` → **Application / 应用程序** → **Local Storage** → `https://chat.deepseek.com` → 找到 **`userToken`**；
3. 它的值是 `{"value":"…","__version":"0"}` —— **只要 `…` 那一串**（64 字符 base64，可能含 `+` `/` `=`）。
   备选取法：**Network** → 任意 `/api/...` 请求 → 请求头 `authorization: Bearer <同一串>`。
4. 粘贴进面板 → 「保存并验证」。宿主会打一次 `/api/v0/users/current` 验证，成功后就写进
   `${DSH_HOME:-~/.dsh}/deepseek-web/token.json`（权限 0600，只在本机）。

> ⚠️ **不要靠截图转述 token。** 里面 `l/I`、`0/O`、`+` 很容易看错，一个字符错就报
> `Authorization Failed (invalid token)`。请复制文本粘贴。
> 也可以用环境变量 `DEEPSEEK_WEB_TOKEN` 提供（优先级低于已保存的文件）。

## 6. 装完怎么验

- 面板：左侧栏气泡图标 → 「已连接」绿点 + 左栏出现你的网页版对话列表 → 点一条能读到历史。
- Markdown：让它「用一个三级标题、一个三行表格、一个 bash 代码块回答」，应该看到真正的标题 / 表格 / 代码块（代码块右上角有「复制」）。
- 图片：点输入框左侧「添加图片」或直接 `Ctrl+V` 粘贴截图 → 缩略图出现 → 问「这张图里主要是什么颜色」。
- 工具：让 Agent 用 `deepseek_web` 的 `list_conversations` / `send_message`。

## 7. 升级 / 卸载

- **升级**：用新版本覆盖这个目录的全部内容 → **重启 DSH** → 刷新页面。
- **卸载**：`plugin_manager({ action: 'set_bundle', target: '@c7sh8y9/mydsw', enabled: false })`，
  之后可以删掉目录（想彻底清干净的话，再删 `${DSH_HOME}/deepseek-web/`，那里存着登录态）。

## 8. 完整性校验

发行包旁边有 `mydsw-v1.0.zip.sha256`，目录里有 `SHA256SUMS.txt`：

```powershell
# Windows
Get-FileHash .\mydsw-v1.0.zip -Algorithm SHA256
```
```bash
# macOS / Linux
shasum -a 256 mydsw-v1.0.zip
```

两个哈希应该一致。

## 9. 风险与边界（务必阅读）

- **没有「停止生成」的 HTTP 接口。** 面板上的「停止」只是本地断开 SSE，服务端可能仍为自己生成一小段时间。
- **同一账号同时只允许一条生成。** 并发会被网页端拒绝（`请稍后再试`）；社区实测短时间反复并发会导致账号被限流数小时到一天。**建议请求间隔 2–4 秒**，本插件的工具也声明了 `isConcurrencySafe: () => false`。
- **限流不是 429**，而是 HTTP 200 里的错误帧（`消息发送过于频繁，请稍后重试` → 等 20 秒以上；`请稍后再试` → 等几秒）。插件会翻译成人类可读的错误。
- 一次模型调用 ≈ 4 个 HTTP 请求（PoW 挑战、指纹、补全、后续拉取）。
- 图片：单张 ≤ 10 MB，一条最多 8 张，`png/jpg/jpeg/webp/gif`；**服务端按文件名后缀判类型**（不看 multipart 的 content-type），没有合法后缀的会被改名为 `clipboard-<时间戳>.png`。
- **凭据就是你的登录态**，能力等同网页版登录 cookie。别把它贴到不可信的地方；本插件只在 `token.json`（0600）里保存它。
- 插件的 HTTP 端点挂在 `/deepseek-web/*`，自带同源围栏（只认 loopback Host / 同源 Origin），外部网页无法直接调用。
