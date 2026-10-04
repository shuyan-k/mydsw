/**
 * @c7sh8y9/mydsw —— Host 半边。
 *
 * 把 chat.deepseek.com 的网页版协议（PoW 挑战 + SSE 增量补丁）搬进 DSH：
 *   1) 在宿主 HTTP 载体上注册同源路由 `/deepseek-web/*`，给浏览器半边的面板用；
 *   2) 注册一个 `deepseek_web` 工具，让 Agent 也能读/发网页版对话。
 *
 * 为什么走自己的 HTTP 路由：静态 client 半边只能 `require` 到平台 seed 模块
 * （react / react-dom / slots / primitives），既没有 `host.call`，也不能自己造
 * `ctx.remote` 命名空间（Remote 能力集是构建期固定的）。生态里装进 profile 的
 * 三方插件（dsh-market、dsh-deepseek-web-login）都是 `fetch` 打宿主路由。
 * 代价是这类 `webServer.register` 的精确/前缀路由会**先于** `/api` 前缀围栏命中，
 * 于是必须自己做同源判定（见 requestAllowed）。
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, join } from 'node:path'
import { buildPowHeader } from './lib/pow.js'

export const name = 'deepseek-web'

const ROUTE_PREFIX = '/deepseek-web'
const WEB_ORIGIN = 'https://chat.deepseek.com'
const COMPLETION_PATH = '/api/v0/chat/completion'
const CHALLENGE_PATH = '/api/v0/chat/create_pow_challenge'
const UPLOAD_PATH = '/api/v0/file/upload_file'
const FETCH_FILES_PATH = '/api/v0/file/fetch_files'
const TARGET_PATH = COMPLETION_PATH

const MAX_BODY_BYTES = 512 * 1024
// /rpc 要送 base64 图片（base64 比原文件大 1/3），所以 RPC 的请求体上限单独放宽。
const MAX_RPC_BODY_BYTES = 16 * 1024 * 1024
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
/** 一条消息最多带几张图：网页端对一批 ref_file_ids 有上限，超了会整轮（且此后每轮）失败。 */
const MAX_IMAGES_PER_MESSAGE = 8
const UPLOAD_POLL_INTERVAL_MS = 1_000
const UPLOAD_POLL_MAX_ATTEMPTS = 60
/** 网页端按**文件名后缀**判图片类型，multipart 里的 content-type 不作数。 */
const IMAGE_MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}
const FILE_SUCCESS_STATUSES = new Set(['SUCCESS', 'processed', 'ready'])
const FILE_FAILED_STATUSES = new Set(['FAILED', 'failed'])
const REQUEST_TIMEOUT_MS = 60_000
const POW_TIMEOUT_MS = 30_000

const BASE_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  accept: 'application/json, text/plain, */*',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  origin: WEB_ORIGIN,
  referer: `${WEB_ORIGIN}/`,
  'x-client-platform': 'web',
  'x-client-version': '2.0.0',
  'x-app-version': '2.0.0',
  'x-client-locale': 'zh_CN',
  'x-client-timezone-offset': String(-new Date().getTimezoneOffset() * 60),
}

/** SSE 里必须忽略的噪声路径（沿用网页端协议的既有结论）。 */
const SKIP_PATH_CONTAINS = [
  'quasi_status',
  'elapsed_secs',
  'token_usage',
  'pending_fragment',
  'conversation_mode',
  'fragments/-1/status',
  'fragments/-2/status',
  'fragments/-3/status',
]
const SKIP_PATH_EXACT = ['response/search_status']

class DeepSeekError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'DeepSeekError'
    this.code = code
  }
}

class TokenError extends DeepSeekError {
  constructor(message) {
    super(message, 40002)
    this.name = 'TokenError'
    this.needToken = true
  }
}

/** 网页端说这个 chat_session_id 已经不存在（被删 / 换了账号）：可以新建会话重发。 */
class SessionExpiredError extends DeepSeekError {
  constructor(message) {
    super(message, 40001)
    this.name = 'SessionExpiredError'
    this.sessionExpired = true
  }
}

/* ------------------------------------------------------------------ *
 * 同源围栏（对齐 @deepseek-ai/dsh-client-connection 与 dsh-market 的规则）
 * ------------------------------------------------------------------ */

function loopbackAuthority(host) {
  if (typeof host !== 'string') return false
  const lower = host.toLowerCase()
  const bracket = lower.startsWith('[') ? lower.indexOf(']') : -1
  const name = bracket > 0 ? lower.slice(0, bracket + 1) : lower.split(':')[0]
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]'
}

function declaredAuthority(host, trustedHosts) {
  let hostUrl
  try {
    const url = new URL(`http://${host}`)
    hostUrl = url.port === '' ? url.hostname : `${url.hostname}:${url.port}`
  } catch {
    return false
  }
  return trustedHosts.some((entry) => {
    try {
      const url = new URL(`http://${entry}`)
      const canonical = url.port === '' ? url.hostname : `${url.hostname}:${url.port}`
      return canonical === hostUrl
    } catch {
      return false
    }
  })
}

/**
 * 只放行「本机页面」发出的请求：
 *   - Host 缺失要放行（Desktop 版的内置代理会剥掉 host/origin/cookie 再转发）；
 *   - Host 存在时必须是 loopback，或运维显式声明的 trustedHosts（防 DNS rebinding）；
 *   - sec-fetch-site: cross-site 直接拒；
 *   - Origin 缺失放行，存在则必须与 Host 同源（`null` / 空值视为不合法的存在）。
 */
function requestAllowed(request, trustedHosts) {
  const host = request.headers.host
  if (host !== undefined && !loopbackAuthority(host) && !declaredAuthority(host, trustedHosts)) return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  if (origin === '' || origin === 'null') return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

async function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw new DeepSeekError('请求体过大')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  return JSON.parse(text)
}

/* ------------------------------------------------------------------ *
 * 本地状态：登录态 + 面板开关 + 每个会话的 parent_message_id
 * ------------------------------------------------------------------ */

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function stateDir() {
  return join(dshHome(), 'deepseek-web')
}

function writeStateFile(file, value) {
  mkdirSync(stateDir(), { recursive: true })
  writeFileSync(file, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 })
}

