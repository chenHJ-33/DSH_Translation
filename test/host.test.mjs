/**
 * Host-half test for dsh-translate — no appid and no network required.
 *
 * A mock Baidu endpoint stands in for fanyi-api.baidu.com (via the
 * DSH_TRANSLATE_ENDPOINT hook), a throwaway DSH_HOME keeps the settings file
 * out of the real profile, and a minimal webServer stands in for the host's:
 * real HTTP in, real HTTP out, so headers and the same-origin gate are
 * exercised for real.
 *
 *   node test/host.test.mjs
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APP_ID = '2024000000000001'
const SECRET = 'mock-secret-key'

let passed = 0
const failures = []

function check(label, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  ok   ${label}`)
  } else {
    failures.push(label)
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

// ------------------------------------------------------------ mock Baidu API

const seen = []

/** A realistic 通用文本翻译 answer, including dict + tts payloads. */
function baiduAnswer(form) {
  const word = form.get('q')
  return {
    from: 'en',
    to: form.get('to'),
    trans_result: [{ src: word, dst: word === 'hello' ? '你好' : `译文:${word}` }],
    dict: {
      word_name: word,
      symbols: [{
        ph_en: 'həˈləʊ',
        ph_am: 'həˈloʊ',
        parts: [
          { part: 'int.', means: ['喂', '哈罗'] },
          { part: 'n.', means: ['表示问候'] },
        ],
      }],
    },
    src_tts: 'https://example.invalid/src.mp3',
    dst_tts: 'https://example.invalid/dst.mp3',
  }
}

function startMockBaidu() {
  const server = createServer((request, response) => {
    let raw = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { raw += chunk })
    request.on('end', () => {
      const form = new URLSearchParams(raw)
      const q = form.get('q') ?? ''
      const expected = createHash('md5').update(APP_ID + q + form.get('salt') + SECRET, 'utf8').digest('hex')
      seen.push({
        q,
        from: form.get('from'),
        to: form.get('to'),
        appid: form.get('appid'),
        dict: form.get('dict'),
        tts: form.get('tts'),
        signOk: form.get('sign') === expected,
        contentType: request.headers['content-type'],
      })
      response.writeHead(200, { 'content-type': 'application/json' })
      if (q.startsWith('ERR')) {
        response.end(JSON.stringify({ error_code: '54001', error_msg: 'Invalid Sign' }))
        return
      }
      if (form.get('sign') !== expected) {
        response.end(JSON.stringify({ error_code: '54001', error_msg: 'Invalid Sign' }))
        return
      }
      response.end(JSON.stringify(baiduAnswer(form)))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

// ------------------------------------------------------------- fake webServer

/** Collects `register()` calls and answers real HTTP through them. */
function startHarness() {
  const routes = []
  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url, 'http://127.0.0.1')
    const route = routes.find((entry) => entry.kind === 'exact' && entry.path === pathname)
    if (route === undefined) {
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end('no route')
      return
    }
    void route.handler(request, response)
  })

  const webServer = {
    register(route) {
      routes.push(route)
      return () => {
        const index = routes.indexOf(route)
        if (index >= 0) routes.splice(index, 1)
      }
    },
  }

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      server,
      webServer,
      routes,
      base: `http://127.0.0.1:${server.address().port}`,
    }))
  })
}

// --------------------------------------------------------------------- runner

const home = mkdtempSync(join(tmpdir(), 'dsh-translate-test-'))
process.env.DSH_HOME = home
const baidu = await startMockBaidu()
process.env.DSH_TRANSLATE_ENDPOINT = `http://127.0.0.1:${baidu.port}/api/trans/vip/translate`

const harness = await startHarness()
let dispose = null
const logs = []
const ctx = {
  logger: { info: (...args) => logs.push(args.join(' ')), warn: () => {} },
  inject(deps, callback) {
    check('apply() injects webServer', Array.isArray(deps) && deps.includes('webServer'), JSON.stringify(deps))
    dispose = callback({ webServer: harness.webServer })
  },
}

const plugin = await import('../lib/index.js')
check('plugin exports a name', plugin.name === 'dsh-translate', String(plugin.name))
check('plugin exports apply()', typeof plugin.apply === 'function')
plugin.apply(ctx, undefined)

