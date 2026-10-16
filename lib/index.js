/**
 * dsh-translate — host half.
 *
 * A tiny same-origin HTTP bridge in front of the Baidu Translate API:
 * the browser half must never see the secret key, and the Baidu endpoint
 * answers no CORS headers, so the call has to leave from the host process.
 *
 * Routes (all exact, all under one prefix, all admitted same-origin only):
 *   GET  /dsh-translate/config      -> current settings (secret stays masked)
 *   POST /dsh-translate/config      -> patch settings, persisted to $DSH_HOME
 *   POST /dsh-translate/translate   -> { text, from?, to? } -> normalized result
 *
 * Configuration precedence: `$DSH_HOME/dsh-translate.json` (written by the
 * settings card in the popup) over the cordis.yml entry's `config` block.
 */

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Cordis plugin name. */
export const name = 'dsh-translate'

const PREFIX = '/dsh-translate'
const BAIDU_HOST = 'fanyi-api.baidu.com'
const BAIDU_PATH = '/api/trans/vip/translate'
const MAX_TEXT = 6000
const MAX_BODY = 1 << 20

/**
 * The endpoint the plugin posts to.
 *
 * `DSH_TRANSLATE_ENDPOINT` is a testing hook: it lets a mock server stand in
 * for Baidu so the signature and the response normalization can be exercised
 * without a real appid. Unset, this is exactly the documented production URL.
 * @returns an absolute http(s) URL.
 */
function endpoint() {
  const override = process.env.DSH_TRANSLATE_ENDPOINT
  return override && override.trim() !== '' ? override.trim() : `https://${BAIDU_HOST}${BAIDU_PATH}`
}

/** Defaults for every setting the popup can change. */
const DEFAULTS = {
  appId: '',
  secretKey: '',
  /** 'auto' asks the heuristic below; anything else is passed to Baidu `to`. */
  defaultTarget: 'auto',
  /** Hotkey that translates the current selection, DSH-free by default. */
  shortcut: 'Alt+T',
  /** Master switch for the bubble + hotkey. */
  enabled: true,
  /** Show the little bubble on mouse-up selection (off = hotkey only). */
  showButton: true,
}

/** Baidu error codes worth naming instead of showing a bare number. */
const BAIDU_ERRORS = {
  52001: '请求超时，请重试',
  52002: '百度翻译系统错误，请重试',
  52003: '未授权用户：appid 错误，或该应用未开通「通用文本翻译」',
  54000: '必填参数为空',
  54001: '签名错误：密钥（开发者密钥）与 appid 不匹配',
  54003: '访问频率受限：请稍后再试，或升级为高级版',
  54004: '账户余额不足',
  54005: '长文本请求频繁，请稍后再试',
  58000: '客户端 IP 非法：请在百度翻译开放平台配置 IP 白名单',
  58001: '译文语言方向不支持',
  58002: '服务当前已关闭',
  90107: '认证未通过或未生效',
}

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3005\u3007]/
const KANA = /[\u3040-\u30ff\u31f0-\u31ff]/

/** Absolute path of the settings file inside the DSH home. */
function configPath() {
  const home = process.env.DSH_HOME && process.env.DSH_HOME.trim()
    ? process.env.DSH_HOME.trim()
    : join(homedir(), '.dsh')
  return join(home, 'dsh-translate.json')
}