function readStateFile(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function createStore() {
  const tokenPath = join(stateDir(), 'token.json')
  const settingsPath = join(stateDir(), 'settings.json')
  const parentsPath = join(stateDir(), 'parents.json')

  const savedToken = readStateFile(tokenPath)
  const savedSettings = readStateFile(settingsPath)
  const parents = readStateFile(parentsPath)

  return {
    token:
      typeof savedToken?.token === 'string' && savedToken.token !== ''
        ? savedToken.token
        : (process.env.DEEPSEEK_WEB_TOKEN || '').trim(),
    user: savedToken?.user ?? null,
    thinking: savedSettings?.thinking ?? true,
    search: savedSettings?.search ?? false,
    modelType: savedSettings?.modelType ?? null,
    selectedSessionId: null,
    parents: parents && typeof parents === 'object' ? parents : {},
    /** 正在跑的补全（用于「停止」）。 */
    inflight: null,
    setToken(token, user) {
      this.token = token
      this.user = user ?? null
      writeStateFile(tokenPath, { token, user: this.user, savedAt: new Date().toISOString() })
    },
    clearToken() {
      this.token = ''
      this.user = null
      writeStateFile(tokenPath, { token: '', user: null, savedAt: new Date().toISOString() })
    },
    setSettings(patch) {
      if (typeof patch.thinking === 'boolean') this.thinking = patch.thinking
      if (typeof patch.search === 'boolean') this.search = patch.search
      if (patch.modelType === null || typeof patch.modelType === 'string') this.modelType = patch.modelType
      writeStateFile(settingsPath, {
        thinking: this.thinking,
        search: this.search,
        modelType: this.modelType,
      })
    },
    setParent(sessionId, messageId) {
      if (typeof sessionId !== 'string' || sessionId === '') return
      if (messageId === null || messageId === undefined) delete this.parents[sessionId]
      else this.parents[sessionId] = messageId
      writeStateFile(parentsPath, this.parents)
    },
    parentOf(sessionId) {
      const value = this.parents[sessionId]
      return typeof value === 'number' ? value : null
    },
  }
}

/* ------------------------------------------------------------------ *
 * chat.deepseek.com 网页版接口
 * ------------------------------------------------------------------ */

function requireToken(store) {
  const token = (store.token || '').trim()
  if (token === '') {
    throw new TokenError('还没有配置 chat.deepseek.com 的 userToken，请先在面板里粘贴一次。')
  }
  return token
}

async function rawRequest(store, path, { method = 'POST', body, token, headers = {}, timeoutMs = REQUEST_TIMEOUT_MS, signal } = {}) {
  const bearer = token ?? requireToken(store)
  const requestHeaders = { ...BASE_HEADERS, authorization: `Bearer ${bearer}`, ...headers }
  if (body !== undefined) requestHeaders['content-type'] = 'application/json'

  // timeoutMs <= 0：不设超时（流式补全会一直开着，直到网页端自己结束）。
  const timeout = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : null
  const composed = timeout === null ? signal : signal === undefined ? timeout : AbortSignal.any([signal, timeout])

  let response
  try {
    response = await fetch(`${WEB_ORIGIN}${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: composed,
    })
  } catch (error) {
    throw new DeepSeekError(`连不上 chat.deepseek.com：${error?.message ?? error}`)
  }
  return response
}

/**
 * 解开 `{code, msg, data:{biz_code, biz_msg, biz_data}}` 两层包装。
 *
 * 两层都要查：HTTP 200 + `code:0` 但 **`biz_code` 非 0** 是线上真实存在的失败形态
 * （实测 `{"code":0,"data":{"biz_code":1,"biz_msg":"invalid chat session id","biz_data":null}}`
 * 直接以 application/json 返回），只查外层会把它当成「空回答」静默吞掉。
 */
function bizData(json, action) {
  const code = json?.code
  if (code !== 0) {
    const message = json?.msg || json?.biz_msg || ''
    if (code === 40002 || code === 40003) {
      throw new TokenError(`登录态无效或已过期（code=${code} ${message}）。请重新粘贴 userToken。`)
    }
    throw new DeepSeekError(`${action}失败：code=${code} ${message}`.trim(), code)
  }
  const envelope = json?.data ?? null
  const bizCode = envelope === null ? undefined : envelope.biz_code
  if (typeof bizCode === 'number' && bizCode !== 0) {
    const message = String(envelope.biz_msg ?? json?.msg ?? '')
    if (message.includes('invalid chat session')) {
      throw new SessionExpiredError(`${action}失败：网页端说这个对话不存在了（${message}）`)
    }
    if (message.includes('频繁')) {
      throw new DeepSeekError(`${action}失败：${message}（账号级限流，至少等 20 秒再发）`, bizCode)
    }
    if (message.includes('稍后再试')) {
      throw new DeepSeekError(`${action}失败：${message}（同一账号同时只能有一条生成在跑，等几秒再发）`, bizCode)
    }
    throw new DeepSeekError(`${action}失败：biz_code=${bizCode} ${message}`.trim(), bizCode)
  }
  if (envelope !== null && 'biz_data' in envelope) return envelope.biz_data
  return json?.biz_data ?? envelope ?? null
}

async function jsonRequest(store, path, options) {
  const response = await rawRequest(store, path, options)
  const text = await response.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new DeepSeekError(`网页端返回了非 JSON 响应（HTTP ${response.status}）：${text.slice(0, 200)}`)
  }
  if (!response.ok && (json?.code === undefined || json.code === 0)) {
    throw new DeepSeekError(`网页端返回 HTTP ${response.status}`)
  }
  return json
}

function normalizeSession(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const id = raw.id ?? raw.chat_session_id
  if (typeof id !== 'string' || id === '') return null
  const stamp = Number(raw.updated_at)
  const updatedAt = Number.isFinite(stamp) && stamp > 0 ? (stamp > 1e12 ? stamp : stamp * 1000) : null
  return {
    id,
    title: typeof raw.title === 'string' && raw.title !== '' ? raw.title : '（无标题对话）',
    updatedAt,
    pinned: raw.pinned === true,
    modelType: typeof raw.model_type === 'string' ? raw.model_type : null,
  }
}

/**
 * 线上真实的 fragment 类型比文档里写的多。实测一次回答的片段序列是
 * [THINK, TOOL_SEARCH, THINK, TOOL_OPEN×5, THINK, TOOL_SEARCH, THINK, RESPONSE]，
 * 用户消息则只有一个 REQUEST（正文就在它的 content 里，消息体本身没有 content 字段）。
 * 所以按前缀统一归类，避免把 TOOL_OPEN（打开网页）的正文混进回答，也避免漏掉用户消息。
 */
function classifyFragment(fragment) {
  const type = String(fragment?.type ?? '').toUpperCase()
  if (type.startsWith('THINK')) return 'thinking'
  if (type.startsWith('TOOL')) return type.includes('SEARCH') ? 'search' : 'tool'
  if (type.startsWith('SEARCH')) return 'search'
  if (type.startsWith('REQUEST')) return 'request'
  return 'content'
}

function fragmentText(fragments, kind) {
  let text = ''
  for (const fragment of fragments) {
    const cls = classifyFragment(fragment)
    if (kind === 'thinking' && cls !== 'thinking') continue
    if (kind === 'search' && cls !== 'search') continue
    // 正文只收 RESPONSE（以及尚未标类型的片段）和 REQUEST（用户那条消息的正文）；
    // THINK/TOOL_*/SEARCH 一律不算正文。
    if (kind === 'content' && cls !== 'content' && cls !== 'request') continue
    if (typeof fragment?.content === 'string') text += fragment.content
  }
  return text
}

function fragmentQueries(fragments) {
  const queries = []
  for (const fragment of fragments) {
    if (classifyFragment(fragment) !== 'search') continue
    for (const query of fragment?.queries ?? []) {
      const text = typeof query === 'string' ? query : (query?.query ?? query?.content ?? query?.text)
      if (typeof text === 'string' && text !== '') queries.push(text)
    }
  }
  return queries
}

function normalizeMessage(raw) {
  const fragments = Array.isArray(raw?.fragments) ? raw.fragments : []
  const role = String(raw?.role ?? '').toUpperCase() === 'USER' ? 'user' : 'assistant'
  return {
    id: typeof raw?.message_id === 'number' ? raw.message_id : (raw?.id ?? null),
    role,
    status: typeof raw?.status === 'string' ? raw.status : null,
    thinking: fragmentText(fragments, 'thinking'),
    content: fragmentText(fragments, 'content'),
    queries: fragmentQueries(fragments),
  }
}

async function fetchCurrentUser(store, token) {
  let lastError
  // GET /users/current 是零配额的只读探活，优先用它；POST 仅作老部署的后备。
  for (const attempt of [{ method: 'GET' }, { method: 'POST', body: {} }]) {
    try {
      const json = await jsonRequest(store, '/api/v0/users/current', { ...attempt, token })
      return bizData(json, '校验登录态')
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new DeepSeekError('校验登录态失败')
}

async function listSessions(store, limit = 50) {
  const params = new URLSearchParams({ 'lte_cursor.pinned': 'false', count: String(limit) })
  const json = await jsonRequest(store, `/api/v0/chat_session/fetch_page?${params.toString()}`, { method: 'GET' })
  const biz = bizData(json, '读取对话列表')
  const list = Array.isArray(biz?.chat_sessions) ? biz.chat_sessions : Array.isArray(biz?.sessions) ? biz.sessions : []
  return {
    sessions: list.map(normalizeSession).filter(Boolean),
    hasMore: biz?.has_more === true,
  }
}

async function createSession(store) {
  const json = await jsonRequest(store, '/api/v0/chat_session/create', { method: 'POST', body: {} })
  const biz = bizData(json, '新建对话')
  const session = normalizeSession(biz?.chat_session ?? biz)
  if (session === null) throw new DeepSeekError('新建对话失败：网页端没有返回对话 id')
  return session
}

async function historyMessages(store, sessionId) {
  const json = await jsonRequest(
    store,
    `/api/v0/chat/history_messages?chat_session_id=${encodeURIComponent(sessionId)}`,
    { method: 'GET' },
  )
  const biz = bizData(json, '读取对话历史')
  const messages = Array.isArray(biz?.chat_messages) ? biz.chat_messages : []
  const normalized = messages.map(normalizeMessage)
  const last = messages[messages.length - 1]
  const lastId = typeof last?.message_id === 'number' ? last.message_id : null
  if (lastId !== null) store.setParent(sessionId, lastId)
  return { session: normalizeSession(biz?.chat_session), messages: normalized }
}

async function renameSession(store, sessionId, title) {
  const json = await jsonRequest(store, '/api/v0/chat_session/update_title', {
    method: 'POST',
    body: { chat_session_id: sessionId, title },
  })
  bizData(json, '重命名对话')
  return { ok: true }
}

async function deleteSession(store, sessionId) {
  const json = await jsonRequest(store, '/api/v0/chat_session/delete', {
    method: 'POST',
    body: { chat_session_id: sessionId },
  })
  bizData(json, '删除对话')
  store.setParent(sessionId, null)
  if (store.selectedSessionId === sessionId) store.selectedSessionId = null
  return { ok: true }
}

/* ------------------------------------------------------------------ *
 * 补全：PoW 头 + SSE 增量补丁 -> 统一事件流
 * ------------------------------------------------------------------ */

/** 指纹头（best-effort）：拿不到就不带，失败不影响主流程。 */
let hifCache = { value: null, at: 0 }
async function hifTokens() {
  if (hifCache.value !== null && Date.now() - hifCache.at < 10 * 60_000) return hifCache.value
  const read = async (host) => {
    try {
      const response = await fetch(`${host}/query`, {
        headers: { ...BASE_HEADERS },
        redirect: 'error',
        signal: AbortSignal.timeout(3_000),
      })
      const json = await response.json()
      const value = json?.data?.biz_data?.value
      return typeof value === 'string' && value !== '' ? value : null
    } catch {
      return null
    }
  }
  const [leim, dliq] = await Promise.all([read('https://hif-leim.deepseek.com'), read('https://hif-dliq.deepseek.com')])
  hifCache = { value: { leim, dliq }, at: Date.now() }
  return hifCache.value
}

/**
 * 申请 PoW 挑战并解成 `x-ds-pow-response`。
 * `targetPath` 必须是这次真正要调的接口——网页端的挑战与 target_path 绑定。
 */
async function powHeaders(store, targetPath, signal) {
  const [challengeJson, hif] = await Promise.all([
    jsonRequest(store, CHALLENGE_PATH, {
      method: 'POST',
      body: { target_path: targetPath },
      timeoutMs: POW_TIMEOUT_MS,
      signal,
    }),
    hifTokens(),
  ])
  const challenge = bizData(challengeJson, '申请 PoW 挑战')?.challenge
  if (challenge === null || typeof challenge !== 'object') {
    throw new DeepSeekError('申请 PoW 挑战失败：网页端没有返回 challenge')
  }
  // 显式传 target_path：challenge 里通常也有一份，但样例/历史实现里出现过缺失。
  const powHeader = await buildPowHeader(challenge, targetPath)
  const headers = { 'x-ds-pow-response': powHeader }
  if (hif?.leim) headers['x-hif-leim'] = hif.leim
  if (hif?.dliq) headers['x-hif-dliq'] = hif.dliq
  return headers
}

function completionHeaders(store, signal) {
  return powHeaders(store, TARGET_PATH, signal)
}

/* ------------------------------------------------------------------ *
 * 图片上传
 *
 * 协议取证来自 vendored driver 的 src__api__file.ts：
 *   POST /api/v0/file/upload_file（multipart，字段名 file）+ `x-ds-pow-response`
 *   GET  /api/v0/file/fetch_files?file_ids=<id> 轮询到 SUCCESS/processed/ready
 * 拿到的 file id 再以 `ref_file_ids` 随补全发送。
 * ------------------------------------------------------------------ */

function imageMimeOf(name) {
  const ext = extname(String(name)).slice(1).toLowerCase()
  return IMAGE_MIME_BY_EXT[ext] ?? null
}

function decodeBase64Image(raw) {
  const text = String(raw ?? '').trim()
  const comma = text.indexOf(',')
  const payload = text.startsWith('data:') && comma >= 0 ? text.slice(comma + 1) : text
  return Buffer.from(payload, 'base64')
}

/** 把面板传来的 {name, dataBase64} 或工具传来的 {path} 折成 {name, bytes}。 */
function readImageSource(image) {
  if (typeof image?.path === 'string' && image.path !== '') {
    const path = image.path
    if (!isAbsolute(path)) throw new DeepSeekError(`图片路径必须是绝对路径：${path}`)
    const name = basename(path)
    if (imageMimeOf(name) === null) {
      throw new DeepSeekError(
        `不支持的图片格式：${name}（只支持 ${Object.keys(IMAGE_MIME_BY_EXT).join(' / ')}）`,
      )
    }
    let info
    try {
      info = statSync(path)
    } catch (error) {
      throw new DeepSeekError(`读不到图片文件 ${path}：${error?.message ?? error}`)
    }
    if (!info.isFile()) throw new DeepSeekError(`不是普通文件：${path}`)
    if (info.size > MAX_IMAGE_BYTES) {
      throw new DeepSeekError(`图片太大（${info.size} 字节，上限 ${MAX_IMAGE_BYTES} 字节）：${path}`)
    }
    return { name, bytes: readFileSync(path) }
  }
  if (imageMimeOf(image?.name) === null) {
    throw new DeepSeekError('图片文件名缺少受支持的扩展名（png / jpg / jpeg / webp / gif）——网页端按后缀判类型')
  }
  const bytes = decodeBase64Image(image?.dataBase64 ?? image?.base64)
  if (bytes.byteLength === 0) throw new DeepSeekError('图片内容为空')
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new DeepSeekError(`图片太大（${bytes.byteLength} 字节，上限 ${MAX_IMAGE_BYTES} 字节）`)
  }
  return { name: basename(String(image.name)), bytes }
}

async function waitForUploadedFile(store, fileId, signal) {
  for (let attempt = 0; attempt < UPLOAD_POLL_MAX_ATTEMPTS; attempt += 1) {
    const json = await jsonRequest(store, `${FETCH_FILES_PATH}?file_ids=${encodeURIComponent(fileId)}`, {
      method: 'GET',
      timeoutMs: REQUEST_TIMEOUT_MS,
      signal,
    })
    const files = bizData(json, '查询图片处理状态')?.files
    const file = Array.isArray(files) ? (files.find((entry) => entry?.id === fileId) ?? files[0]) : null
    const status = String(file?.status ?? '')
    if (FILE_SUCCESS_STATUSES.has(status)) return status
    if (FILE_FAILED_STATUSES.has(status)) {
      throw new DeepSeekError(`图片处理失败（id=${fileId}，error_code=${file?.error_code ?? '?'}）`)
    }
    await new Promise((resolve) => setTimeout(resolve, UPLOAD_POLL_INTERVAL_MS))
  }
  throw new DeepSeekError(`图片处理超时（id=${fileId}，等了 ${UPLOAD_POLL_MAX_ATTEMPTS} 秒）`)
}

async function uploadImage(store, image, signal) {
  const { name, bytes } = readImageSource(image)
  const headers = await powHeaders(store, UPLOAD_PATH, signal)
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: imageMimeOf(name) }), name)
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const composed = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
  let response
  try {
    response = await fetch(`${WEB_ORIGIN}${UPLOAD_PATH}`, {
      method: 'POST',
      headers: {
        ...BASE_HEADERS,
        authorization: `Bearer ${requireToken(store)}`,
        ...headers,
        'x-file-size': String(bytes.byteLength),
        'x-thinking-enabled': store.thinking === true ? '1' : '0',
        'x-model-type': store.modelType ?? 'default',
      },
      // 不要自己写 content-type：让 fetch 生成 multipart boundary。
      body: form,
      redirect: 'error',
      signal: composed,
    })
  } catch (error) {
    throw new DeepSeekError(`上传图片时连不上 chat.deepseek.com：${error?.message ?? error}`)
  }
  const text = await response.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new DeepSeekError(`上传图片返回了非 JSON 响应（HTTP ${response.status}）：${text.slice(0, 200)}`)
  }
  const uploaded = bizData(json, '上传图片')
  const fileId = uploaded?.id
  if (typeof fileId !== 'string' || fileId === '') {
    throw new DeepSeekError('上传图片失败：网页端没有返回文件 id')
  }
  const status = await waitForUploadedFile(store, fileId, signal)
  return { fileId, name, size: bytes.byteLength, status }
}

/** 依次上传（串行，避免并发的追加上传触发风控），并按 file id 去重。 */
async function uploadImages(store, images, signal) {
  const list = Array.isArray(images) ? images.filter((entry) => entry !== null && typeof entry === 'object') : []
  if (list.length === 0) return []
  if (list.length > MAX_IMAGES_PER_MESSAGE) {
    throw new DeepSeekError(
      `一条消息最多带 ${MAX_IMAGES_PER_MESSAGE} 张图片（网页端对一批 ref_file_ids 有上限，超了会让整轮甚至整个会话失败）`,
    )
  }
  const uploaded = []
  for (const image of list) {
    uploaded.push(await uploadImage(store, image, signal))
  }
  // 同一 file_id 重复出现会被网页端判成非法 ref file id 并卡死该会话，这里先去掉重复。
  const seen = new Set()
  return uploaded.filter((entry) => {
    if (seen.has(entry.fileId)) return false
    seen.add(entry.fileId)
    return true
  })
}

function shouldSkipPath(path) {
  if (SKIP_PATH_EXACT.includes(path)) return true
  return SKIP_PATH_CONTAINS.some((marker) => path.includes(marker))
}

/**
 * 解析补全流。
 *
 * 网页端历史上出现过两种形状，这里一次都吃下：
 *   A) 结构化补丁：{"p":"response/fragments/-1/content","o":"APPEND","v":"…"}，
 *      初始信封 {"v":{"response":{…fragments:[…]}}}，以及 {"v":[{p,o,v},…]} 批量简写；
 *   B) 直给标量：{"p":"response/content","v":"…"} / {"p":"response/thinking_content","v":"…"}
 *      （有实现只认这一种）。
 * 统一做法：把两种形状都折进一个「总量」里，再用长度差推增量——这样 APPEND / SET /
 * 连续 token 续写都不用分别处理。
 */
async function* parseCompletionStream(body, store, sessionId) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let currentEvent = ''
  let lastPath = ''

  const state = { fragments: [], thinking: '', content: '', status: null }
  let seenThinking = 0
  let seenContent = 0
  let seenQueries = 0
  let done = false

  const totals = () => ({
    thinking: fragmentText(state.fragments, 'thinking') || state.thinking,
    content: fragmentText(state.fragments, 'content') || state.content,
  })

  function* flush() {
    const { thinking, content } = totals()
    if (thinking.length > seenThinking) {
      yield { type: 'thinking', text: thinking.slice(seenThinking) }
      seenThinking = thinking.length
    } else if (thinking.length < seenThinking) {
      seenThinking = thinking.length
    }
    if (content.length > seenContent) {
      yield { type: 'content', text: content.slice(seenContent) }
      seenContent = content.length
    } else if (content.length < seenContent) {
      seenContent = content.length
    }
    const queries = fragmentQueries(state.fragments)
    if (queries.length > seenQueries) {
      yield { type: 'search', queries: queries.slice(seenQueries) }
      seenQueries = queries.length
    }
  }

  function applyPatch(path, op, value) {
    const parts = path.split('/')
    if (parts[0] === 'response') parts.shift()
    if (parts.length === 0) {
      if (value !== null && typeof value === 'object') {
        if (Array.isArray(value.fragments)) state.fragments = value.fragments
        if (typeof value.status === 'string') state.status = value.status
      }
      return
    }
    if (parts[0] === 'fragments') {
      if (parts.length === 1) {
        if (op === 'APPEND') {
          const list = Array.isArray(value) ? value : [value]
          for (const item of list) if (item !== null && typeof item === 'object') state.fragments.push(item)
          return
        }
        if (op === 'SET' && Array.isArray(value)) {
          state.fragments = value
          return
        }
      }
      const rawIndex = parts[1]
      const index =
        rawIndex === '-1' ? state.fragments.length - 1 : rawIndex === '-2' ? state.fragments.length - 2 : Number(rawIndex)
      if (!Number.isInteger(index) || index < 0 || index >= state.fragments.length) return
      if (parts.length === 2) return
      const field = parts[2]
      if (field === 'content') {
        const previous = typeof state.fragments[index].content === 'string' ? state.fragments[index].content : ''
        state.fragments[index].content = op === 'APPEND' ? previous + String(value ?? '') : String(value ?? '')
      } else if (field === 'queries' || field === 'results') {
        state.fragments[index][field] = value
      } else if (field === 'status') {
        state.fragments[index].status = String(value)
      } else if (field === 'type') {
        state.fragments[index].type = String(value)
      }
      return
    }
    // 形状 B：直接落在 response/thinking_content / response/content / response/text
    if (parts[0] === 'thinking_content' || parts[0] === 'thinking') {
      state.thinking = op === 'APPEND' ? state.thinking + String(value ?? '') : String(value ?? '')
      return
    }
    if (parts[0] === 'content' || parts[0] === 'text') {
      state.content = op === 'APPEND' ? state.content + String(value ?? '') : String(value ?? '')
      return
    }
    if (parts[0] === 'status') {
      state.status = String(value)
    }
  }

  function* handlePayload(raw) {
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    if (parsed === null || typeof parsed !== 'object') return

    // 限流 / 报错是以「HTTP 200 + SSE 错误帧」回来的，不是 429。
    // 两条文案只差一个字：`消息发送过于频繁，请稍后重试`（账号级，退避 20s）
    // vs `请稍后再试`（并发拒绝，退避 5s），要分开提示。
    if (typeof parsed.code === 'number' && parsed.code !== 0) {
      const message = String(parsed.msg ?? parsed.message ?? '')
      if (message.includes('频繁')) {
        throw new DeepSeekError('DeepSeek 网页端限流：这个账号最近发得太多，请等 20 秒以上再发。', parsed.code)
      }
      if (message.includes('稍后再试')) {
        throw new DeepSeekError(
          'DeepSeek 网页端拒绝了这次发送：同一账号同时只能有一条生成在跑。等几秒再试（若刚点过停止，网页端可能还占着一会儿）。',
          parsed.code,
        )
      }
      throw new DeepSeekError(`DeepSeek 网页端返回错误：code=${parsed.code} ${message}`.trim(), parsed.code)
    }

    if (typeof parsed.response_message_id === 'number') {
      store.setParent(sessionId, parsed.response_message_id)
      yield { type: 'meta', sessionId, messageId: parsed.response_message_id }
    }

    const hasPath = 'p' in parsed
    const hasValue = 'v' in parsed

    if (hasPath) {
      const path = String(parsed.p)
      const op = typeof parsed.o === 'string' ? parsed.o : 'APPEND'
      lastPath = path
      const value = parsed.v
      if (op === 'BATCH' && Array.isArray(value)) {
        const base = path === 'response' ? '' : path
        for (const sub of value) {
          if (sub === null || typeof sub !== 'object' || typeof sub.p !== 'string') continue
          const subPath = `${base}/${sub.p}`
          if (shouldSkipPath(subPath)) continue
          applyPatch(subPath, typeof sub.o === 'string' ? sub.o : 'SET', sub.v)
        }
        yield* flush()
        return
      }
      if (shouldSkipPath(path)) return
      applyPatch(path, op, value)
      yield* flush()
      return
    }

    if (hasValue) {
      const value = parsed.v
      if (typeof value === 'string') {
        // 纯 token 续写：接到最后一个 fragment 上（沿用上一个路径）
        if (state.fragments.length > 0 && !shouldSkipPath(lastPath)) {
          const index = state.fragments.length - 1
          const previous = typeof state.fragments[index].content === 'string' ? state.fragments[index].content : ''
          state.fragments[index].content = previous + value
        } else if (state.thinking.length > state.content.length) {
          state.thinking += value
        } else {
          state.content += value
        }
        yield* flush()
        return
      }
      if (value !== null && typeof value === 'object') {
        if (Array.isArray(value)) {
          for (const sub of value) {
            if (sub === null || typeof sub !== 'object' || typeof sub.p !== 'string') continue
            const subPath = sub.p.startsWith('response') ? sub.p : `response/${sub.p}`
            if (shouldSkipPath(subPath)) continue
            applyPatch(subPath, typeof sub.o === 'string' ? sub.o : 'SET', sub.v)
          }
          yield* flush()
          return
        }
        if ('response' in value) {
          const response = value.response
          if (response !== null && typeof response === 'object') {
            if (Array.isArray(response.fragments)) state.fragments = response.fragments
            if (typeof response.status === 'string') state.status = response.status
          }
          yield* flush()
          return
        }
        applyPatch('response', 'SET', value)
        yield* flush()
      }
    }
  }

  try {
    while (!done) {
      const { done: finished, value } = await reader.read()
      if (finished) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed === '') {
          currentEvent = ''
          continue
        }
        if (trimmed.startsWith('event:')) {
          currentEvent = trimmed.slice(6).trim()
          continue
        }
        if (trimmed.startsWith('data:')) {
          const raw = trimmed.slice(5).trim()
          if (raw === '' || raw === '{}') continue
          if (raw === '[DONE]') {
            done = true
            break
          }
          if (currentEvent === 'close' || currentEvent === 'finish') {
            done = true
            break
          }
          if (currentEvent === 'title') {
            try {
              const parsed = JSON.parse(raw)
              const title = parsed?.content ?? parsed?.title
              if (typeof title === 'string' && title !== '') yield { type: 'title', title }
            } catch {
              /* 忽略 */
            }
            currentEvent = ''
            continue
          }
          currentEvent = ''
          yield* handlePayload(raw)
          if (state.status === 'FINISHED' || state.status === 'INCOMPLETE' || state.status === 'INTERRUPTED') {
            done = true
          }
        }
      }
    }
    yield* flush()
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* 忽略 */
    }
  }
}

async function* streamCompletion(store, params, signal) {
  const {
    sessionId: requestedSessionId,
    prompt,
    thinking = store.thinking,
    search = store.search,
    modelType = store.modelType,
    refFileIds = [],
  } = params
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new DeepSeekError('消息内容不能为空')
  }
  let sessionId = String(requestedSessionId ?? '')
  // 图片只有当前这一轮该带：历史消息的附件已经在服务端上下文里（按 parent_message_id 链回溯），
  // 后续轮次再带旧 id 会重复占用 ref_file_ids 配额、甚至被判非法。
  const refs = Array.isArray(refFileIds) ? refFileIds.filter((id) => typeof id === 'string' && id !== '') : []

  for (let attempt = 0; ; attempt += 1) {
    // 每次尝试都重新申请 PoW（挑战与 target_path 绑定，且可能是一次性的）。
    const headers = await completionHeaders(store, signal)
    const body = {
      chat_session_id: sessionId,
      parent_message_id: store.parentOf(sessionId),
      model_type: modelType ?? null,
      prompt,
      ref_file_ids: refs,
      thinking_enabled: thinking === true,
      search_enabled: search === true,
      preempt: false,
    }
    const response = await rawRequest(store, COMPLETION_PATH, {
      method: 'POST',
      body,
      headers: { ...headers, accept: 'text/event-stream' },
      timeoutMs: 0,
      signal,
    })
    if (!response.ok) {
      const text = await response.text()
      throw new DeepSeekError(`发起网页版对话失败（HTTP ${response.status}）：${text.slice(0, 300)}`)
    }
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const text = await response.text()
      let json
      try {
        json = JSON.parse(text)
      } catch {
        throw new DeepSeekError(`网页端返回了无法解析的响应：${text.slice(0, 300)}`)
      }
      try {
        bizData(json, '发起对话')
      } catch (error) {
        // 会话在网页端被删掉时（biz_code 1 invalid chat session id）新建一个重发一次，
        // 与网页端自己的行为一致；也顺手告诉调用方「换会话了」。
        if (error?.sessionExpired === true && attempt === 0) {
          const fresh = await createSession(store)
          sessionId = fresh.id
          store.selectedSessionId = sessionId
          yield { type: 'session', sessionId, session: fresh, renewed: true }
          continue
        }
        throw error
      }
      return
    }
    if (response.body === null) throw new DeepSeekError('网页端没有返回流式响应体')
    yield* parseCompletionStream(response.body, store, sessionId)
    return
  }
}

/** 收完一整条补全（给 Agent 工具用）。 */
async function collectCompletion(store, params, signal) {
  let content = ''
  let thinking = ''
  let messageId = null
  let sessionId = String(params.sessionId ?? '')
  const queries = []
  for await (const event of streamCompletion(store, params, signal)) {
    if (event.type === 'content') content += event.text
    else if (event.type === 'thinking') thinking += event.text
    else if (event.type === 'search') queries.push(...event.queries)
    else if (event.type === 'session') sessionId = event.sessionId ?? sessionId
    else if (event.type === 'meta') messageId = event.messageId ?? messageId
  }
  return { sessionId, content, thinking, queries, messageId }
}

/* ------------------------------------------------------------------ *
 * 面板 RPC
 * ------------------------------------------------------------------ */

function publicState(store) {
  return {
    hasToken: (store.token || '') !== '',
    user: store.user,
    thinking: store.thinking,
    search: store.search,
    modelType: store.modelType,
    selectedSessionId: store.selectedSessionId,
    statePath: stateDir(),
  }
}

async function dispatch(store, method, params) {
  switch (method) {
    case 'state':
      return publicState(store)

    case 'setToken': {
      const token = String(params?.token ?? '').trim().replace(/^["']|["']$/g, '')
      if (token === '') throw new DeepSeekError('userToken 不能为空')
      const previous = store.token
      store.token = token
      try {
        const biz = await fetchCurrentUser(store, token)
        const refreshed = typeof biz?.token === 'string' && biz.token !== '' ? biz.token : token
        const user = {
          email: biz?.user?.email ?? biz?.email ?? null,
          mobile: biz?.user?.mobile_number ?? biz?.mobile_number ?? null,
          name: biz?.user?.name ?? biz?.name ?? null,
        }
        store.setToken(refreshed, user)
        return { ok: true, ...publicState(store) }
      } catch (error) {
        store.token = previous
        throw error
      }
    }

    case 'clearToken':
      store.clearToken()
      return publicState(store)

    case 'sessions': {
      const result = await listSessions(store, Number(params?.limit) || 50)
      return { ...publicState(store), ...result }
    }

    case 'create': {
      const session = await createSession(store)
      store.selectedSessionId = session.id
      return { session, ...publicState(store) }
    }

    case 'select': {
      const sessionId = String(params?.sessionId ?? '')
      if (sessionId === '') throw new DeepSeekError('缺少 sessionId')
      store.selectedSessionId = sessionId
      return publicState(store)
    }

    case 'history': {
      const sessionId = String(params?.sessionId ?? store.selectedSessionId ?? '')
      if (sessionId === '') throw new DeepSeekError('缺少 sessionId')
      store.selectedSessionId = sessionId
      const result = await historyMessages(store, sessionId)
      return { ...result, ...publicState(store) }
    }

    case 'rename':
      return renameSession(store, String(params?.sessionId ?? ''), String(params?.title ?? ''))

    case 'remove':
      return deleteSession(store, String(params?.sessionId ?? ''))

    case 'settings':
      store.setSettings(params ?? {})
      return publicState(store)

    case 'stop':
      if (store.inflight !== null) {
        store.inflight.abort()
        store.inflight = null
        return { ok: true, stopped: true }
      }
      return { ok: true, stopped: false }

    case 'upload': {
      const uploaded = await uploadImage(store, { name: params?.name, dataBase64: params?.dataBase64 })
      return { fileId: uploaded.fileId, name: uploaded.name, size: uploaded.size, status: uploaded.status }
    }

    default:
      throw new DeepSeekError(`未知方法：${method}`)
  }
}

function errorPayload(error) {
  const payload = { message: error?.message ?? String(error) }
  if (typeof error?.code === 'number') payload.code = error.code
  if (error?.needToken === true) payload.needToken = true
  return payload
}

/* ------------------------------------------------------------------ *
 * Agent 工具
 * ------------------------------------------------------------------ */

const TOOL_NAME = 'deepseek_web'

function describeConversation(session) {
  const when = session.updatedAt === null ? '' : ` · ${new Date(session.updatedAt).toISOString().slice(0, 16).replace('T', ' ')}`
  return `- ${session.id} · ${session.title}${when}`
}

function renderConversation(result) {
  const lines = [`对话：${result.title ?? result.sessionId}（${result.sessionId}）`]
  if (typeof result.webUrl === 'string') lines.push(`网页地址：${result.webUrl}`)
  lines.push('')
  for (const message of result.messages ?? []) {
    const who = message.role === 'user' ? '你' : 'DeepSeek'
    if (message.role === 'assistant' && message.thinking) {
      lines.push(`【${who} · 思考】${message.thinking}`)
    }
    lines.push(`【${who}】${message.content || '（空）'}`)
    if (message.queries?.length) lines.push(`（联网检索：${message.queries.join(' / ')}）`)
    lines.push('')
  }
  return lines.join('\n').trim()
}

function makeTool(store) {
  return {
    name: TOOL_NAME,
    description:
      '访问当前用户自己的 chat.deepseek.com 网页版对话（与浏览器里同一个账号）。' +
      '可以列出/读取网页版历史对话，也可以直接在某个对话里发送新消息，或新建对话。' +
      '发送是阻塞的：返回时正文已经生成完毕。',
    // 注意：这两个 schema 必须是**标准 JSON Schema**。
    // DSH 的 defineTool() 会把「缩写方言」（把 required: true 写在属性上）转换成标准形状，
    // 但那个转换器在 @deepseek-ai/dsh-tools 里，装进 profile 的 bundle 解析不到，
    // 所以这里手写转换后的结果：属性上不写 required，另用 required: [...] 数组。
    // register() 会用 assertSupportedJsonSchema 严格校验 output.schema，缩写方言会抛
    // `unsupported JSON schema: schema.properties.text.required is not supported on type "string"`
    // 并导致整条 effect 失败（工具静默消失）。
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list_conversations', 'read_conversation', 'send_message', 'new_conversation', 'delete_conversation'],
          description:
            'list_conversations=列出最近的网页版对话；read_conversation=读取某个对话的完整消息；' +
            'send_message=在对话里发一条消息并等待回答；new_conversation=新建对话；delete_conversation=删除对话。',
        },
        session_id: {
          type: 'string',
          description: '对话 id（read_conversation / send_message / delete_conversation 需要；send_message 省略时用当前选中的对话，没有就新建）。',
        },
        prompt: { type: 'string', description: 'send_message 要发送的消息正文。' },
        title: { type: 'string', description: 'new_conversation 的标题（可省略，稍后让 DeepSeek 自动生成）。' },
        limit: { type: 'number', description: 'list_conversations 返回的条数，默认 20。' },
        images: {
          type: 'array',
          items: { type: 'string' },
          description:
            'send_message 可选：随消息一起发给网页端的本地图片绝对路径（png/jpg/jpeg/webp/gif，单张 ≤10MB，最多 8 张）。',
        },
        thinking: { type: 'boolean', description: 'send_message 是否开启深度思考，默认沿用面板设置。' },
        search: { type: 'boolean', description: 'send_message 是否开启联网搜索，默认沿用面板设置。' },
      },
      required: ['action'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', description: '给模型看的正文（Markdown）。' },
        },
        required: ['text'],
      },
      render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const action = String(args?.action ?? '')
      switch (action) {
        case 'list_conversations': {
          const limit = Math.min(Math.max(Number(args?.limit) || 20, 1), 100)
          const { sessions, hasMore } = await listSessions(store, limit)
          if (sessions.length === 0) return { text: '网页版里还没有对话。' }
          const lines = sessions.map(describeConversation)
          return {
            text: `你的 chat.deepseek.com 网页版对话（${sessions.length} 条${hasMore ? '，还有更多' : ''}）：\n${lines.join('\n')}`,
          }
        }

        case 'new_conversation': {
          const session = await createSession(store)
          store.selectedSessionId = session.id
          const title = typeof args?.title === 'string' && args.title !== '' ? args.title : null
          if (title !== null) await renameSession(store, session.id, title)
          return { text: `已新建网页版对话：${session.id}${title === null ? '' : `（标题：${title}）`}` }
        }

        case 'read_conversation': {
          const sessionId = String(args?.session_id ?? store.selectedSessionId ?? '')
          if (sessionId === '') throw new DeepSeekError('read_conversation 需要 session_id')
          const { session, messages } = await historyMessages(store, sessionId)
          return {
            text: renderConversation({
              sessionId,
              title: session?.title ?? '（无标题对话）',
              webUrl: `https://chat.deepseek.com/a/chat/s/${sessionId}`,
              messages,
            }),
          }
        }

        case 'send_message': {
          const prompt = String(args?.prompt ?? '')
          if (prompt.trim() === '') throw new DeepSeekError('send_message 需要 prompt')
          let sessionId = String(args?.session_id ?? store.selectedSessionId ?? '')
          if (sessionId === '') {
            const session = await createSession(store)
            sessionId = session.id
          }
          const imagePaths = Array.isArray(args?.images)
            ? args.images.filter((path) => typeof path === 'string' && path !== '')
            : []
          const images = imagePaths.length === 0
            ? []
            : await uploadImages(store, imagePaths.map((path) => ({ path })), exec?.signal)
          const result = await collectCompletion(
            store,
            {
              sessionId,
              prompt,
              thinking: typeof args?.thinking === 'boolean' ? args.thinking : store.thinking,
              search: typeof args?.search === 'boolean' ? args.search : store.search,
              refFileIds: images.map((entry) => entry.fileId),
            },
            exec?.signal,
          )
          // 只有真的发出去了才把「当前会话」钉在这个 id 上：参数校验/上传失败不该污染选中态。
          store.selectedSessionId = result.sessionId
          const imageNote = images.length === 0 ? '' : `（随消息发出 ${images.length} 张图片）`
          const heading = `已在网页版对话 ${result.sessionId} 发出消息并拿到回答。${imageNote}`
          const thinkingBlock = result.thinking === '' ? '' : `\n\n【思考过程】\n${result.thinking}`
          const searchBlock = result.queries.length === 0 ? '' : `\n\n【联网检索】${result.queries.join(' / ')}`
          return { text: `${heading}${searchBlock}${thinkingBlock}\n\n【回答】\n${result.content || '（网页端没有返回正文）'}` }
        }

        case 'delete_conversation': {
          const sessionId = String(args?.session_id ?? '')
          if (sessionId === '') throw new DeepSeekError('delete_conversation 需要 session_id')
          await deleteSession(store, sessionId)
          return { text: `已删除网页版对话 ${sessionId}。` }
        }

        default:
          throw new DeepSeekError(`未知 action：${action}`)
      }
    },
  }
}

