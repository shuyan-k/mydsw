/**
 * DeepSeek 网页版 PoW（DeepSeekHashV1）求解器。
 *
 * 官方站点的 wasm 只导出三个符号（见 chat.deepseek.com 的 sha3_wasm_bg.wasm）：
 *   __wbindgen_export_0(len, align) -> ptr   在 wasm 线性内存里申请一块写字符串的地方
 *   __wbindgen_add_to_stack_pointer(delta)   维护一个返回区指针
 *   wasm_solve(retptr, challenge_ptr, challenge_len, prefix_ptr, prefix_len, difficulty)
 *                                            结果写在 retptr：+0 = i32 是否找到，+8 = f64 答案
 * wasm 不需要任何 import，直接 WebAssembly.instantiate(bytes, {}) 即可。
 *
 * prefix 的拼法是固定协议：`${salt}_${expire_at}_`。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const WASM_FILE = fileURLToPath(new URL('./sha3_wasm_bg.wasm', import.meta.url))

let wasmExportsPromise = null

/** 加载（并缓存）官方 wasm 的导出表。 */
export function loadPowWasm() {
  if (wasmExportsPromise === null) {
    wasmExportsPromise = (async () => {
      const bytes = readFileSync(WASM_FILE)
      // 该 wasm 没有真实 import，但 wbindgen 产物可能声明 `wbg` 模块：
      // 多传一个空模块没有副作用，传纯 {} 反而会在有声明时抛 "module is not an object"。
      const { instance } = await WebAssembly.instantiate(bytes, { wbg: {} })
      return instance.exports
    })()
  }
  return wasmExportsPromise
}

function writeString(exports, text) {
  const bytes = new TextEncoder().encode(text)
  const ptr = exports.__wbindgen_export_0(bytes.length, 1) >>> 0
  new Uint8Array(exports.memory.buffer, ptr, bytes.length).set(bytes)
  return [ptr, bytes.length]
}

/** 解一个 challenge，返回答案（number，deepseek 校验用的就是它）。 */
export async function solvePowAnswer(challenge) {
  const exports = await loadPowWasm()
  const prefix = `${challenge.salt}_${challenge.expire_at}_`
  const difficulty = Number(challenge.difficulty) || 144000
  const retptr = exports.__wbindgen_add_to_stack_pointer(-16)
  try {
    const [challengePtr, challengeLen] = writeString(exports, String(challenge.challenge))
    const [prefixPtr, prefixLen] = writeString(exports, prefix)
    exports.wasm_solve(retptr, challengePtr, challengeLen, prefixPtr, prefixLen, difficulty)
    const view = new DataView(exports.memory.buffer)
    const found = view.getInt32(retptr + 0, true)
    const answer = view.getFloat64(retptr + 8, true)
    if (found === 0) throw new Error('PoW 求解失败：wasm 没有找到满足难度的解')
    return answer
  } finally {
    exports.__wbindgen_add_to_stack_pointer(16)
  }
}

/** 补全接口的 target_path；服务端通常会在 challenge 里回传，缺失时用它兜底。 */
export const DEFAULT_TARGET_PATH = '/api/v0/chat/completion'

/**
 * 把 challenge 解成 `x-ds-pow-response` 头。
 * 注意：载荷里带的是 target_path（不是 difficulty），且用标准 base64（不是 base64url）。
 * target_path 的取值优先级：调用方显式传入 → challenge 自己带的 → 补全接口默认值。
 * （求解器包只回 5 键、样例 challenge 也可能没有该字段，兜底不能省。）
 */
export async function buildPowHeader(challenge, targetPath) {
  const answer = await solvePowAnswer(challenge)
  const payload = JSON.stringify({
    algorithm: challenge.algorithm,
    challenge: challenge.challenge,
    salt: challenge.salt,
    // 求解器返回的是裸 float64，站上校验的是整数 nonce（floor 后无害且更稳）。
    answer: Math.floor(answer),
    signature: challenge.signature,
    target_path: targetPath ?? challenge.target_path ?? DEFAULT_TARGET_PATH,
  })
  return Buffer.from(payload, 'utf8').toString('base64')
}