/** @returns settings persisted by the popup, or `{}`. */
function readStored() {
  try {
    const parsed = JSON.parse(readFileSync(configPath(), 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Merge a patch into the stored settings.
 * @param patch - partial settings; unknown keys are dropped.
 * @returns the complete settings object after the write.
 */
function writeStored(patch) {
  const known = {}
  for (const key of Object.keys(DEFAULTS)) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) known[key] = patch[key]
  }
  const next = { ...readStored(), ...known }
  const file = configPath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}

/**
 * @param ymlConfig - the cordis.yml `config` block, if any.
 * @returns the effective settings, stored file over yml defaults.
 */
function effectiveConfig(ymlConfig) {
  const seed = {}
  if (ymlConfig && typeof ymlConfig === 'object' && !Array.isArray(ymlConfig)) {
    for (const key of Object.keys(DEFAULTS)) {
      if (Object.prototype.hasOwnProperty.call(ymlConfig, key)) seed[key] = ymlConfig[key]
    }
  }
  const merged = { ...DEFAULTS, ...seed, ...readStored() }
  const settings = {}
  for (const key of Object.keys(DEFAULTS)) {
    const fallback = DEFAULTS[key]
    settings[key] = typeof merged[key] === typeof fallback ? merged[key] : fallback
  }
  settings.appId = String(settings.appId ?? '').trim()
  settings.secretKey = String(settings.secretKey ?? '').trim()
  settings.shortcut = String(settings.shortcut ?? '').trim() || DEFAULTS.shortcut
  return settings
}

/**
 * Pick the target language for `text` unless the caller named one.
 * @param text - the source text.
 * @param preferred - configured default; `auto` means "decide here".
 * @returns a Baidu language code.
 */
function pickTarget(text, preferred) {
  if (preferred && preferred !== 'auto') return preferred
  return CJK.test(text) || KANA.test(text) ? 'en' : 'zh'
}

/**
 * POST an urlencoded form and parse the JSON answer.
 * @param form - flat string map.
 * @returns the parsed payload.
 */
function postForm(form) {
  return new Promise((resolve, reject) => {
    const target = new URL(endpoint())
    const send = target.protocol === 'http:' ? httpRequest : httpsRequest
    const body = new URLSearchParams(form).toString()
    const request = send({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port !== '' ? target.port : target.protocol === 'http:' ? 80 : 443,
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        Accept: 'application/json',
      },
      timeout: 20000,
    }, (response) => {
      let raw = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { raw += chunk })
      response.on('end', () => {
        try {
          resolve(JSON.parse(raw))
        } catch {
          reject(new Error(`百度翻译返回了非 JSON 响应（HTTP ${response.statusCode}）：${raw.slice(0, 200)}`))
        }
      })
    })
    request.on('timeout', () => request.destroy(new Error('请求百度翻译超时（20 秒）')))
    request.on('error', reject)
    request.end(body)
  })
}

/**
 * Call Baidu and normalize its answer for the popup.
 * @param text - text to translate.
 * @param from - source language, `auto` for detection.
 * @param to - target language, `auto` to use the configured default.
 * @param settings - effective settings.
 * @returns the normalized result.
 */
async function translate(text, from, to, settings) {
  const source = String(text ?? '').replace(/\s+$/u, '')
  if (!source.trim()) throw new Error('没有可翻译的文本')
  if (source.length > MAX_TEXT) throw new Error(`文本过长（${source.length} 字符，百度翻译单次上限 ${MAX_TEXT}）`)
  if (!settings.appId || !settings.secretKey) {
    const error = new Error('尚未配置百度翻译 appid / 密钥')
    error.code = 'NOT_CONFIGURED'
    throw error
  }

  const salt = String(Date.now())
  const sign = createHash('md5').update(settings.appId + source + salt + settings.secretKey, 'utf8').digest('hex')
  const payload = await postForm({
    q: source,
    from: from && from !== 'auto' ? from : 'auto',
    to: pickTarget(source, to && to !== 'auto' ? to : settings.defaultTarget),
    appid: settings.appId,
    salt,
    sign,
    dict: '1',
    tts: '1',
  })

  if (payload && payload.error_code) {
    const code = String(payload.error_code)
    throw new Error(`${BAIDU_ERRORS[code] ?? '百度翻译返回错误'}（错误码 ${code}${payload.error_msg ? ` · ${payload.error_msg}` : ''}）`)
  }

  const lines = Array.isArray(payload?.trans_result)
    ? payload.trans_result.map((row) => String(row?.dst ?? '')).filter(Boolean)
    : []
  const symbols = Array.isArray(payload?.dict?.symbols) ? payload.dict.symbols : []
  const symbol = symbols[0] ?? null

  return {
    source,
    from: payload?.from ?? 'auto',
    to: payload?.to ?? '',
    lines,
    word: payload?.dict?.word_name ?? null,
    phonetic: symbol ? { en: symbol.ph_en ?? null, us: symbol.ph_am ?? null } : null,
    parts: Array.isArray(symbol?.parts)
      ? symbol.parts
        .map((part) => ({ part: String(part?.part ?? ''), means: Array.isArray(part?.means) ? part.means.map(String) : [] }))
        .filter((part) => part.means.length > 0)
      : [],
    tts: { src: payload?.src_tts ?? null, dst: payload?.dst_tts ?? null },
  }
}