const api = {
  get: (path, headers) => fetch(`${harness.base}${path}`, { headers }),
  post: (path, body, headers) => fetch(`${harness.base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(headers ?? {}) },
    body: JSON.stringify(body),
  }),
}

console.log('\nconfig route')
check('registered exactly two routes', harness.routes.length === 2, harness.routes.map((r) => r.path).join(', '))
check(
  'routes are exact under one prefix',
  harness.routes.every((r) => r.kind === 'exact' && r.path.startsWith('/dsh-translate/')),
  JSON.stringify(harness.routes.map((r) => r.path)),
)
check('logger announced readiness', logs.some((line) => line.includes('[dsh-translate] ready')), logs.join(' | '))

{
  const payload = await (await api.get('/dsh-translate/config')).json()
  check('GET /config answers ok', payload.ok === true, JSON.stringify(payload))
  check('an unconfigured install reports configured:false', payload.config.configured === false)
  check('the secret is never echoed', !('secretKey' in payload.config), Object.keys(payload.config).join(','))
  check('shortcut defaults to Alt+T', payload.config.shortcut === 'Alt+T', payload.config.shortcut)
  check('configPath points into DSH_HOME', payload.config.configPath === join(home, 'dsh-translate.json'), payload.config.configPath)
}

console.log('\ntranslate before configuration')
{
  const payload = await (await api.post('/dsh-translate/translate', { text: 'hello' })).json()
  check('unconfigured translate is refused', payload.ok === false)
  check('with code NOT_CONFIGURED', payload.code === 'NOT_CONFIGURED', JSON.stringify(payload))
  check('and no request reached Baidu', seen.length === 0)
}

console.log('\nsaving credentials')
{
  const payload = await (await api.post('/dsh-translate/config', { appId: APP_ID, secretKey: SECRET })).json()
  check('POST /config answers ok', payload.ok === true, JSON.stringify(payload))
  check('hasSecret becomes true', payload.config.hasSecret === true)
  check('configured becomes true', payload.config.configured === true)
  check('the settings file exists', existsSync(join(home, 'dsh-translate.json')))
  const stored = JSON.parse(readFileSync(join(home, 'dsh-translate.json'), 'utf8'))
  check('the secret was persisted', stored.secretKey === SECRET, JSON.stringify(stored))
  const reread = await (await api.get('/dsh-translate/config')).json()
  check('a re-read still masks the secret', reread.config.hasSecret === true && !('secretKey' in reread.config))

  const kept = await (await api.post('/dsh-translate/config', { appId: APP_ID, secretKey: '' })).json()
  check('an empty secret keeps the stored one', kept.config.hasSecret === true)
}

console.log('\ntranslation')
{
  const payload = await (await api.post('/dsh-translate/translate', { text: 'hello', from: 'auto', to: 'auto' })).json()
  check('translate answers ok', payload.ok === true, JSON.stringify(payload).slice(0, 200))
  const result = payload.result
  check('lines carry the translation', result.lines.join('') === '你好', JSON.stringify(result.lines))
  check('phonetics are normalized', result.phonetic?.en === 'həˈləʊ' && result.phonetic?.us === 'həˈloʊ', JSON.stringify(result.phonetic))
  check('dictionary senses are normalized', result.parts.length === 2 && result.parts[0].means.length === 2, JSON.stringify(result.parts))
  check('tts urls survive', result.tts.src === 'https://example.invalid/src.mp3' && result.tts.dst === 'https://example.invalid/dst.mp3')
  check('the detected language is reported', result.from === 'en' && result.to === 'zh', `${result.from}->${result.to}`)

  const request = seen.at(-1)
  check('Baidu saw the right appid', request.appid === APP_ID)
  check('the signature matches md5(appid+q+salt+key)', request.signOk === true)
  check('dict and tts were requested', request.dict === '1' && request.tts === '1', `${request.dict}/${request.tts}`)
  check('the body is form-encoded', request.contentType === 'application/x-www-form-urlencoded', request.contentType)
  check('a word query sends from=auto', request.from === 'auto')
}

console.log('\ntarget-language choice')
{
  await api.post('/dsh-translate/translate', { text: '中文一句' })
  check('Chinese text defaults to en', seen.at(-1).to === 'en', seen.at(-1).to)
  await api.post('/dsh-translate/translate', { text: 'plain english' })
  check('non-Chinese text defaults to zh', seen.at(-1).to === 'zh', seen.at(-1).to)
  await api.post('/dsh-translate/translate', { text: 'plain english', to: 'jp' })
  check('an explicit target is honoured', seen.at(-1).to === 'jp', seen.at(-1).to)

  await api.post('/dsh-translate/config', { defaultTarget: 'fra' })
  await api.post('/dsh-translate/translate', { text: 'plain english' })
  check('the configured default takes over', seen.at(-1).to === 'fra', seen.at(-1).to)
  await api.post('/dsh-translate/config', { defaultTarget: 'auto' })
}

console.log('\nerrors and limits')
{
  const payload = await (await api.post('/dsh-translate/translate', { text: 'ERR-sign' })).json()
  check('a Baidu error code is refused', payload.ok === false)
  check('and translated into words', typeof payload.error === 'string' && payload.error.includes('密钥'), payload.error)

  const long = await (await api.post('/dsh-translate/translate', { text: 'a'.repeat(6001) })).json()
  check('over-long text is refused before the call', long.ok === false && long.error.includes('过长'), long.error)

  const empty = await (await api.post('/dsh-translate/translate', { text: '   ' })).json()
  check('empty text is refused', empty.ok === false, JSON.stringify(empty))

  const bad = await fetch(`${harness.base}/dsh-translate/translate`)
  check('GET /translate is 405', bad.status === 405, String(bad.status))

  const badJson = await fetch(`${harness.base}/dsh-translate/config`, { method: 'POST', body: '{not json' })
  check('malformed JSON is 400', badJson.status === 400, String(badJson.status))
}

console.log('\nsame-origin gate')
{
  const crossSite = await api.post('/dsh-translate/translate', { text: 'hello' }, { 'sec-fetch-site': 'cross-site' })
  check('a cross-site request is 403', crossSite.status === 403, String(crossSite.status))
  const foreign = await api.post('/dsh-translate/config', { appId: 'x' }, { origin: 'http://evil.example' })
  check('a foreign Origin is 403', foreign.status === 403, String(foreign.status))
  const sameOrigin = await api.post('/dsh-translate/config', { appId: APP_ID }, { origin: harness.base })
  check('the page itself is admitted', sameOrigin.status === 200, String(sameOrigin.status))
}

console.log('\ndisposal')
{
  check('apply() handed back a disposer', typeof dispose === 'function', typeof dispose)
  dispose()
  check('every route was removed', harness.routes.length === 0, String(harness.routes.length))
  const gone = await fetch(`${harness.base}/dsh-translate/config`)
  check('and the server answers 404 again', gone.status === 404, String(gone.status))
}

// ---------------------------------------------------------------------- teardown

harness.server.close()
baidu.server.close()
rmSync(home, { recursive: true, force: true })

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  console.log(`failed: ${failures.join(' | ')}`)
  process.exitCode = 1
}