/* ------------------------------------------------------------------ *
 * 装配
 * ------------------------------------------------------------------ */

export function apply(ctx) {
  ctx.inject(['webServer', 'tools'], (hostCtx) => {
    const store = createStore()

    const trustedHosts = () => {
      const connection = hostCtx.get('connection')
      const list = connection?.trustedHosts
      return Array.isArray(list) ? list.filter((entry) => typeof entry === 'string') : []
    }

    const handler = async (request, response) => {
      const url = new URL(String(request.url ?? '/'), 'http://127.0.0.1')
      const rest = url.pathname.slice(ROUTE_PREFIX.length) || '/'

      if (!requestAllowed(request, trustedHosts())) {
        sendJson(response, 403, { ok: false, error: { message: '仅允许本机 DSH 页面调用该接口' } })
        return
      }
      if (request.method !== 'POST') {
        sendJson(response, 405, { ok: false, error: { message: '只支持 POST' } })
        return
      }

      if (rest === '/rpc') {
        let payload
        try {
          payload = await readJsonBody(request, MAX_RPC_BODY_BYTES)
        } catch (error) {
          sendJson(response, 400, { ok: false, error: { message: `请求体不是合法 JSON：${error?.message ?? error}` } })
          return
        }
        try {
          const result = await dispatch(store, String(payload?.method ?? ''), payload?.params ?? {})
          sendJson(response, 200, { ok: true, result })
        } catch (error) {
          sendJson(response, 200, { ok: false, error: errorPayload(error) })
        }
        return
      }

      if (rest === '/stream') {
        let payload
        try {
          payload = await readJsonBody(request)
        } catch (error) {
          sendJson(response, 400, { ok: false, error: { message: `请求体不是合法 JSON：${error?.message ?? error}` } })
          return
        }
        response.writeHead(200, {
          'cache-control': 'no-store',
          'content-type': 'application/x-ndjson; charset=utf-8',
          'x-accel-buffering': 'no',
        })
        const write = (event) => {
          if (!response.writableEnded) response.write(`${JSON.stringify(event)}\n`)
        }
        let sessionId = String(payload?.sessionId ?? store.selectedSessionId ?? '')
        const controller = new AbortController()
        store.inflight = controller
        const onClose = () => controller.abort()
        request.on('close', onClose)
        try {
          if (sessionId === '') {
            const session = await createSession(store)
            sessionId = session.id
            store.selectedSessionId = sessionId
            write({ type: 'session', sessionId, session })
          }
          write({ type: 'start', sessionId })
          for await (const event of streamCompletion(
            store,
            {
              sessionId,
              prompt: String(payload?.text ?? ''),
              thinking: typeof payload?.thinking === 'boolean' ? payload.thinking : store.thinking,
              search: typeof payload?.search === 'boolean' ? payload.search : store.search,
              refFileIds: Array.isArray(payload?.imageFileIds)
                ? payload.imageFileIds.filter((id) => typeof id === 'string' && id !== '')
                : [],
            },
            controller.signal,
          )) {
            if (event.type === 'session' && typeof event.sessionId === 'string' && event.sessionId !== '') {
              // 原会话在网页端没了：插件已经新建了一个，面板要跟着切过去。
              sessionId = event.sessionId
            }
            write(event)
          }
          write({ type: 'done', sessionId })
        } catch (error) {
          write({ type: 'error', error: errorPayload(error) })
        } finally {
          request.off('close', onClose)
          if (store.inflight === controller) store.inflight = null
          if (!response.writableEnded) response.end()
        }
        return
      }

      sendJson(response, 404, { ok: false, error: { message: `未知路径：${rest}` } })
    }

    hostCtx.effect(
      () => hostCtx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler }),
      'deepseek-web: http 路由',
    )

    hostCtx.effect(
      () => hostCtx.tools.register(makeTool(store)),
      'deepseek-web: agent 工具',
    )
  })
}
