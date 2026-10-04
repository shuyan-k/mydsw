/**
 * @c7sh8y9/mydsw —— Client 半边（Web 页面里的侧边栏面板）。
 *
 * 只 require("react")：静态 client 半边能拿到的平台 seed 模块就只有
 * react / react-dom / slots 等，Harness 的 Client 包（包括 ui-primitives）
 * 既不允许 import 也不保证可解析。
 *
 * 与 Host 半边的通道：fetch 打宿主注册的 /deepseek-web/rpc 与 /deepseek-web/stream。
 * （生态里装进 profile 的三方插件都是这个路子；那条路由自带同源判定。）
 */
window.__ModuleLoader__.load({
  id: '@c7sh8y9/mydsw',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const PREFIX = '/deepseek-web'
    const PANEL_ID = 'deepseek-web'
    // 与宿主 index.js 的 MAX_IMAGES_PER_MESSAGE 保持一致（网页端对本轮 ref_file_ids 有上限）
    const MAX_IMAGES = 8
    const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif']

    /* ---------------------------------------------------------- *
     * 文案（跟随页面语言；不引入额外依赖）
     * ---------------------------------------------------------- */

    const TEXT = {
      zh: {
        nav: 'DeepSeek 网页版',
        panelTitle: 'DeepSeek 网页版',
        panelSubtitle: '与 chat.deepseek.com 同一个账号',
        loginTitle: '先连接你的 DeepSeek 网页版账号',
        loginStep1: '在浏览器里打开 chat.deepseek.com 并登录。',
        loginStep2: '按 F12 打开开发者工具 → Application → Local Storage。',
        loginStep3: '复制 userToken 的值（形如 {"value":"...","__version":"0"} 就只取 value 里那串）。',
        loginPlaceholder: '粘贴 userToken',
        loginSave: '保存并验证',
        loginSaving: '正在验证…',
        loginClear: '清除登录态',
        tokenStored: '登录态只保存在这台机器上：',
        connectedAs: '已连接',
        note: '同一账号同时只能有一条生成在跑；「停止」后 DeepSeek 可能还会占用几秒。请勿并发发送。',
        newChat: '新建对话',
        refresh: '刷新',
        conversations: '对话',
        emptyConversations: '还没有对话。',
        emptyThread: '选一个左边的对话，或者新建一个开始聊天。',
        composerPlaceholder: '给 DeepSeek 网页版发消息…（Enter 发送，Shift+Enter 换行）',
        send: '发送',
        stop: '停止',
        thinking: '深度思考',
        search: '联网搜索',
        thinkingTrace: '思考过程',
        searching: '联网检索',
        you: '你',
        assistant: 'DeepSeek',
        rename: '重命名',
        del: '删除',
        confirmDelete: '删除这个网页版对话？此操作在 chat.deepseek.com 上不可撤销。',
        newTitle: '新的标题',
        close: '关闭',
        noAnswer: '（没有返回正文）',
        attach: '添加图片',
        attachHint: '最多 8 张（png / jpg / jpeg / webp / gif，单张 ≤10MB），也可以直接粘贴图片',
        uploading: '上传中…',
        uploadFailed: '上传失败',
        removeImage: '移除这张图',
        copy: '复制',
        copied: '已复制',
        tooManyImages: '最多一次发 8 张图片。',
      },
      en: {
        nav: 'DeepSeek Web',
        panelTitle: 'DeepSeek Web',
        panelSubtitle: 'The same account as chat.deepseek.com',
        loginTitle: 'Connect your DeepSeek web account',
        loginStep1: 'Open chat.deepseek.com in a browser and sign in.',
        loginStep2: 'Press F12 → Application → Local Storage.',
        loginStep3: 'Copy the userToken value (if it looks like {"value":"...","__version":"0"}, take just the value).',
        loginPlaceholder: 'Paste userToken',
        loginSave: 'Save and verify',
        loginSaving: 'Verifying…',
        loginClear: 'Forget token',
        tokenStored: 'The token is stored on this machine only: ',
        connectedAs: 'Connected',
        note: 'One generation per account at a time; DeepSeek may keep the slot busy for a few seconds after Stop. Do not send concurrently.',
        newChat: 'New chat',
        refresh: 'Refresh',
        conversations: 'Chats',
        emptyConversations: 'No chats yet.',
        emptyThread: 'Pick a chat on the left, or start a new one.',
        composerPlaceholder: 'Message DeepSeek on the web… (Enter to send, Shift+Enter for a newline)',
        send: 'Send',
        stop: 'Stop',
        thinking: 'Deep thinking',
        search: 'Web search',
        thinkingTrace: 'Thinking',
        searching: 'Searched',
        you: 'You',
        assistant: 'DeepSeek',
        rename: 'Rename',
        del: 'Delete',
        confirmDelete: 'Delete this web chat? It cannot be undone on chat.deepseek.com.',
        newTitle: 'New title',
        close: 'Close',
        noAnswer: '(no answer)',
        attach: 'Attach image',
        attachHint: 'Up to 8 (png / jpg / jpeg / webp / gif, ≤10MB each). You can also paste an image.',
        uploading: 'Uploading…',
        uploadFailed: 'Upload failed',
        removeImage: 'Remove this image',
        copy: 'Copy',
        copied: 'Copied',
        tooManyImages: 'At most 8 images per message.',
      },
    }

    function activeLang() {
      try {
        const tag = String((typeof navigator !== 'undefined' && (navigator.language || navigator.languages?.[0])) || '')
        if (tag.toLowerCase().startsWith('zh')) return 'zh'
        if (tag === '') return 'zh'
        return 'en'
      } catch {
        return 'zh'
      }
    }

    function t(key) {
      const dict = TEXT[activeLang()] || TEXT.zh
      return dict[key] ?? TEXT.zh[key] ?? key
    }

    /* ---------------------------------------------------------- *
     * Host 通道
     * ---------------------------------------------------------- */

    class ApiError extends Error {
      constructor(message, needToken) {
        super(message)
        this.needToken = needToken === true
      }
    }

    async function rpc(method, params) {
      let response
      try {
        response = await fetch(`${PREFIX}/rpc`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method, params: params ?? {} }),
        })
      } catch (error) {
        throw new ApiError(`无法连接插件宿主路由：${error?.message ?? error}`)
      }
      let payload
      try {
        payload = await response.json()
      } catch {
        throw new ApiError(`插件宿主返回了非 JSON 响应（HTTP ${response.status}）`)
      }
      if (payload?.ok !== true) {
        throw new ApiError(payload?.error?.message ?? '插件宿主返回了未知错误', payload?.error?.needToken)
      }
      return payload.result
    }

    /* ---------------------------------------------------------- *
     * 图标（侧边栏面板入口；颜色跟随按钮 currentColor）
     * ---------------------------------------------------------- */

    /* 侧边栏锚点：插件自己在侧边栏的入口图标上打个标记，注入分组时
       从这里往上找 DSH 侧边栏 —— 不去猜 DSH 那些跟着构建变的哈希类名。 */
    const NAV_ATTR = 'data-mydsw-nav'
    const SIDE_ATTR = 'data-mydsw-sidebar'
    const HIDE_ATTR = 'data-mydsw-hide'

    function PanelIcon(props) {
      const size = Number(props?.size) > 0 ? Number(props.size) : 18
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          [NAV_ATTR]: '',
          style: { display: 'block', opacity: props?.active === false ? 0.75 : 1 },
        },
        h('path', { d: 'M21 11.5a8.4 8.4 0 0 1-9 8.4 9.6 9.6 0 0 1-2.9-.4L4 21l1.4-3.9A8.2 8.2 0 0 1 3.4 11.5a8.4 8.4 0 0 1 8.9-8.4A8.4 8.4 0 0 1 21 11.5Z' }),
        h('path', { d: 'M12.2 8.1v6.8' }),
        h('path', { d: 'M8.9 11.5h6.6' }),
      )
    }

    /* ---------------------------------------------------------- *
     * 主题适配层
     *
     * 面板不写死任何颜色：颜色一律走 DSH 的语义 token（--dsw-alias-*），
     * 所以 dsh-dream-skin 的任意 skin、第三方 theme pack、以及 DSH 自带的
     * 明暗主题都能直接改色。
     *
     * 观感目标是「跟 DSH 自己一样」：dream-skin 挂壁纸时会把
     * --dsw-alias-bg-base 洗成 rgba(<皮肤底色>, canvasAlpha)，DSH 的主区就是
     * 靠这个把壁纸透出来的。所以面板主区照抄同一份 token —— 壁纸直接透过来；
     * 会话列表则直接用 DSH 侧边栏那块玻璃（--dsw-specific-sidebar-fill），
     * 于是它跟左边栏一起透；输入区、气泡、代码块这些「卡片」用半透明玻璃，
     * 跟 DSH 自己的代码块观感一致。
     *
     * 唯一要额外处理的是「深色主题 + 浅色壁纸」：文字是浅的、壁纸也是浅的，
     * 直接叠上去就糊了。所以：
     *
     *   --dsw-web-veil   主区额外掺多少「不透明的皮肤底色」。浅色主题 0%
     *                    （= 纯 DSH 效果，壁纸全透），深色主题由
     *                    syncThemeVeil() 量出文字是浅色之后抬到 55%，
     *                    把主区压实，浅色文字就压得住浅色壁纸了。
     *   --dsw-web-anchor 不带 alpha 的原始皮肤底色，dream-skin 用
     *                    --dsh-dream-skin-composer-base 暴露出来。
     *   磨砂             只有输入卡片自己叠 backdrop-filter（跟 DSH 的输入框一样），
     *                    面板本身不模糊 —— 壁纸是清清楚楚透过来的。
     *
     * 所有样式都锁在 .mydsw-root 作用域下，不碰 DSH 自己的 DOM。
     * ---------------------------------------------------------- */

    const THEME_STYLE_ID = `${PANEL_ID}-theme`

    /* 主区「压实」程度：浅色主题不掺（跟 DSH 自己的主区一模一样），
       深色主题掺七成——浅色文字压浅色壁纸，不压实就看不清。 */
    const VEIL_LIGHT = '10%'
    const VEIL_DARK = '70%'

    const THEME_CSS = `
@property --dsw-web-veil {
  syntax: '<percentage>';
  inherits: true;
  initial-value: 0%;
}
.mydsw-root {
  --dsw-web-anchor: var(--dsh-dream-skin-composer-base, var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base, #ffffff)));
  --dsw-web-page: var(--dsw-alias-bg-base, var(--dsw-alias-bg-layer-1, #ffffff));
  --dsw-web-sidebar: var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-2, #ffffff));
  --dsw-web-layer-1: var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base, #ffffff));
  --dsw-web-layer-2: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1, #ffffff));
  --dsw-web-overlay: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1, #ffffff));
  --dsw-web-selected: var(--dsw-specific-sidebar-nav-item-active, var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.14)));
  --dsw-web-hover: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.14));
  --dsw-web-on-accent: var(--dsw-alias-brand-text, #ffffff);
  --dsw-web-placeholder: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary, #8a8a8a));
  --dsw-web-scroll: var(--dsw-alias-scrollbar-bg-l1, rgba(127, 127, 127, 0.32));
  --dsw-web-scroll-hover: var(--dsw-alias-scrollbar-hover-l1, rgba(127, 127, 127, 0.55));
}
@supports (background: color-mix(in srgb, #ffffff 50%, #000000)) {
  .mydsw-root {
    --dsw-web-page: color-mix(in srgb, var(--dsw-web-anchor) var(--dsw-web-veil, 0%), var(--dsw-alias-bg-base, var(--dsw-alias-bg-layer-1, #ffffff)));
    --dsw-web-sidebar: color-mix(in srgb, var(--dsw-web-anchor) var(--dsw-web-veil, 0%), var(--dsw-specific-sidebar-fill, color-mix(in srgb, var(--dsw-alias-bg-layer-2, #ffffff) 60%, transparent)));
    --dsw-web-layer-1: color-mix(in srgb, var(--dsw-web-anchor) var(--dsw-web-veil, 0%), color-mix(in srgb, var(--dsw-alias-bg-layer-1, #ffffff) 45%, transparent));
    --dsw-web-layer-2: color-mix(in srgb, var(--dsw-web-anchor) var(--dsw-web-veil, 0%), color-mix(in srgb, var(--dsw-alias-bg-layer-2, #ffffff) 42%, transparent));
    --dsw-web-overlay: color-mix(in srgb, var(--dsw-web-anchor) var(--dsw-web-veil, 0%), color-mix(in srgb, var(--dsw-alias-bg-overlay, #ffffff) 55%, transparent));
    --dsw-web-selected: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 20%, var(--dsw-web-sidebar));
  }
}
.mydsw-root textarea::placeholder,
.mydsw-root input::placeholder { color: var(--dsw-web-placeholder); opacity: 1; }
.mydsw-root ::-webkit-scrollbar { width: 10px; height: 10px; }
.mydsw-root ::-webkit-scrollbar-track { background: transparent; }
.mydsw-root ::-webkit-scrollbar-corner { background: transparent; }
.mydsw-root ::-webkit-scrollbar-thumb {
  background: var(--dsw-web-scroll);
  background-clip: padding-box;
  border: 2px solid transparent;
  border-radius: 999px;
}
.mydsw-root ::-webkit-scrollbar-thumb:hover {
  background: var(--dsw-web-scroll-hover);
  background-clip: padding-box;
}
.mydsw-btn,
.mydsw-item,
.mydsw-pill { transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease; }
.mydsw-btn:hover { background-color: var(--dsw-web-hover) !important; }
.mydsw-btn-primary:hover {
  background-color: var(--dsw-alias-button-primary-hover, var(--dsw-alias-brand-primary)) !important;
}
.mydsw-item:hover:not(.mydsw-item-active) { background-color: var(--dsw-web-hover) !important; }
.mydsw-pill:not(.mydsw-pill-on):hover { background-color: var(--dsw-web-hover) !important; }
/* 把插件区那一行入口藏掉：对话列表已经长在「工作区」下面，那一行是多余的。
   只藏这一行，注册本身留着 —— layout.selectPanel() 把面板带到前台要靠它，
   [data-mydsw-nav] 这个图标也是我们找侧边栏的唯一锚点。 */
[data-mydsw-hide] { display: none !important; }
/* ---- DSH 侧边栏里的「DeepSeek 网页版」分组（DOM 注入，不在面板作用域内） ---- */
[data-mydsw-sidebar] {
  flex: 0 0 auto;
  padding: 2px var(--dsh-sidebar-inline-padding, 12px) 12px;
  color: var(--dsw-alias-label-primary);
  /* 跟 DSH 侧边栏共用一套字体，不要自己另起一套 */
  font: inherit;
  line-height: 1.4;
}
[data-mydsw-sidebar] .mydsw-side-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  padding: 4px 6px 2px;
}
[data-mydsw-sidebar] .mydsw-side-title {
  font-size: inherit;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-mydsw-sidebar] .mydsw-side-count {
  font-size: 0.85em;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
}
[data-mydsw-sidebar] .mydsw-side-gap { flex: 1 1 auto; }
[data-mydsw-sidebar] .mydsw-side-act {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
[data-mydsw-sidebar] .mydsw-side-act:hover {
  background: var(--dsw-specific-sidebar-nav-item-hover, var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12)));
  color: var(--dsw-alias-label-primary);
}
[data-mydsw-sidebar] .mydsw-side-list { display: flex; flex-direction: column; gap: 1px; }
[data-mydsw-sidebar] .mydsw-side-row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px;
  border-radius: 8px;
  cursor: pointer;
  color: var(--dsw-alias-label-primary);
  transition: background-color 140ms ease;
}
[data-mydsw-sidebar] .mydsw-side-row:hover {
  background: var(--dsw-specific-sidebar-nav-item-hover, var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12)));
}
[data-mydsw-sidebar] .mydsw-side-row-active,
[data-mydsw-sidebar] .mydsw-side-row-active:hover {
  background: var(--dsw-specific-sidebar-nav-item-active, var(--dsw-alias-interactive-bg-active, rgba(127, 127, 127, 0.2)));
}
[data-mydsw-sidebar] .mydsw-side-row-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-mydsw-sidebar] .mydsw-side-time {
  flex: 0 0 auto;
  font-size: 0.85em;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
}
[data-mydsw-sidebar] .mydsw-side-tools { display: none; flex: 0 0 auto; align-items: center; gap: 6px; }
[data-mydsw-sidebar] .mydsw-side-row:hover .mydsw-side-tools,
[data-mydsw-sidebar] .mydsw-side-row:focus-within .mydsw-side-tools { display: inline-flex; }
[data-mydsw-sidebar] .mydsw-side-row:hover .mydsw-side-time,
[data-mydsw-sidebar] .mydsw-side-row:focus-within .mydsw-side-time { display: none; }
[data-mydsw-sidebar] .mydsw-side-tool { font-size: 0.85em; color: var(--dsw-alias-label-secondary); cursor: pointer; }
[data-mydsw-sidebar] .mydsw-side-tool:hover { color: var(--dsw-alias-label-primary); }
[data-mydsw-sidebar] .mydsw-side-tool-del { color: var(--dsw-alias-state-error-primary); }
[data-mydsw-sidebar] .mydsw-side-empty {
  padding: 6px 8px;
  font-size: 0.92em;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
}
`

    /* 让浏览器帮我们把 token 解析成 rgb，量一下当前主题的文字是深是浅。 */
    function cssColorOf(expr) {
      if (typeof document === 'undefined' || document.body === null) return null
      const probe = document.createElement('span')
      probe.setAttribute('aria-hidden', 'true')
      probe.style.cssText = `position:absolute;left:-9999px;top:-9999px;width:0;height:0;background-color:${expr}`
      document.body.appendChild(probe)
      let text = ''
      try {
        text = getComputedStyle(probe).backgroundColor
      } finally {
        probe.remove()
      }
      const match = /^rgba?\(([^)]+)\)$/.exec(String(text).trim())
      if (match === null) return null
      const parts = match[1].split(/[\s,/]+/).filter((piece) => piece !== '').map(Number)
      if (parts.length < 3 || parts.some((value) => !Number.isFinite(value))) return null
      const alpha = parts.length > 3 ? parts[3] : 1
      if (alpha === 0) return null
      return parts.slice(0, 3)
    }

    function relativeLuminance(rgb) {
      const channels = rgb.map((value) => {
        const unit = value / 255
        return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
    }

    /* 深色主题的文字是浅色 → 面板主区要压得更实，否则浅色文字会淹在浅色壁纸里。 */
    function syncThemeVeil() {
      if (typeof document === 'undefined') return
      const label = cssColorOf('var(--dsw-alias-label-primary)')
      const dark = label !== null && relativeLuminance(label) > 0.5
      const veil = dark ? VEIL_DARK : VEIL_LIGHT
      const root = document.documentElement
      if (root.style.getPropertyValue('--dsw-web-veil') !== veil) {
        root.style.setProperty('--dsw-web-veil', veil)
      }
    }

    /* 主题随时可能换（换皮肤、切明暗、改壁纸），跟着重算。 */
    function watchTheme(onChange) {
      if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
        return () => {}
      }
      let queued = false
      const schedule = () => {
        if (queued) return
        queued = true
        const flush = () => {
          queued = false
          onChange()
        }
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush)
        else setTimeout(flush, 16)
      }
      const observer = new MutationObserver(schedule)
      observer.observe(document.documentElement, { attributes: true })
      if (document.body !== null) observer.observe(document.body, { attributes: true })
      if (document.head !== null) observer.observe(document.head, { childList: true })
      onChange()
      return () => observer.disconnect()
    }

    let themeStyleUsers = 0
    let stopThemeWatch = null

    function acquireThemeStyle() {
      themeStyleUsers += 1
      if (
        typeof document !== 'undefined' &&
        document.getElementById(THEME_STYLE_ID) === null
      ) {
        const style = document.createElement('style')
        style.id = THEME_STYLE_ID
        style.textContent = THEME_CSS
        ;(document.head || document.body || document.documentElement).appendChild(style)
      }
      if (stopThemeWatch === null) stopThemeWatch = watchTheme(syncThemeVeil)
      let released = false
      return () => {
        if (released) return
        released = true
        themeStyleUsers -= 1
        if (themeStyleUsers > 0) return
        themeStyleUsers = 0
        if (stopThemeWatch !== null) {
          stopThemeWatch()
          stopThemeWatch = null
        }
        if (typeof document === 'undefined') return
        document.getElementById(THEME_STYLE_ID)?.remove()
        document.documentElement.style.removeProperty('--dsw-web-veil')
      }
    }
    /* ---------------------------------------------------------- *
     * 小工具
     * ---------------------------------------------------------- */

    const COLOR = {
      bg: 'var(--dsw-web-page, var(--dsw-alias-bg-base, #ffffff))',
      layer1: 'var(--dsw-web-layer-1, var(--dsw-alias-bg-layer-1, #ffffff))',
      layer2: 'var(--dsw-web-layer-2, var(--dsw-alias-bg-layer-2, #ffffff))',
      overlay: 'var(--dsw-web-overlay, var(--dsw-alias-bg-overlay, #ffffff))',
      sidebar: 'var(--dsw-web-sidebar, var(--dsw-alias-bg-layer-2, #ffffff))',
      selected: 'var(--dsw-web-selected, var(--dsw-alias-bg-layer-1))',
      border1: 'var(--dsw-alias-border-l1)',
      border2: 'var(--dsw-alias-border-l2)',
      text1: 'var(--dsw-alias-label-primary)',
      text2: 'var(--dsw-alias-label-secondary)',
      text3: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))',
      accent: 'var(--dsw-alias-brand-primary)',
      onAccent: 'var(--dsw-web-on-accent, var(--dsw-alias-brand-text, #ffffff))',
      error: 'var(--dsw-alias-state-error-primary)',
      success: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
    }

    function formatTime(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
      const date = new Date(ms)
      const now = Date.now()
      const diff = now - ms
      if (diff < 60_000) return t('nav') === 'DeepSeek Web' ? 'just now' : '刚刚'
      if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}${activeLang() === 'zh' ? ' 分钟前' : 'm ago'}`
      if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}${activeLang() === 'zh' ? ' 小时前' : 'h ago'}`
      const pad = (n) => String(n).padStart(2, '0')
      const month = pad(date.getMonth() + 1)
      const day = pad(date.getDate())
      return `${month}-${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    function Bubble(props) {
      return h(
        'div',
        props,
        null,
      )
    }

    /* ---------------------------------------------------------- *
     * Markdown 渲染（自写、零依赖）
     *
     * 静态 client 半边不允许 import Harness 的组件库，所以这里手写一个够用的
     * 子集：围栏代码块 / 标题 / 表格 / 列表（可嵌套）/ 引用 / 分割线 / 段落，
     * 行内支持 **粗体**、*斜体*、`代码`、[链接](url)、![图片](url)。
     * 只产出 React 元素，不用 innerHTML，也不 eval 任何东西。
     * 流式过程中收到的半截 Markdown 也要能渲染（未闭合的 ``` 就当成代码块到底）。
     * ---------------------------------------------------------- */

    const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace"

    const HEADING_STYLE = [
      { fontSize: '20px', fontWeight: 700, margin: '16px 0 8px' },
      { fontSize: '17px', fontWeight: 700, margin: '15px 0 7px', paddingBottom: '3px', borderBottom: `1px solid ${COLOR.border1}` },
      { fontSize: '15.5px', fontWeight: 650, margin: '14px 0 6px' },
      { fontSize: '14.5px', fontWeight: 650, margin: '12px 0 5px' },
      { fontSize: '14px', fontWeight: 600, margin: '10px 0 4px' },
      { fontSize: '13.5px', fontWeight: 600, margin: '10px 0 4px', color: COLOR.text2 },
    ]

    const LINK_STYLE = { color: COLOR.accent, textDecoration: 'underline', wordBreak: 'break-all' }
    const INLINE_CODE_STYLE = {
      padding: '1px 5px',
      borderRadius: '5px',
      background: COLOR.layer2,
      border: `1px solid ${COLOR.border1}`,
      fontSize: '12.5px',
      fontFamily: MONO,
    }

    // 图片 / 链接 / 行内代码 / 粗体 / 斜体；顺序有意义（先匹配更长的形态）
    const INLINE_PATTERN =
      /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g

    /** 只放行 http(s) 与相对链接，挡掉 javascript: 之类的协议。 */
    function safeUrl(raw) {
      const url = String(raw ?? '').trim()
      if (url === '') return null
      if (/^(https?:)?\/\//i.test(url)) return url
      if (/^[/#]/.test(url)) return url
      return null
    }

    /** 行内富文本 → React 节点数组。 */
    function inlineNodes(text, keyPrefix) {
      const source = String(text ?? '')
      const nodes = []
      let last = 0
      let index = 0
      INLINE_PATTERN.lastIndex = 0
      let match = INLINE_PATTERN.exec(source)
      while (match !== null) {
        if (match.index > last) nodes.push(source.slice(last, match.index))
        last = match.index + match[0].length
        const key = `${keyPrefix}-i${index}`
        index += 1
        if (match[1] !== undefined) {
          const url = safeUrl(match[2])
          nodes.push(
            url === null
              ? match[0]
              : h('img', {
                  key,
                  src: url,
                  alt: match[1],
                  style: { display: 'block', maxWidth: '100%', margin: '6px 0', borderRadius: '8px' },
                }),
          )
        } else if (match[3] !== undefined) {
          const url = safeUrl(match[4])
          nodes.push(
            url === null
              ? match[0]
              : h(
                  'a',
                  { key, href: url, target: '_blank', rel: 'noreferrer noopener', style: LINK_STYLE },
                  match[3],
                ),
          )
        } else if (match[5] !== undefined) {
          nodes.push(h('code', { key, style: INLINE_CODE_STYLE }, match[5]))
        } else if (match[6] !== undefined) {
          nodes.push(h('strong', { key, style: { fontWeight: 650 } }, match[6]))
        } else if (match[7] !== undefined) {
          nodes.push(h('em', { key, style: { fontStyle: 'italic' } }, match[7]))
        }
        match = INLINE_PATTERN.exec(source)
      }
      if (last < source.length) nodes.push(source.slice(last))
      return nodes
    }

    /** 多行文本 → 带 <br> 的 React 节点数组（Markdown 的段落内换行）。 */
    function paragraphNodes(lines, keyPrefix) {
      const nodes = []
      lines.forEach((line, index) => {
        if (index > 0) nodes.push(h('br', { key: `${keyPrefix}-br${index}` }))
        const inline = inlineNodes(line, `${keyPrefix}-l${index}`)
        for (const node of inline) nodes.push(node)
      })
      return nodes
    }

    function isTableSeparator(line) {
      const text = String(line ?? '').trim()
      if (text === '' || text.indexOf('-') === -1) return false
      return /^\|?[\s:-]*-[\s|:-]*\|?$/.test(text)
    }

    function splitTableRow(line) {
      let text = String(line ?? '').trim()
      if (text.startsWith('|')) text = text.slice(1)
      if (text.endsWith('|')) text = text.slice(0, -1)
      return text.split('|').map((cell) => cell.trim())
    }

    /** 列表项：`  - 文本` / `  3) 文本` */
    function listEntry(line) {
      const match = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(String(line ?? ''))
      if (match === null) return null
      return {
        indent: match[1].replace(/\t/g, '  ').length,
        marker: match[2],
        ordered: /^\d/.test(match[2]),
        text: match[3],
      }
    }

    function isBlockStart(line, nextLine) {
      const text = String(line ?? '')
      if (text.trim() === '') return true
      if (/^\s{0,3}(```|~~~)/.test(text)) return true
      if (/^\s{0,3}#{1,6}\s+/.test(text)) return true
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(text)) return true
      if (/^\s{0,3}>/.test(text)) return true
      if (listEntry(text) !== null) return true
      if (text.includes('|') && isTableSeparator(nextLine)) return true
      return false
    }

    /** 把一组同级/嵌套的列表项渲染成 <ul>/<ol>。 */
    function renderList(items, keyPrefix) {
      const first = items[0]
      const children = []
      let index = 0
      while (index < items.length) {
        const item = items[index]
        if (item.ordered !== first.ordered) break
        let end = index + 1
        while (end < items.length && items[end].indent > item.indent) end += 1
        const sub = items.slice(index + 1, end)
        children.push(
          h(
            'li',
            { key: `${keyPrefix}-li${index}`, style: { margin: '3px 0' } },
            inlineNodes(item.text, `${keyPrefix}-t${index}`),
            sub.length === 0 ? null : listElements(sub, `${keyPrefix}-s${index}`),
          ),
        )
        index = end
      }
      const props = { key: `${keyPrefix}-list`, style: { margin: '6px 0', paddingLeft: '24px' } }
      if (first.ordered) {
        const start = Number.parseInt(first.marker, 10)
        if (Number.isFinite(start) && start > 1) props.start = start
      }
      return h(first.ordered ? 'ol' : 'ul', props, children)
    }

    /** renderList 一次只吃同一种有序性的连续块，这里算出它吃了多少项。 */
    function countListRun(items) {
      const first = items[0]
      let index = 0
      while (index < items.length) {
        if (items[index].ordered !== first.ordered) break
        let end = index + 1
        while (end < items.length && items[end].indent > items[index].indent) end += 1
        index = end
      }
      return index
    }

    function listElements(items, keyPrefix) {
      const nodes = []
      let rest = items
      let round = 0
      while (rest.length > 0 && round < 32) {
        nodes.push(renderList(rest, `${keyPrefix}-r${round}`))
        rest = rest.slice(countListRun(rest))
        round += 1
      }
      return nodes
    }

    /** Markdown 源码 → 块级 React 节点数组。 */
    function markdownBlocks(source) {
      const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n')
      const blocks = []
      let key = 0
      let i = 0
      const nextKey = () => `md-${key++}`

      while (i < lines.length) {
        const line = lines[i]

        // 围栏代码块（流式时可能还没有收尾的 ```）
        const fence = /^\s{0,3}(```+|~~~+)\s*([^\s`]*)\s*$/.exec(line)
        if (fence !== null) {
          const marker = fence[1][0]
          const closePattern = new RegExp(`^\\s{0,3}${marker}{3,}\\s*$`)
          const body = []
          i += 1
          while (i < lines.length && !closePattern.test(lines[i])) {
            body.push(lines[i])
            i += 1
          }
          if (i < lines.length) {
            i += 1
          } else {
            // 流式过程中还没等到收尾的 ```：丢掉末尾空行，免得代码块里多一条空行
            while (body.length > 0 && body[body.length - 1] === '') body.pop()
          }
          blocks.push(h(CodeBlock, { key: nextKey(), language: fence[2] ?? '', text: body.join('\n') }))
          continue
        }

        if (line.trim() === '') {
          i += 1
          continue
        }

        const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line)
        if (heading !== null) {
          const level = Math.min(heading[1].length, 6)
          blocks.push(
            h(
              `h${level}`,
              { key: nextKey(), style: HEADING_STYLE[level - 1] },
              inlineNodes(heading[2].trim(), nextKey()),
            ),
          )
          i += 1
          continue
        }

        if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
          blocks.push(
            h('hr', {
              key: nextKey(),
              style: { border: 'none', borderTop: `1px solid ${COLOR.border1}`, margin: '14px 0' },
            }),
          )
          i += 1
          continue
        }

        // 表格：表头 + 分隔行 + 若干数据行
        if (line.includes('|') && isTableSeparator(lines[i + 1])) {
          const header = splitTableRow(line)
          const aligns = splitTableRow(lines[i + 1]).map((cell) => {
            const left = cell.startsWith(':')
            const right = cell.endsWith(':')
            if (left && right) return 'center'
            if (right) return 'right'
            return 'left'
          })
          i += 2
          const rows = []
          while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
            rows.push(splitTableRow(lines[i]))
            i += 1
          }
          const cellStyle = (index) => ({
            border: `1px solid ${COLOR.border1}`,
            padding: '6px 10px',
            textAlign: aligns[index] ?? 'left',
            verticalAlign: 'top',
          })
          blocks.push(
            h(
              'div',
              { key: nextKey(), style: { margin: '10px 0', overflowX: 'auto' } },
              h(
                'table',
                { style: { borderCollapse: 'collapse', fontSize: '13px', width: '100%' } },
                h(
                  'thead',
                  null,
                  h(
                    'tr',
                    null,
                    header.map((cell, index) =>
                      h(
                        'th',
                        {
                          key: `th${index}`,
                          style: Object.assign({}, cellStyle(index), {
                            background: COLOR.layer2,
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                          }),
                        },
                        inlineNodes(cell, `th${index}`),
                      ),
                    ),
                  ),
                ),
                h(
                  'tbody',
                  null,
                  rows.map((row, rowIndex) =>
                    h(
                      'tr',
                      { key: `tr${rowIndex}` },
                      header.map((_unused, index) =>
                        h(
                          'td',
                          { key: `td${rowIndex}-${index}`, style: cellStyle(index) },
                          inlineNodes(row[index] ?? '', `td${rowIndex}-${index}`),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          )
          continue
        }

        if (/^\s{0,3}>/.test(line)) {
          const body = []
          while (i < lines.length && /^\s{0,3}>/.test(lines[i])) {
            body.push(lines[i].replace(/^\s{0,3}>\s?/, ''))
            i += 1
          }
          blocks.push(
            h(
              'blockquote',
              {
                key: nextKey(),
                style: {
                  margin: '10px 0',
                  padding: '2px 0 2px 12px',
                  borderLeft: `3px solid ${COLOR.border2}`,
                  color: COLOR.text2,
                },
              },
              paragraphNodes(body, nextKey()),
            ),
          )
          continue
        }

        const firstEntry = listEntry(line)
        if (firstEntry !== null) {
          const items = []
          while (i < lines.length) {
            const entry = listEntry(lines[i])
            if (entry === null) break
            items.push(entry)
            i += 1
          }
          for (const node of listElements(items, nextKey())) blocks.push(node)
          continue
        }

        // 段落
        const paragraph = []
        while (i < lines.length && !isBlockStart(lines[i], lines[i + 1])) {
          paragraph.push(lines[i])
          i += 1
        }
        if (paragraph.length === 0) {
          paragraph.push(line)
          i += 1
        }
        blocks.push(h('p', { key: nextKey(), style: { margin: '8px 0' } }, paragraphNodes(paragraph, nextKey())))
      }

      return blocks
    }

    /** 代码块：带语言标签与「复制」按钮。 */
    function CodeBlock(props) {
      const [copied, setCopied] = React.useState(false)
      const copy = () => {
        try {
          void navigator.clipboard.writeText(props.text)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        } catch {
          /* 剪贴板不可用（非安全上下文）就静默算了 */
        }
      }
      return h(
        'div',
        {
          style: {
            margin: '10px 0',
            border: `1px solid ${COLOR.border1}`,
            borderRadius: '10px',
            overflow: 'hidden',
            background: COLOR.layer2,
          },
        },
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '4px 10px',
              background: COLOR.layer1,
              borderBottom: `1px solid ${COLOR.border1}`,
            },
          },
          h('span', { style: { flex: '1 1 auto', fontSize: '11px', color: COLOR.text2 } }, props.language || 'text'),
          h(
            'span',
            {
              role: 'button',
              tabIndex: 0,
              onClick: copy,
              style: { cursor: 'pointer', fontSize: '11px', color: copied ? COLOR.success : COLOR.text2 },
            },
            copied ? t('copied') : t('copy'),
          ),
        ),
        h(
          'pre',
          {
            style: {
              margin: 0,
              padding: '10px 12px',
              overflowX: 'auto',
              fontSize: '12.5px',
              lineHeight: 1.6,
              fontFamily: MONO,
              color: COLOR.text1,
            },
          },
          h('code', null, props.text),
        ),
      )
    }

    /** 助手正文的 Markdown 视图。 */
    function Markdown(props) {
      const blocks = React.useMemo(() => markdownBlocks(props.text), [props.text])
      return h('div', { style: { fontSize: '14px', lineHeight: 1.7, wordBreak: 'break-word' } }, blocks)
    }

    /**
     * 网页端的历史消息里没有本地图片信息（图只在服务端上下文里），
     * 于是按正文把刚发出的那条匹配回来，接上本地预览，刷新后仍看得见自己发的图。
     */
    function restorePreviews(messages, sent) {
      if (sent === null || typeof sent !== 'object') return messages
      const previews = Array.isArray(sent.images) ? sent.images : []
      if (previews.length === 0) return messages
      let index = messages.length - 1
      while (index >= 0) {
        const message = messages[index]
        if (message.role === 'user' && String(message.content ?? '') === String(sent.content ?? '')) {
          if (Array.isArray(message.images) && message.images.length > 0) return messages
          const next = messages.slice()
          next[index] = Object.assign({}, message, { images: previews })
          return next
        }
        index -= 1
      }
      return messages
    }

    /* ---------------------------------------------------------- *
     * 消息
     * ---------------------------------------------------------- */

    function MessageRow(props) {
      const message = props.message
      const isUser = message.role === 'user'
      const pieces = []
      if (!isUser && typeof message.thinking === 'string' && message.thinking !== '') {
        pieces.push(
          h(
            'details',
            {
              key: 'thinking',
              style: {
                marginBottom: '8px',
                border: `1px solid ${COLOR.border1}`,
                borderRadius: '10px',
                background: COLOR.layer1,
                padding: '8px 10px',
              },
            },
            h(
              'summary',
              { style: { cursor: 'pointer', fontSize: '12px', color: COLOR.text2 } },
              t('thinkingTrace'),
            ),
            h(
              'div',
              {
                style: {
                  marginTop: '6px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontSize: '12px',
                  lineHeight: 1.6,
                  color: COLOR.text2,
                  maxHeight: '320px',
                  overflow: 'auto',
                },
              },
              message.thinking,
            ),
          ),
        )
      }
      if (!isUser && Array.isArray(message.queries) && message.queries.length > 0) {
        pieces.push(
          h(
            'div',
            { key: 'queries', style: { marginBottom: '8px', fontSize: '12px', color: COLOR.text2 } },
            `${t('searching')}：${message.queries.join(' · ')}`,
          ),
        )
      }
      const images = Array.isArray(message.images) ? message.images : []
      if (images.length > 0) {
        pieces.push(
          h(
            'div',
            {
              key: 'images',
              style: {
                display: 'flex',
                flexWrap: 'wrap',
                gap: '6px',
                marginBottom: '7px',
                justifyContent: isUser ? 'flex-end' : 'flex-start',
              },
            },
            images.map((image, index) =>
              h('img', {
                key: `img${index}`,
                src: image.url ?? image.previewUrl,
                alt: image.name ?? 'image',
                title: image.name ?? '',
                style: {
                  display: 'block',
                  maxWidth: '190px',
                  maxHeight: '150px',
                  borderRadius: '10px',
                  border: `1px solid ${COLOR.border1}`,
                },
              }),
            ),
          ),
        )
      }
      if (isUser) {
        pieces.push(
          h(
            'div',
            {
              key: 'body',
              style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.7, fontSize: '14px' },
            },
            message.content,
          ),
        )
      } else if (message.content === '') {
        pieces.push(h('div', { key: 'body', style: { fontSize: '13px', color: COLOR.text2 } }, t('noAnswer')))
      } else {
        pieces.push(h(Markdown, { key: 'body', text: message.content }))
      }

      return h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: isUser ? 'flex-end' : 'flex-start',
            marginBottom: '16px',
          },
        },
        h(
          'div',
          { style: { fontSize: '11px', marginBottom: '4px', color: COLOR.text2 } },
          isUser ? t('you') : t('assistant'),
        ),
        h(
          'div',
          {
            style: {
              maxWidth: isUser ? '78%' : '100%',
              padding: isUser ? '9px 13px' : '11px 14px',
              borderRadius: '14px',
              border: `1px solid ${COLOR.border1}`,
              background: isUser ? COLOR.layer2 : COLOR.overlay,
              color: COLOR.text1,
            },
          },
          pieces,
        ),
      )
    }

    /* ---------------------------------------------------------- *
     * 面板
     * ---------------------------------------------------------- */

    function Panel() {
      /* 临时诊断：数一数 DSH 到底有没有来渲染我们这个组件。 */
      const [state, setState] = React.useState(null)
      const [sessions, setSessions] = React.useState([])
      const [messages, setMessages] = React.useState([])
      const [selected, setSelected] = React.useState('')
      const [draft, setDraft] = React.useState('')
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [loading, setLoading] = React.useState(true)
      const [streaming, setStreaming] = React.useState(false)
      const [streamText, setStreamText] = React.useState('')
      const [streamThinking, setStreamThinking] = React.useState('')
      const [tokenInput, setTokenInput] = React.useState('')
      const [savingToken, setSavingToken] = React.useState(false)
      // 待发送的图片：{key, name, size, previewUrl, dataBase64, status:'uploading'|'done'|'error', fileId, error}
      const [images, setImages] = React.useState([])
      // 会话列表是不是已经搬进 DSH 侧边栏了（搬成功就不在面板里再显示一列）
      const [sideMounted, setSideMounted] = React.useState(sideBox.mounted)

      const abortRef = React.useRef(null)
      const scrollRef = React.useRef(null)
      const stateRef = React.useRef(null)
      const selectedRef = React.useRef('')
      const fileInputRef = React.useRef(null)
      // 待发图片的最新值（addImageFiles 的回调里不能依赖闭包里的 images）
      const imagesRef = React.useRef([])
      imagesRef.current = images
      // 刚发出的那条（正文 + 图片预览），用来在历史回填后把预览接回去
      const lastSentRef = React.useRef(null)
      stateRef.current = state
      selectedRef.current = selected

      const fail = React.useCallback((problem) => {
        setError(problem?.message ?? String(problem))
      }, [])

      /** 把一批 File（来自选择器或粘贴板）读成 data URL 并立刻上传，拿到 file_id。 */
      const addImageFiles = React.useCallback(
        (fileList) => {
          const incoming = []
          for (const file of Array.from(fileList ?? [])) {
            if (file === null || typeof file !== 'object') continue
            const type = String(file.type ?? '')
            const name = String(file.name ?? '')
            const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? ''
            const looksLikeImage = type.startsWith('image/') || IMAGE_EXTENSIONS.indexOf(extension) >= 0
            if (!looksLikeImage) continue
            incoming.push(file)
          }
          if (incoming.length === 0) return

          for (const file of incoming) {
            const rawName = String(file.name ?? '')
            const safeName =
              /\.([a-z0-9]+)$/i.test(rawName) && IMAGE_EXTENSIONS.indexOf(rawName.split('.').pop().toLowerCase()) >= 0
                ? rawName
                : `clipboard-${Date.now()}.png`
            const key = `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
            const reader = new FileReader()
            reader.onload = () => {
              const dataUrl = String(reader.result ?? '')
              const comma = dataUrl.indexOf(',')
              const dataBase64 = comma === -1 ? '' : dataUrl.slice(comma + 1)
              if (dataBase64 === '') {
                setError(t('uploadFailed'))
                return
              }
              if (imagesRef.current.length >= MAX_IMAGES) {
                setError(t('tooManyImages'))
                return
              }
              const entry = {
                key,
                name: safeName,
                size: file.size,
                previewUrl: dataUrl,
                dataBase64,
                status: 'uploading',
                fileId: '',
                error: '',
              }
              imagesRef.current = [...imagesRef.current, entry]
              setImages(imagesRef.current)
              void rpc('upload', { name: safeName, dataBase64 })
                .then((result) => {
                  setImages((prev) =>
                    prev.map((item) =>
                      item.key === key ? { ...item, status: 'done', fileId: String(result.fileId ?? '') } : item,
                    ),
                  )
                })
                .catch((problem) => {
                  setImages((prev) =>
                    prev.map((item) =>
                      item.key === key
                        ? { ...item, status: 'error', error: problem?.message ?? String(problem) }
                        : item,
                    ),
                  )
                })
            }
            reader.onerror = () => setError(t('uploadFailed'))
            reader.readAsDataURL(file)
          }
        },
        [],
      )

      const loadSessions = React.useCallback(
        async (preferSessionId) => {
          const result = await rpc('sessions', { limit: 60 })
          setState(result)
          setSessions(Array.isArray(result.sessions) ? result.sessions : [])
          const wanted = preferSessionId || selectedRef.current || result.selectedSessionId || ''
          const exists = wanted !== '' && result.sessions.some((item) => item.id === wanted)
          return exists ? wanted : ''
        },
        [],
      )

      const openConversation = React.useCallback(
        async (sessionId) => {
          if (sessionId === '') {
            setSelected('')
            setMessages([])
            return
          }
          setLoading(true)
          try {
            const result = await rpc('history', { sessionId })
            setState(result)
            setMessages(Array.isArray(result.messages) ? result.messages : [])
            setSelected(sessionId)
            setError('')
            /* 真的开成功了才把「待打开」清掉：面板中途重挂也不会把它弄丢 */
            if (pendingOpenId === sessionId) pendingOpenId = ''
          } catch (problem) {
            fail(problem)
            if (problem?.needToken) setState((prev) => ({ ...(prev ?? {}), hasToken: false }))
          } finally {
            setLoading(false)
          }
        },
        [fail],
      )

      const refresh = React.useCallback(
        async (options) => {
          setLoading(true)
          try {
            const current = await rpc('state')
            setState(current)
            if (current.hasToken !== true) {
              setSessions([])
              setMessages([])
              setSelected('')
              return
            }
            const wanted = await loadSessions(options?.preferSessionId)
            /* 侧边栏点的那一条优先级最高：哪怕 host 记着别的会话、或者面板刚重挂，
               也必须打开用户点的那一条，不能被 wanted 顶掉。 */
            const pinned = takePendingOpen()
            if (pinned !== '') await openConversation(pinned)
            else if (wanted !== '') await openConversation(wanted)
            else {
              setSelected('')
              setMessages([])
            }
            setError('')
          } catch (problem) {
            fail(problem)
          } finally {
            setLoading(false)
          }
        },
        [fail, loadSessions, openConversation],
      )

      React.useEffect(() => {
        void refresh()
      }, [refresh])

      // 会话状态同步给侧边栏那份列表
      React.useEffect(() => {
        try {
          sideBox.data.hasToken = state?.hasToken === true
          sideBox.data.sessions = sessions
          sideBox.data.selected = selected
          sideBox.data.ready = true
          renderSideSection()
        } catch (problem) {
          /* 侧边栏渲染出问题也绝不能把面板本身带崩 */
          /* 侧边栏画不出来不影响面板本身 */
        }
      }, [state, sessions, selected])

      // 注入成功/失效之后，面板决定要不要把兜底的那列显示出来
      React.useEffect(() => {
        setSideMounted(sideBox.mounted)
        return sideBox.subscribe(setSideMounted)
      }, [])

      // 侧边栏点开某条对话时接住它（面板刚好在这一刻挂载也一样管用）
      React.useEffect(() => {
        const onOpen = (event) => {
          const sessionId = event?.detail?.sessionId
          if (typeof sessionId !== 'string' || sessionId === '') return
          void openConversation(sessionId)
        }
        window.addEventListener(SIDE_EVENT_OPEN, onOpen)
        return () => window.removeEventListener(SIDE_EVENT_OPEN, onOpen)
      }, [openConversation])

      React.useEffect(() => {
        const node = scrollRef.current
        if (node !== null) node.scrollTop = node.scrollHeight
      }, [messages, streamText, streamThinking])

      /* 侧边栏里的新建/重命名/删除直接复用面板这套逻辑，行为保持一致。
         这里有两个坑必须一起躲开：
         1) hook 的调用次数在「加载中 / 未登录」和「已登录」两条分支上必须一致，
            所以这个 effect 一定要放在下面那两个 early return 之前；
            放到它们后面，切到已登录时就多出一个 hook，React 抛 #310，
            「Rendered more hooks than during the previous render」，面板全崩。
         2) 依赖数组是渲染期求值的，不能写 createConversation / removeConversation /
            renameConversation —— 它们声明在下面，写进 deps 会撞 TDZ，
            整个 Panel 一渲染就抛 ReferenceError。
         所以这里 deps 留空，真正的回调每帧由下面那句普通赋值刷进 sideActionsRef。 */
      const sideActionsRef = React.useRef(null)
      React.useEffect(() => {
        const call = (name, ...args) => {
          const actions = sideActionsRef.current
          if (actions !== null && actions !== undefined && typeof actions[name] === 'function') {
            return actions[name](...args)
          }
          return undefined
        }
        sideBox.actions = {
          create: () => call('create'),
          rename: (sessionId, title) => call('rename', sessionId, title),
          remove: (sessionId) => call('remove', sessionId),
          refresh: () => call('refresh'),
          // 打开某条会话：走面板自己的 refresh(preferSessionId)，一次把状态对齐
          open: (sessionId) => call('open', sessionId),
        }
        /* 立刻重画侧边栏：上面那几个 effect 里的重画发生在这一行之前，
           那时候 actions 还是 null，画出来会误报「未挂载」。 */
        try {
          renderSideSection()
        } catch {
          /* 诊断画不出来就算了 */
        }
        return () => {
          if (sideBox.actions !== null) sideBox.actions = null
          try {
            renderSideSection()
          } catch {
            /* 同上 */
          }
        }
      }, [])

      const saveToken = React.useCallback(async () => {
        const token = tokenInput.trim()
        if (token === '') return
        setSavingToken(true)
        setError('')
        try {
          const result = await rpc('setToken', { token })
          setState(result)
          setTokenInput('')
          await refresh()
        } catch (problem) {
          fail(problem)
        } finally {
          setSavingToken(false)
        }
      }, [tokenInput, refresh, fail])

      const clearToken = React.useCallback(async () => {
        setBusy(true)
        try {
          const result = await rpc('clearToken')
          setState(result)
          setSessions([])
          setMessages([])
          setSelected('')
          setError('')
        } catch (problem) {
          fail(problem)
        } finally {
          setBusy(false)
        }
      }, [fail])

      const createConversation = React.useCallback(async () => {
        setBusy(true)
        try {
          const result = await rpc('create')
          setState(result)
          setSelected(result.session?.id ?? '')
          setMessages([])
          setError('')
          await loadSessions(result.session?.id)
        } catch (problem) {
          fail(problem)
        } finally {
          setBusy(false)
        }
      }, [fail, loadSessions])

      const removeConversation = React.useCallback(
        async (sessionId) => {
          if (typeof window !== 'undefined' && !window.confirm(t('confirmDelete'))) return
          setBusy(true)
          try {
            await rpc('remove', { sessionId })
            if (selectedRef.current === sessionId) {
              setSelected('')
              setMessages([])
            }
            await loadSessions()
            setError('')
          } catch (problem) {
            fail(problem)
          } finally {
            setBusy(false)
          }
        },
        [fail, loadSessions],
      )

      const renameConversation = React.useCallback(
        async (sessionId, currentTitle) => {
          if (typeof window === 'undefined') return
          const next = window.prompt(t('newTitle'), currentTitle)
          if (typeof next !== 'string' || next.trim() === '') return
          setBusy(true)
          try {
            await rpc('rename', { sessionId, title: next.trim() })
            await loadSessions(sessionId)
            setError('')
          } catch (problem) {
            fail(problem)
          } finally {
            setBusy(false)
          }
        },
        [fail, loadSessions],
      )

      const toggleSetting = React.useCallback(
        async (key) => {
          const current = stateRef.current ?? {}
          try {
            const result = await rpc('settings', { [key]: current[key] !== true })
            setState(result)
          } catch (problem) {
            fail(problem)
          }
        },
        [fail],
      )

      const stopStream = React.useCallback(async () => {
        if (abortRef.current !== null) {
          abortRef.current.abort()
          abortRef.current = null
        }
        try {
          await rpc('stop')
        } catch {
          /* 停止本身失败无需再报错 */
        }
        setStreaming(false)
      }, [])

      const send = React.useCallback(async () => {
        const text = draft.trim()
        if (streaming) return
        const current = stateRef.current ?? {}
        if (current.hasToken !== true) {
          setError(t('loginTitle'))
          return
        }
        // 图片必须先全部上传成功：ref_file_ids 只接受已经处理完的 file id，
        // 而且一批里有非法 id 会让整轮（乃至这个会话后续每轮）都失败，所以宁可挡住发送。
        const pending = images.filter((image) => image.status === 'uploading')
        const broken = images.filter((image) => image.status === 'error')
        const ready = images.filter((image) => image.status === 'done' && image.fileId !== '')
        if (pending.length > 0) {
          setError(t('uploading'))
          return
        }
        if (broken.length > 0) {
          setError(broken[0].error === '' ? t('uploadFailed') : broken[0].error)
          return
        }
        if (text === '' && ready.length === 0) return
        setError('')
        setDraft('')

        let sessionId = selectedRef.current
        const controller = typeof AbortController === 'function' ? new AbortController() : null
        abortRef.current = controller
        setStreaming(true)
        setStreamText('')
        setStreamThinking('')

        const previews = ready.map((image) => ({ url: image.previewUrl, name: image.name }))
        const optimistic = {
          id: `local-${Date.now()}`,
          role: 'user',
          content: text,
          thinking: '',
          queries: [],
          images: previews,
        }
        setMessages((prev) => [...prev, optimistic])
        lastSentRef.current = { content: text, images: previews }
        setImages([])

        let finished = false
        try {
          const response = await fetch(`${PREFIX}/stream`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              sessionId,
              text,
              thinking: current.thinking === true,
              search: current.search === true,
              imageFileIds: ready.map((image) => image.fileId),
            }),
            signal: controller === null ? undefined : controller.signal,
          })
          if (response.body === null) throw new ApiError('插件宿主没有返回流式响应体')

          const reader = response.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          let answer = ''
          let thinking = ''

          for (;;) {
            const chunk = await reader.read()
            if (chunk.done) break
            buffer += decoder.decode(chunk.value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            for (const line of lines) {
              const trimmed = line.trim()
              if (trimmed === '') continue
              let event
              try {
                event = JSON.parse(trimmed)
              } catch {
                continue
              }
              if (event.type === 'session') {
                sessionId = event.sessionId
                setSelected(sessionId)
              } else if (event.type === 'meta') {
                if (typeof event.sessionId === 'string' && event.sessionId !== '') sessionId = event.sessionId
              } else if (event.type === 'content') {
                answer += event.text
                setStreamText(answer)
              } else if (event.type === 'thinking') {
                thinking += event.text
                setStreamThinking(thinking)
              } else if (event.type === 'search') {
                setStreamThinking((prev) => `${prev}${prev === '' ? '' : '\n'}🔎 ${(event.queries || []).join(' · ')}`)
              } else if (event.type === 'error') {
                throw new ApiError(event.error?.message ?? '发送失败', event.error?.needToken)
              } else if (event.type === 'done') {
                finished = true
              }
            }
          }
        } catch (problem) {
          if (problem?.name !== 'AbortError') fail(problem)
        } finally {
          abortRef.current = null
          setStreaming(false)
          setStreamText('')
          setStreamThinking('')
          // 结束后以网页端的权威历史为准（顺序、思考片段、标题都可能刚更新）。
          if (sessionId !== '') {
            try {
              const result = await rpc('history', { sessionId })
              setMessages(restorePreviews(Array.isArray(result.messages) ? result.messages : [], lastSentRef.current))
              setSelected(sessionId)
            } catch (problem) {
              if (finished) fail(problem)
            }
          }
          try {
            await loadSessions(sessionId)
          } catch {
            /* 刷新列表失败不影响已拿到的回答 */
          }
        }
      }, [draft, streaming, images, fail, loadSessions])

      const onKeyDown = React.useCallback(
        (event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void send()
          }
        },
        [send],
      )

      /* ---------------- 登录态未就绪 ---------------- */

      if (state === null) {
        return h(
          'div',
          {
            className: 'mydsw-root',
            style: {
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: COLOR.text2,
              fontSize: '13px',
              background: COLOR.bg,
            },
          },
          loading ? '…' : error || '…',
        )
      }

      if (state.hasToken !== true) {
        return h(
          'div',
          {
            className: 'mydsw-root',
            style: {
              height: '100%',
              overflow: 'auto',
              background: COLOR.bg,
              color: COLOR.text1,
              display: 'flex',
              justifyContent: 'center',
              padding: '40px 24px',
              boxSizing: 'border-box',
            },
          },
          h(
            'div',
            {
              style: {
                width: '100%',
                maxWidth: '560px',
                border: `1px solid ${COLOR.border1}`,
                borderRadius: '16px',
                background: COLOR.layer1,
                padding: '22px 22px 20px',
                alignSelf: 'flex-start',
              },
            },
            h('div', { style: { fontSize: '17px', fontWeight: 600, marginBottom: '6px' } }, t('loginTitle')),
            h('div', { style: { fontSize: '13px', color: COLOR.text2, lineHeight: 1.7, marginBottom: '14px' } }, t('panelSubtitle')),
            h(
              'ol',
              { style: { margin: '0 0 16px', paddingLeft: '20px', fontSize: '13px', lineHeight: 1.9, color: COLOR.text1 } },
              h('li', null, t('loginStep1')),
              h('li', null, t('loginStep2')),
              h('li', null, t('loginStep3')),
            ),
            h('textarea', {
              value: tokenInput,
              onChange: (event) => setTokenInput(event.target.value),
              placeholder: t('loginPlaceholder'),
              spellCheck: false,
              style: {
                width: '100%',
                minHeight: '74px',
                resize: 'vertical',
                boxSizing: 'border-box',
                padding: '10px 12px',
                borderRadius: '10px',
                border: `1px solid ${COLOR.border2}`,
                background: COLOR.bg,
                color: COLOR.text1,
                fontSize: '12px',
                lineHeight: 1.6,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                outline: 'none',
              },
            }),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '14px' } },
              h(
                'button',
                {
                  type: 'button',
                  onClick: () => void saveToken(),
                  disabled: savingToken || tokenInput.trim() === '',
                  className: 'mydsw-btn mydsw-btn-primary',
                  style: {
                    padding: '8px 16px',
                    borderRadius: '9px',
                    border: 'none',
                    background: COLOR.accent,
                    color: COLOR.onAccent,
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: savingToken || tokenInput.trim() === '' ? 'default' : 'pointer',
                    opacity: savingToken || tokenInput.trim() === '' ? 0.6 : 1,
                  },
                },
                savingToken ? t('loginSaving') : t('loginSave'),
              ),
              error === ''
                ? null
                : h('span', { style: { color: COLOR.error, fontSize: '12px', lineHeight: 1.5 } }, error),
            ),
            h(
              'div',
              { style: { marginTop: '16px', fontSize: '11px', color: COLOR.text2, lineHeight: 1.7 } },
              `${t('tokenStored')}${state.statePath ?? ''}`,
            ),
          ),
        )
      }

      /* ---------------- 主界面 ---------------- */

      const composerDisabled = streaming
      // 只发图不带字也算一条消息
      const canSend = !composerDisabled && (draft.trim() !== '' || images.length > 0)
      const items = sessions.map((session) =>
        h(
          'div',
          {
            key: session.id,
            onClick: () => {
              if (streaming) return
              void openConversation(session.id)
            },
            className:
              'mydsw-item' + (session.id === selected ? ' mydsw-item-active' : ''),
            style: {
              padding: '8px 10px',
              borderRadius: '9px',
              marginBottom: '4px',
              cursor: streaming ? 'default' : 'pointer',
              background: session.id === selected ? COLOR.selected : 'transparent',
              border: `1px solid ${session.id === selected ? COLOR.border2 : 'transparent'}`,
            },
          },
          h(
            'div',
            {
              style: {
                fontSize: '13px',
                color: COLOR.text1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              },
              title: session.title,
            },
            session.title,
          ),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '3px' } },
            h('span', { style: { fontSize: '11px', color: COLOR.text2 } }, formatTime(session.updatedAt)),
            h(
              'span',
              {
                role: 'button',
                tabIndex: 0,
                onClick: (event) => {
                  event.stopPropagation()
                  void renameConversation(session.id, session.title)
                },
                style: { fontSize: '11px', color: COLOR.text2, cursor: 'pointer' },
              },
              t('rename'),
            ),
            h(
              'span',
              {
                role: 'button',
                tabIndex: 0,
                onClick: (event) => {
                  event.stopPropagation()
                  void removeConversation(session.id)
                },
                style: { fontSize: '11px', color: COLOR.error, cursor: 'pointer' },
              },
              t('del'),
            ),
          ),
        ),
      )

      const thread = messages.map((message, index) =>
        h(MessageRow, { key: message.id ?? `m-${index}`, message }),
      )

      if (streaming && (streamText !== '' || streamThinking !== '')) {
        thread.push(
          h(MessageRow, {
            key: 'streaming',
            message: {
              id: 'streaming',
              role: 'assistant',
              thinking: streamThinking,
              content: streamText,
              queries: [],
            },
          }),
        )
      }

      const pill = (key, label, on) =>
        h(
          'button',
          {
            key,
            type: 'button',
            onClick: () => void toggleSetting(key),
            disabled: streaming,
            className: 'mydsw-pill' + (on ? ' mydsw-pill-on' : ''),
            style: {
              padding: '5px 11px',
              borderRadius: '999px',
              fontSize: '12px',
              cursor: streaming ? 'default' : 'pointer',
              border: `1px solid ${on ? COLOR.accent : COLOR.border2}`,
              background: on ? COLOR.layer2 : 'transparent',
              color: on ? COLOR.accent : COLOR.text2,
              fontWeight: on ? 600 : 400,
            },
          },
          label,
        )

      /* 把最新的回调交给侧边栏用。这里必须是「普通赋值」而不是 hook ——
         它待在下面两个 early return（加载中 / 未登录）之后，
         而后面的分支上不允许再多调用 hook（见上面 sideActionsRef 那段注释）。 */
      sideActionsRef.current = {
        create: createConversation,
        rename: renameConversation,
        remove: removeConversation,
        refresh,
        open: (sessionId) => refresh({ preferSessionId: sessionId }),
      }

      return h(
        'div',
        {
          className: 'mydsw-root',
          style: {
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            background: COLOR.bg,
            color: COLOR.text1,
            overflow: 'hidden',
          },
        },
        // 标题行
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 16px',
              borderBottom: `1px solid ${COLOR.border1}`,
              flex: '0 0 auto',
            },
          },
          h('div', { style: { fontSize: '14px', fontWeight: 600 } }, t('panelTitle')),
          h('div', { style: { fontSize: '11px', color: COLOR.text2 } }, t('panelSubtitle')),
          h('div', { style: { flex: '1 1 auto' } }),
          h(
            'button',
            {
              type: 'button',
              onClick: () => void createConversation(),
              disabled: busy || streaming,
              className: 'mydsw-btn mydsw-btn-primary',
              style: {
                padding: '5px 11px',
                borderRadius: '8px',
                border: 'none',
                background: COLOR.accent,
                color: COLOR.onAccent,
                fontSize: '12px',
                fontWeight: 600,
                cursor: busy || streaming ? 'default' : 'pointer',
                opacity: busy || streaming ? 0.6 : 1,
              },
            },
            `＋ ${t('newChat')}`,
          ),
          h(
            'button',
            {
              type: 'button',
              onClick: () => void refresh(),
              disabled: busy,
              className: 'mydsw-btn',
              style: {
                padding: '5px 11px',
                borderRadius: '8px',
                border: `1px solid ${COLOR.border1}`,
                background: 'transparent',
                color: COLOR.text2,
                fontSize: '12px',
                cursor: busy ? 'default' : 'pointer',
              },
            },
            t('refresh'),
          ),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: COLOR.text2 } },
            h('span', {
              style: {
                width: '7px',
                height: '7px',
                borderRadius: '999px',
                background: COLOR.success,
                display: 'inline-block',
              },
            }),
            `${t('connectedAs')}${state.user?.email ? ` · ${state.user.email}` : ''}`,
          ),
          h(
            'button',
            {
              type: 'button',
              onClick: () => void clearToken(),
              disabled: busy,
              className: 'mydsw-btn',
              style: {
                padding: '4px 9px',
                borderRadius: '7px',
                border: `1px solid ${COLOR.border1}`,
                background: 'transparent',
                color: COLOR.text2,
                fontSize: '11px',
                cursor: busy ? 'default' : 'pointer',
              },
            },
            t('loginClear'),
          ),
        ),
        // 主体
        h(
          'div',
          { style: { flex: '1 1 auto', display: 'flex', minHeight: 0 } },
          // 左：对话列表 —— 已经搬到 DSH 侧边栏「工作区」下面了（injectSideSection）。
          // 只有那边注入失败时，这里才把原列表显示出来兜底。
          sideMounted
            ? null
            : h(
            'div',
            {
              style: {
                width: '252px',
                flex: '0 0 auto',
                borderRight: `1px solid ${COLOR.border1}`,
                background: COLOR.sidebar,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
              },
            },
            h(
              'div',
              { style: { display: 'flex', gap: '6px', padding: '10px' } },
              h(
                'button',
                {
                  type: 'button',
                  onClick: () => void createConversation(),
                  disabled: busy || streaming,
                  className: 'mydsw-btn mydsw-btn-primary',
                  style: {
                    flex: '1 1 auto',
                    padding: '7px 10px',
                    borderRadius: '8px',
                    border: 'none',
                    background: COLOR.accent,
                    color: COLOR.onAccent,
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: busy || streaming ? 'default' : 'pointer',
                    opacity: busy || streaming ? 0.6 : 1,
                  },
                },
                `＋ ${t('newChat')}`,
              ),
              h(
                'button',
                {
                  type: 'button',
                  onClick: () => void refresh(),
                  disabled: busy,
                  className: 'mydsw-btn',
                  style: {
                    padding: '7px 10px',
                    borderRadius: '8px',
                    border: `1px solid ${COLOR.border1}`,
                    background: 'transparent',
                    color: COLOR.text2,
                    fontSize: '12px',
                    cursor: busy ? 'default' : 'pointer',
                  },
                },
                t('refresh'),
              ),
            ),
            h(
              'div',
              { style: { flex: '1 1 auto', overflow: 'auto', padding: '0 8px 12px' } },
              sessions.length === 0
                ? h('div', { style: { fontSize: '12px', color: COLOR.text2, padding: '8px 10px' } }, t('emptyConversations'))
                : items,
            ),
          ),
          // 右：消息 + 输入
          h(
            'div',
            { style: { flex: '1 1 auto', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 } },
            h(
              'div',
              { ref: scrollRef, style: { flex: '1 1 auto', overflow: 'auto', padding: '18px 20px 8px' } },
              messages.length === 0 && !streaming
                ? h('div', { style: { fontSize: '13px', color: COLOR.text2 } }, t('emptyThread'))
                : thread,
            ),
            error === ''
              ? null
              : h(
                  'div',
                  {
                    style: {
                      margin: '0 20px 8px',
                      padding: '8px 11px',
                      borderRadius: '9px',
                      background: COLOR.layer1,
                      border: `1px solid ${COLOR.error}`,
                      color: COLOR.error,
                      fontSize: '12px',
                      lineHeight: 1.6,
                      display: 'flex',
                      gap: '8px',
                      alignItems: 'flex-start',
                    },
                  },
                  h('span', { style: { flex: '1 1 auto' } }, error),
                  h(
                    'span',
                    {
                      role: 'button',
                      onClick: () => setError(''),
                      style: { cursor: 'pointer', color: COLOR.text2 },
                    },
                    '✕',
                  ),
                ),
            h(
              'div',
              {
                style: {
                  flex: '0 0 auto',
                  margin: '0 12px 12px',
                  border: `1px solid ${COLOR.border1}`,
                  borderRadius: '16px',
                  padding: '10px 14px 12px',
                  background: COLOR.layer1,
                  WebkitBackdropFilter: 'blur(12px) saturate(140%)',
                  backdropFilter: 'blur(12px) saturate(140%)',
                },
              },
              h(
                'div',
                { style: { display: 'flex', gap: '6px', marginBottom: '8px', alignItems: 'center' } },
                pill('thinking', t('thinking'), state.thinking === true),
                pill('search', t('search'), state.search === true),
                h('div', { style: { flex: '1 1 auto' } }),
                h('span', { style: { fontSize: '11px', color: COLOR.text2 } }, t('note')),
              ),
              images.length === 0
                ? null
                : h(
                    'div',
                    { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' } },
                    images.map((image) =>
                      h(
                        'div',
                        {
                          key: image.key,
                          style: {
                            position: 'relative',
                            width: '58px',
                            height: '58px',
                            borderRadius: '9px',
                            overflow: 'hidden',
                            border: `1px solid ${image.status === 'error' ? COLOR.error : COLOR.border1}`,
                            background: COLOR.layer2,
                          },
                        },
                        h('img', {
                          src: image.previewUrl,
                          alt: image.name,
                          title: image.status === 'error' && image.error !== '' ? image.error : image.name,
                          style: {
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            opacity: image.status === 'uploading' ? 0.5 : 1,
                          },
                        }),
                        h(
                          'span',
                          {
                            role: 'button',
                            title: t('removeImage'),
                            onClick: () => setImages((prev) => prev.filter((item) => item.key !== image.key)),
                            style: {
                              position: 'absolute',
                              top: '1px',
                              right: '1px',
                              width: '16px',
                              height: '16px',
                              borderRadius: '50%',
                              background: 'rgba(0,0,0,0.55)',
                              color: '#fff',
                              fontSize: '11px',
                              lineHeight: '16px',
                              textAlign: 'center',
                              cursor: 'pointer',
                            },
                          },
                          '✕',
                        ),
                        image.status === 'uploading'
                          ? h(
                              'span',
                              {
                                style: {
                                  position: 'absolute',
                                  left: '0',
                                  right: '0',
                                  bottom: '0',
                                  textAlign: 'center',
                                  fontSize: '9px',
                                  color: '#fff',
                                  background: 'rgba(0,0,0,0.5)',
                                },
                              },
                              t('uploading'),
                            )
                          : null,
                        image.status === 'error'
                          ? h(
                              'span',
                              {
                                style: {
                                  position: 'absolute',
                                  left: '0',
                                  right: '0',
                                  bottom: '0',
                                  textAlign: 'center',
                                  fontSize: '9px',
                                  color: '#fff',
                                  background: COLOR.error,
                                },
                              },
                              t('uploadFailed'),
                            )
                          : null,
                      ),
                    ),
                  ),
              h('input', {
                ref: fileInputRef,
                type: 'file',
                accept: 'image/png,image/jpeg,image/webp,image/gif',
                multiple: true,
                style: { display: 'none' },
                onChange: (event) => {
                  addImageFiles(event.target.files)
                  event.target.value = ''
                },
              }),
              h(
                'div',
                { style: { display: 'flex', gap: '8px', alignItems: 'flex-end' } },
                h(
                  'span',
                  {
                    role: 'button',
                    title: `${t('attach')} — ${t('attachHint')}`,
                    onClick: () => {
                      if (fileInputRef.current !== null) fileInputRef.current.click()
                    },
                    style: {
                      flex: '0 0 auto',
                      width: '38px',
                      height: '38px',
                      marginBottom: '7px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '10px',
                      border: `1px solid ${COLOR.border2}`,
                      background: COLOR.layer1,
                      color: COLOR.text2,
                      cursor: 'pointer',
                    },
                  },
                  h(
                    'svg',
                    {
                      width: 18,
                      height: 18,
                      viewBox: '0 0 24 24',
                      fill: 'none',
                      stroke: 'currentColor',
                      strokeWidth: 1.8,
                      strokeLinecap: 'round',
                      strokeLinejoin: 'round',
                    },
                    h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
                    h('circle', { cx: 9, cy: 10, r: 1.6 }),
                    h('path', { d: 'M4 18l5-5 3.5 3.5L16 13l4 4' }),
                  ),
                ),
                h('textarea', {
                  value: draft,
                  onChange: (event) => setDraft(event.target.value),
                  onKeyDown,
                  onPaste: (event) => {
                    const files = event.clipboardData?.files
                    if (files !== undefined && files !== null && files.length > 0) {
                      event.preventDefault()
                      addImageFiles(files)
                    }
                  },
                  placeholder: t('composerPlaceholder'),
                  rows: 2,
                  spellCheck: false,
                  style: {
                    flex: '1 1 auto',
                    resize: 'vertical',
                    minHeight: '52px',
                    maxHeight: '220px',
                    boxSizing: 'border-box',
                    padding: '10px 12px',
                    borderRadius: '11px',
                    border: `1px solid ${COLOR.border2}`,
                    background: COLOR.layer1,
                    color: COLOR.text1,
                    fontSize: '13px',
                    lineHeight: 1.6,
                    outline: 'none',
                    fontFamily: 'inherit',
                  },
                }),
                h(
                  'button',
                  {
                    type: 'button',
                    onClick: () => (streaming ? void stopStream() : void send()),
                    disabled: !streaming && !canSend,
                    className: 'mydsw-btn mydsw-btn-primary',
                    style: {
                      padding: '10px 16px',
                      borderRadius: '11px',
                      border: streaming ? `1px solid ${COLOR.border2}` : 'none',
                      background: streaming ? 'transparent' : COLOR.accent,
                      color: streaming ? COLOR.text1 : COLOR.onAccent,
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: streaming || canSend ? 'pointer' : 'default',
                      opacity: !streaming && !canSend ? 0.55 : 1,
                      whiteSpace: 'nowrap',
                    },
                  },
                  streaming ? t('stop') : t('send'),
                ),
              ),
            ),
          ),
        ),
      )
    }

    /* ---------------------------------------------------------- *
     * 侧边栏「DeepSeek 网页版」分组
     *
     * DSH 的「工作区」区域（sidebar.workspaces）是 single 槽位：插件只能整个
     * 接管它、没法往里追加一个分组，所以这里走 DOM 注入 —— 从插件自己在侧边栏的
     * 入口图标（NAV_ATTR）往上找侧边栏本体，再把这一组插到「工作区」那一块的后面。
     *
     * 锚点全部按「结构 + 几何」找，不写死 DSH 的哈希类名（那些跟着构建变）。
     * 找不到锚点就整段不注入，面板那边会自己把原来的会话列显示出来兜底。
     * ---------------------------------------------------------- */

    const SIDE_EVENT_OPEN = 'mydsw:open'
    /* 侧边栏点开某条对话、但面板还没挂载时，先把 id 存这儿等面板来接。 */
    let pendingOpenId = ''
    /* apply(ctx) 里拿到的 layout 服务，用来把面板切到前台。 */
    let layoutService = null
    /* 也留着 ctx：layout 服务可能是后注册的，需要的时候要能再要一次。 */
    let pluginCtx = null

    const sideBox = {
      node: null,
      mounted: false,
      listeners: new Set(),
      actions: null,
      fetching: false,
      /* 已经稳稳插在「最后一行」后面了吗（是的话轮询就不必再算了）。 */
      placedWell: false,
      /* 插件区那一行入口里被我们藏起来的那颗 DOM（藏过就不再重复处理）。 */
      hiddenRow: null,
      data: { ready: false, hasToken: false, sessions: [], selected: '' },
      /* 面板订阅读「注入成没成」这个状态，成了它就不在面板里再显示一列。 */
      subscribe(listener) {
        sideBox.listeners.add(listener)
        return () => {
          sideBox.listeners.delete(listener)
        }
      },
    }

    function takePendingOpen() {
      const value = pendingOpenId
      pendingOpenId = ''
      return value
    }

    function sideEmit() {
      const listeners = Array.from(sideBox.listeners)
      for (const listener of listeners) {
        try {
          listener(sideBox.mounted)
        } catch {
          /* 某个订阅者出错不影响别的订阅者 */
        }
      }
    }

    function mkEl(tag, props, ...children) {
      const node = document.createElement(tag)
      const options = props ?? {}
      for (const key of Object.keys(options)) {
        const value = options[key]
        if (value === null || value === undefined || value === false) continue
        if (key === 'class') node.className = String(value)
        else if (key === 'text') node.textContent = String(value)
        else if (key === 'onClick') node.addEventListener('click', value)
        else if (key === 'onKeyDown') node.addEventListener('keydown', value)
        else node.setAttribute(key, String(value))
      }
      for (const child of children) {
        if (child === null || child === undefined || child === false) continue
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child)
      }
      return node
    }

    /* 取 layout 服务。服务可能是后注册的，所以每次用之前都再试一次。 */
    function resolveLayout() {
      if (layoutService !== null) return layoutService
      const ctx = pluginCtx
      if (ctx === null) return null
      try {
        const found = typeof ctx.get === 'function' ? ctx.get('layout') : ctx.layout
        if (found !== null && found !== undefined) {
          layoutService = found
          return found
        }
      } catch {
        /* 服务还没就绪，下次再试 */
      }
      return null
    }

    /* 把中央面板切到插件这一页。
       先问 layout 服务（这是「选中」不是「切换」，重复调用是幂等的）；
       服务拿不到时才退而点一下我们自己那个侧边栏入口——那个按钮由 DSH 渲染，
       点它等价于用户自己去点。allowDom 只在面板确实没挂载时才放行。 */
    function sideFocus(allowDom) {
      const layout = resolveLayout()
      let called = false
      if (layout !== null && typeof layout.selectPanel === 'function') {
        try {
          layout.selectPanel(PANEL_ID)
          called = true
        } catch {
          /* 这个服务对没注册的 key 会抛错，抛了就往下走兜底 */
        }
      }
      const shown = () => document.querySelector('.mydsw-root') !== null
      if (called && shown()) return
      if (allowDom !== true) return
      const clickEntry = () => {
        try {
          const nav = document.querySelector('[' + NAV_ATTR + ']')
          const button = nav === null ? null : nav.closest('button, a, [role="button"], [tabindex]')
          if (button !== null && typeof button.click === 'function') button.click()
        } catch {
          /* 点不动就算了，面板本身还开着 */
        }
      }
      if (called) {
        /* selectPanel 不抛错，不代表面板真被带出来了 —— 它可能悄悄 no-op。
           等一拍再看根节点在不在；不在就从 DOM 上补点一次 DSH 自己的入口。
           这一拍必须延后：React 渲染是异步的，同步检查一定看不到东西，
           会误判成失败而多点一下，那一下正好把刚打开的面板又切回去。 */
        window.setTimeout(() => {
          if (!shown()) clickEntry()
        }, 220)
        return
      }
      clickEntry()
    }

    function sideOpen(sessionId) {
      /* pendingOpenId 是唯一真相：不管面板此刻在不在、会不会重挂，
         只要有一个面板实例 refresh 一次，就能把这条会话打开。 */
      pendingOpenId = sessionId
      sideBox.data.selected = sessionId
      renderSideSection()
      const actions = sideBox.actions
      if (actions !== null && typeof actions.open === 'function') {
        /* 面板已经挂着：幂等地把它切到前台，然后让它自己开，省掉事件接力那一跳 */
        sideFocus(false)
        actions.open(sessionId)
        return
      }
      /* 面板还没挂：先把它切出来（允许点侧边栏入口兜底），
         挂载时的 refresh() 会从 pendingOpenId 里把这条会话接住 */
      sideFocus(true)
      try {
        window.dispatchEvent(new CustomEvent(SIDE_EVENT_OPEN, { detail: { sessionId } }))
      } catch {
        /* 事件没送到也无所谓：面板挂载时的 refresh() 会从 pendingOpenId 里取 */
      }
    }

    function sideRow(session) {
      const active = String(session.id) === String(sideBox.data.selected)
      const row = mkEl('div', {
        class: 'mydsw-side-row' + (active ? ' mydsw-side-row-active' : ''),
        role: 'button',
        tabindex: '0',
        title: String(session.title ?? ''),
        onClick: (event) => {
          event.preventDefault()
          /* 这块节点住在 DSH 侧边栏里面，点它绝不能冒泡到 DSH 自己的
             侧边栏逻辑上 —— 否则它可能顺手把主面板切回会话列表。 */
          event.stopPropagation()
          sideOpen(session.id)
        },
        onKeyDown: (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          event.stopPropagation()
          sideOpen(session.id)
        },
      })
      row.appendChild(mkEl('span', { class: 'mydsw-side-row-title', text: String(session.title ?? '') }))
      const tools = mkEl('span', { class: 'mydsw-side-tools' })
      tools.appendChild(
        mkEl('span', {
          class: 'mydsw-side-tool',
          role: 'button',
          tabindex: '0',
          text: t('rename'),
          onClick: (event) => {
            event.stopPropagation()
            sideInvoke('rename', session.id, session.title)
          },
        }),
      )
      tools.appendChild(
        mkEl('span', {
          class: 'mydsw-side-tool mydsw-side-tool-del',
          role: 'button',
          tabindex: '0',
          text: t('del'),
          onClick: (event) => {
            event.stopPropagation()
            sideInvoke('remove', session.id)
          },
        }),
      )
      row.appendChild(tools)
      row.appendChild(mkEl('span', { class: 'mydsw-side-time', text: formatTime(session.updatedAt) }))
      return row
    }

    function renderSideSection() {
      const root = sideBox.node
      if (root === null) return
      const data = sideBox.data

      const head = mkEl('div', { class: 'mydsw-side-head' })
      head.appendChild(mkEl('span', { class: 'mydsw-side-title', text: t('nav') }))

      const list = mkEl('div', { class: 'mydsw-side-list' })
      if (data.ready === true && data.hasToken === false) {
        list.appendChild(mkEl('div', { class: 'mydsw-side-empty', text: t('loginTitle') }))
      } else if (data.ready === true && data.sessions.length === 0) {
        list.appendChild(mkEl('div', { class: 'mydsw-side-empty', text: t('emptyConversations') }))
      } else {
        for (const session of data.sessions) list.appendChild(sideRow(session))
      }

      head.appendChild(mkEl('span', { class: 'mydsw-side-gap' }))
      head.appendChild(
        mkEl('button', {
          type: 'button',
          class: 'mydsw-side-act',
          title: t('refresh'),
          'aria-label': t('refresh'),
          text: '⟳',
          onClick: (event) => {
            event.preventDefault()
            event.stopPropagation()
            sideInvoke('refresh')
          },
        }),
      )
      head.appendChild(
        mkEl('button', {
          type: 'button',
          class: 'mydsw-side-act',
          title: t('newChat'),
          'aria-label': t('newChat'),
          text: '＋',
          onClick: (event) => {
            event.preventDefault()
            event.stopPropagation()
            sideFocus(true)
            sideInvoke('create')
          },
        }),
      )

      root.textContent = ''
      root.appendChild(head)
      root.appendChild(list)

    }

    /* 面板没挂载时的兜底：直接走宿主 RPC。 */
    async function sideFallback(kind, sessionId, title) {
      try {
        if (kind === 'create') {
          await rpc('create')
        } else if (kind === 'rename') {
          if (typeof window === 'undefined') return
          const next = window.prompt(t('newTitle'), title)
          if (typeof next !== 'string' || next.trim() === '') return
          await rpc('rename', { sessionId, title: next.trim() })
        } else if (kind === 'remove') {
          if (typeof window !== 'undefined' && !window.confirm(t('confirmDelete'))) return
          await rpc('remove', { sessionId })
        }
      } catch {
        return
      }
      await sideFetch()
    }

    function sideInvoke(kind, sessionId, title) {
      const actions = sideBox.actions
      const run =
        kind === 'refresh'
          ? actions !== null
            ? actions.refresh
            : sideFetch
          : kind === 'create'
            ? actions !== null
              ? actions.create
              : () => sideFallback('create', '', '')
            : kind === 'rename'
              ? actions !== null
                ? () => actions.rename(sessionId, title)
                : () => sideFallback('rename', sessionId, title)
              : kind === 'remove'
                ? actions !== null
                  ? () => actions.remove(sessionId)
                  : () => sideFallback('remove', sessionId, '')
                : null
      if (run === null) return
      Promise.resolve()
        .then(() => run())
        .catch(() => {
          /* 出错由面板那边统一提示 */
        })
        .then(() => {
          /* 面板没在挂载时，自己把列表刷新回来 */
          if (sideBox.actions === null) void sideFetch()
        })
    }

    async function sideFetch() {
      if (sideBox.fetching) return
      sideBox.fetching = true
      try {
        const result = await rpc('sessions', { limit: 60 })
        sideBox.data.hasToken = result?.hasToken === true
        sideBox.data.sessions = Array.isArray(result?.sessions) ? result.sessions : []
        sideBox.data.ready = true
        if (typeof result?.selectedSessionId === 'string' && result.selectedSessionId !== '') {
          sideBox.data.selected = result.selectedSessionId
        }
        renderSideSection()
      } catch {
        /* 宿主没连上就先空着 */
      } finally {
        sideBox.fetching = false
      }
    }

    /* 从入口图标往上找侧边栏本体：贴着左边、够高、又不占满整屏的那个祖先。 */
    function sideFindSidebar(nav) {
      const viewportWidth = window.innerWidth || 0
      const viewportHeight = window.innerHeight || 0
      const maxRight = Math.max(420, viewportWidth * 0.62)
      let node = nav
      let root = null
      while (node !== null && node !== document.body && node !== document.documentElement) {
        const rect = node.getBoundingClientRect()
        if (
          rect.left <= 8 &&
          rect.width >= 140 &&
          rect.right <= maxRight &&
          rect.height >= viewportHeight * 0.5
        ) {
          root = node
        }
        node = node.parentElement
      }
      return root
    }

    /* 插件入口所在的「插件」分区后面，跟着的那个大块就是「工作区」分区。 */
    function sideFindAnchor(nav, root) {
      const rootRight = root.getBoundingClientRect().right + 8
      let node = nav
      for (let depth = 0; depth < 12 && node !== null && node !== root; depth += 1) {
        const parent = node.parentElement
        if (parent === null) break
        const kids = Array.from(parent.children)
        const index = kids.indexOf(node)
        if (index >= 0) {
          const parentWidth = parent.getBoundingClientRect().width
          for (const sibling of kids.slice(index + 1)) {
            if (sibling === sideBox.node) continue
            const rect = sibling.getBoundingClientRect()
            if (rect.height > 80 && rect.width >= parentWidth * 0.5 && rect.right <= rootRight) {
              return sibling
            }
          }
        }
        node = parent
      }
      return null
    }

    /* 侧边栏里「工作区」那一块：先按几何找入口图标后面的第一个大块，
       找不到就退而取滚动区里最后一个大块。 */
    function sideFindRegion(nav, root) {
      const anchor = sideFindAnchor(nav, root)
      if (anchor !== null) return anchor
      const scroller = sideFindScroller(nav, root)
      const scope = scroller ?? root
      const width = scope.getBoundingClientRect().width
      /* 连滚动区都没认出来时，跳过侧边栏最后一个子块（那是底部的账号/设置区） */
      const kids = Array.from(scope.children).filter((child) => child !== sideBox.node)
      const list = scroller === null && kids.length > 1 ? kids.slice(0, kids.length - 1) : kids
      let last = null
      for (const child of list) {
        const rect = child.getBoundingClientRect()
        if (rect.height > 60 && rect.width >= width * 0.5) last = child
      }
      return last
    }

    /* 找出这一块里「屏幕上最靠下的那一行」，插在它后面就紧贴内容。
       原来按文档顺序取最后一个高度合适的元素，会踩两个坑：
         · 只放一条会话的工作区（标题行 + 会话行 ≈ 70 多像素）整体也落在
           高度窗口里，被当成「一行」，于是插到了整个区块末尾 —— 而那一块
           是撑满侧边栏的，中间就空出一大截；
         · 窄布局下按「区域宽度一半」算阈值会整片失配。
       改成看下边缘之后：容器因高度超窗不会入选但会继续递归；会话行比它
       内部的小标题先被访问、下边缘又一样低，先记下的正是整行本身。 */
    function sideFindLastRow(region) {
      const regionRect = region.getBoundingClientRect()
      let best = null
      let bestBottom = -Infinity
      const walk = (node) => {
        for (const child of node.children) {
          if (child === sideBox.node) continue
          const rect = child.getBoundingClientRect()
          if (
            rect.height >= 16 &&
            rect.height <= 60 &&
            rect.width >= 80 &&
            rect.bottom <= regionRect.bottom + 1 &&
            rect.bottom > bestBottom &&
            /* 必须是有字的一行。那一块里还躺着一条 24px 高的底部渐变
               （SPAN._91TDKa_fade）和一个撑满高度的空壳（.UpTDga_exits），
               它们没有文字，可是下边缘比任何会话行都低 —— 不加这一条就会被挑中，
               分组于是被插到渐变后面，也就是整个侧边栏的最底下。 */
            String(child.textContent || '').trim() !== ''
          ) {
            bestBottom = rect.bottom
            best = child
          }
          walk(child)
        }
      }
      walk(region)
      return best
    }

    /* 找不到「工作区」分区时的退路：塞进侧边栏的滚动区末尾。 */
    function sideFindScroller(nav, root) {
      let node = nav
      let fallback = null
      while (node !== null && node !== root) {
        const style = getComputedStyle(node)
        if (/(auto|scroll|overlay)/.test(String(style.overflowY))) {
          if (node.scrollHeight > node.clientHeight + 2) return node
          if (fallback === null) fallback = node
        }
        node = node.parentElement
      }
      return fallback
    }

    /* 这一块是不是「一行高」的东西（会话行 / 工作区名…）。 */
    function sideRowLike(element) {
      if (element === null || element === undefined) return false
      try {
        const rect = element.getBoundingClientRect()
        return rect.height >= 14 && rect.height <= 76 && rect.width >= 40
      } catch {
        return false
      }
    }

    /* 把插件区里那一行入口藏起来。
       注册不能删：layout.selectPanel(id) 靠它把面板带到前台，[data-mydsw-nav]
       也是找侧边栏结构的唯一锚点，服务万一失灵时还得靠点它兜底。
       所以只给那一行加个属性，用 CSS 藏掉；React 重挂那一行时属性会丢，
       轮询里会补回来。 */
    function sideHideEntry(nav) {
      if (typeof nav.closest !== 'function') return
      const row = nav.closest('button, a, [role="button"], [tabindex]')
      if (row === null || row === sideBox.hiddenRow) return
      try {
        /* 只藏「一行」：万一 closest 抓到的是整个分区容器，高度会明显更大 */
        if (row.getBoundingClientRect().height > 72) return
      } catch {
        return
      }
      row.setAttribute(HIDE_ATTR, '')
      sideBox.hiddenRow = row
    }

    function sideEnsure() {
      if (typeof document === 'undefined' || document.body === null) return
      const nav = document.querySelector(`[${NAV_ATTR}]`)
      if (nav === null) {
        if (sideBox.node !== null) sideBox.node.remove()
        sideBox.node = null
        if (sideBox.mounted) {
          sideBox.mounted = false
          sideEmit()
        }
        return
      }
      sideHideEntry(nav)
      const root = sideFindSidebar(nav)
      if (root === null) return
      if (sideBox.node === null) sideBox.node = mkEl('div', { [SIDE_ATTR]: '', class: 'mydsw-side' })
      const wasConnected = sideBox.node.isConnected

      /* 只在「还没放稳 / 被 DSH 删了 / 我们后面又多出一行」时才重算位置。
         不能在 isConnected 时直接返回：插件启动那一瞬间 DSH 的工作区列表
         往往还没渲染出来，那时找不到「最后一行」，会先落到页脚上面，
         之后再没人搬它 —— 表现就是分组一直贴在页脚上。 */
      const needSearch =
        wasConnected !== true ||
        sideBox.placedWell !== true ||
        sideRowLike(sideBox.node.nextElementSibling)

      if (needSearch) {
        const region = sideFindRegion(nav, root)
        const lastRow = region === null ? null : sideFindLastRow(region)
        if (lastRow !== null) {
          /* 「工作区」那一块会把侧边栏剩下的高度全占了，直接插在它后面会被
             顶到最底下、中间空一大截。所以插在这块里最后一行后面。 */
          if (sideBox.node.previousElementSibling !== lastRow) {
            lastRow.insertAdjacentElement('afterend', sideBox.node)
          }
          sideBox.placedWell = true
        } else if (region !== null) {
          if (sideBox.node.previousElementSibling !== region) {
            region.insertAdjacentElement('afterend', sideBox.node)
          }
          sideBox.placedWell = false
        } else {
          const host = sideFindScroller(nav, root) ?? root
          if (sideBox.node.parentElement !== host) host.appendChild(sideBox.node)
          sideBox.placedWell = false
        }
      }

      /* 刚接上才整段重画；已经挂好的时候轮询只刷新诊断那一行，
         否则每 0.8 秒重建一次 DOM，鼠标悬停会被打断。 */
      if (wasConnected !== true && sideBox.node.isConnected) renderSideSection()
      if (sideBox.node.isConnected && !sideBox.mounted) {
        sideBox.mounted = true
        sideEmit()
      }
    }

    function startSideSection() {
      if (typeof document === 'undefined') return () => {}
      sideEnsure()
      if (sideBox.data.ready !== true) void sideFetch()
      /* 轮询而不是 MutationObserver：面板流式输出时会疯狂改 DOM，
         观察整棵 body 代价太大，这里每次只读一下 isConnected。 */
      const timer = setInterval(sideEnsure, 800)
      return () => {
        clearInterval(timer)
        if (sideBox.node !== null) sideBox.node.remove()
        sideBox.node = null
        if (sideBox.mounted) {
          sideBox.mounted = false
          sideEmit()
        }
      }
    }

    /* ---------------------------------------------------------- *
     * 注册
     * ---------------------------------------------------------- */

    function apply(ctx) {
      const slots = ctx.slots
      pluginCtx = ctx
      ctx.effect(() => acquireThemeStyle(), 'deepseek-web: 主题适配样式')
      // layout 是可选的：现在取不到也没关系，sideFocus() 用之前会再要一次
      resolveLayout()
      ctx.effect(() => {
        const stop = startSideSection()
        return () => {
          stop()
          layoutService = null
          pluginCtx = null
        }
      }, 'deepseek-web: 侧边栏会话分组')
      ctx.effect(
        () =>
          slots.inject('sidebar.panellist', () =>
            slots.register(
              {
                name: 'sidebar.panellist',
                id: PANEL_ID,
                order: 30,
                label: () => t('nav'),
              },
              PanelIcon,
            ),
          ),
        'deepseek-web: 侧边栏面板入口',
      )
      ctx.effect(
        () =>
          slots.inject('main', () =>
            slots.register({ name: 'main', key: PANEL_ID }, Panel),
          ),
        'deepseek-web: 主面板',
      )
    }

    return { inject: ['slots'], apply }
  },
})