/** Write a JSON response with no caching. */
function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(body)
}

/**
 * Same-origin gate. The routes are reachable by any local process, so a
 * request carrying another site's Origin (or a cross-site fetch hint) is
 * refused before the body is even read.
 * @returns true when the request may proceed.
 */
function admitted(request, response) {
  const site = String(request.headers['sec-fetch-site'] ?? '')
  if (site === 'cross-site') {
    sendJson(response, 403, { ok: false, error: '拒绝跨站请求' })
    return false
  }
  const origin = request.headers.origin
  if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
    let host = null
    try {
      host = new URL(origin).host
    } catch {
      host = null
    }
    if (host === null || host !== request.headers.host) {
      sendJson(response, 403, { ok: false, error: '拒绝非同源请求' })
      return false
    }
  }
  return true
}

/** Read a small JSON request body. */
function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        request.destroy()
        reject(new Error('请求体过大'))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        resolve(parsed && typeof parsed === 'object' ? parsed : {})
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    request.on('error', reject)
  })
}

/**
 * Mount the plugin's routes.
 * @param ctx - host context with a live `webServer` service.
 * @param ymlConfig - the entry's cordis.yml `config` block.
 * @returns disposer removing every registration.
 */
export function apply(ctx, ymlConfig) {
  ctx.inject(['webServer'], (hostCtx) => {
    const logger = ctx.logger
    const settings = () => effectiveConfig(ymlConfig)

    const disposeConfig = hostCtx.webServer.register({
      kind: 'exact',
      path: `${PREFIX}/config`,
      handler: async (request, response) => {
        if (!admitted(request, response)) return
        try {
          if (request.method === 'GET' || request.method === 'HEAD') {
            const current = settings()
            sendJson(response, 200, {
              ok: true,
              config: {
                appId: current.appId,
                hasSecret: current.secretKey !== '',
                defaultTarget: current.defaultTarget,
                shortcut: current.shortcut,
                enabled: current.enabled,
                showButton: current.showButton,
                configured: current.appId !== '' && current.secretKey !== '',
                configPath: configPath(),
              },
            })
            return
          }
          if (request.method === 'POST') {
            const body = await readJson(request)
            const patch = {}
            for (const key of ['appId', 'secretKey', 'defaultTarget', 'shortcut', 'enabled', 'showButton']) {
              if (Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined) patch[key] = body[key]
            }
            // An empty secret means "keep the stored one", so the settings card
            // never has to round-trip the key it only ever sees masked.
            if (patch.secretKey === '') delete patch.secretKey
            const saved = writeStored(patch)
            const merged = { ...DEFAULTS, ...saved }
            logger?.info?.('[dsh-translate] settings saved to %s', configPath())
            sendJson(response, 200, {
              ok: true,
              config: {
                appId: String(merged.appId ?? ''),
                hasSecret: String(merged.secretKey ?? '') !== '',
                defaultTarget: String(merged.defaultTarget ?? 'auto'),
                shortcut: String(merged.shortcut ?? DEFAULTS.shortcut),
                enabled: merged.enabled !== false,
                showButton: merged.showButton !== false,
                configured: String(merged.appId ?? '') !== '' && String(merged.secretKey ?? '') !== '',
                configPath: configPath(),
              },
            })
            return
          }
          sendJson(response, 405, { ok: false, error: '仅支持 GET / POST' })
        } catch (error) {
          sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    })

    const disposeTranslate = hostCtx.webServer.register({
      kind: 'exact',
      path: `${PREFIX}/translate`,
      handler: async (request, response) => {
        if (!admitted(request, response)) return
        try {
          if (request.method !== 'POST') {
            sendJson(response, 405, { ok: false, error: '仅支持 POST' })
            return
          }
          const body = await readJson(request)
          const result = await translate(body.text, body.from, body.to, settings())
          sendJson(response, 200, { ok: true, result })
        } catch (error) {
          sendJson(response, 200, {
            ok: false,
            code: error && typeof error === 'object' && 'code' in error ? error.code : null,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      },
    })

    logger?.info?.(
      '[dsh-translate] ready — configure the Baidu appid/key in the popup, or write %s',
      configPath(),
    )

    return () => {
      disposeTranslate()
      disposeConfig()
    }
  })
}
