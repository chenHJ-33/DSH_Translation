/**
 * Client-half test for dsh-translate — no browser, no real React, no network.
 *
 * The bundle under test is the exact file the client module loader fetches, so
 * this runs it the way the shell does: install a fake `window`/`document`,
 * capture `window.__ModuleLoader__.load({ id, factory })`, hand the factory a
 * `require` that answers `react`, then drive the component through a tiny
 * hooks runtime that mimics useState/useRef/useCallback/useEffect closely
 * enough to observe real re-renders and event wiring.
 *
 *   node test/client.test.mjs
 */

import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const BUNDLE = join(here, '..', 'client', 'client.js')

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

// ------------------------------------------------------------------ fake DOM

function makeElement(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    children: [],
    style: {},
    dataset: {},
    id: '',
    className: '',
    value: '',
    textContent: '',
    appendChild(child) { this.children.push(child); return child },
    removeChild(child) {
      const index = this.children.indexOf(child)
      if (index >= 0) this.children.splice(index, 1)
      return child
    },
    setAttribute(name, value) { this[name] = value; if (name === 'id') this.id = value },
    getAttribute(name) { return this[name] ?? null },
    contains(node) {
      if (node === this) return true
      return this.children.some((child) => (child && child.contains ? child.contains(node) : child === node))
    },
    getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 800, right: 1280, bottom: 800 } },
    select() {},
    focus() {},
    remove() {},
    addEventListener() {},
    removeEventListener() {},
  }
}

function makeEventTarget() {
  const handlers = new Map()
  return {
    addEventListener(type, fn) {
      if (!handlers.has(type)) handlers.set(type, [])
      handlers.get(type).push(fn)
    },
    removeEventListener(type, fn) {
      const list = handlers.get(type)
      if (list) handlers.set(type, list.filter((entry) => entry !== fn))
    },
    listenerCount(type) { return (handlers.get(type) ?? []).length },
    dispatch(type, event) {
      for (const fn of [...(handlers.get(type) ?? [])]) fn(event)
    },
  }
}

const byId = new Map()
const documentTarget = makeEventTarget()
const head = makeElement('head')
const baseAppend = head.appendChild.bind(head)
head.appendChild = (child) => {
  if (child && child.id) byId.set(child.id, child)
  return baseAppend(child)
}

const document = {
  ...documentTarget,
  baseURI: 'http://127.0.0.1:19387/',
  documentElement: makeElement('html'),
  head,
  body: makeElement('body'),
  activeElement: null,
  createElement: (tag) => makeElement(tag),
  getElementById: (id) => byId.get(id) ?? null,
  execCommand: () => true,
}

const windowTarget = makeEventTarget()
const opened = []
const selection = { isCollapsed: true, rangeCount: 0, text: '', toString() { return this.text } }
const window = {
  ...windowTarget,
  innerWidth: 1280,
  innerHeight: 800,
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (timer) => clearTimeout(timer),
  getSelection: () => (selection.rangeCount > 0 ? selection : null),
  open: (...args) => { opened.push(args); return null },
  matchMedia: () => ({ matches: true }),
}

// -------------------------------------------------------------- fake browser

const requests = []
const copied = []
const played = []
let translateImpl = null

const state = {
  config: { enabled: true, showButton: true, shortcut: 'Alt+T', defaultTarget: 'auto', appId: '', hasSecret: false, configured: false, configPath: '/tmp/dsh-translate.json' },
}

function reply(body, status = 200) {
  return { status, json: async () => body }
}

async function fetchMock(url, init) {
  const target = String(url)
  const body = init && init.body ? JSON.parse(init.body) : null
  requests.push({ url: target, method: init?.method ?? 'GET', body, headers: init?.headers ?? {} })
  if (init?.method === 'POST' && target.endsWith('/dsh-translate/config')) {
    const next = { ...state.config, ...body }
    if (typeof body.secretKey === 'string' && body.secretKey !== '') next.hasSecret = true
    delete next.secretKey
    state.config = next
    return reply({ ok: true, config: next })
  }
  if (init?.method === 'POST' && target.endsWith('/dsh-translate/translate')) {
    return reply(translateImpl(body))
  }
  if (target.endsWith('/dsh-translate/config')) return reply({ ok: true, config: state.config })
  throw new Error(`unexpected request ${target}`)
}

const sandbox = {
  window,
  document,
  navigator: { clipboard: { writeText: async (text) => { copied.push(text) } } },
  fetch: fetchMock,
  getComputedStyle: () => ({ backgroundColor: 'rgb(24, 26, 32)' }),
  Audio: class {
    constructor(src) { this.src = src }
    play() { played.push(this.src); return Promise.resolve() }
  },
  matchMedia: window.matchMedia,
  console,
  URL,
  Promise,
  setTimeout,
  clearTimeout,
  queueMicrotask,
}
sandbox.globalThis = sandbox

// ------------------------------------------------------------- mini React

function sameDeps(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
}

/**
 * Stand-in for a real DOM ref. The harness renders a virtual tree, so the
 * "node" a ref points at answers `contains` by walking that subtree — enough
 * to exercise the overlay's own-UI checks and its drag geometry.
 */
function refHandle(node) {
  return {
    node,
    contains(target) { return subtreeContains(node, target) },
    getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 800, right: 1280, bottom: 800 } },
  }
}
function subtreeContains(node, target) {
  if (target === null || target === undefined) return false
  if (node === target) return true
  if (node === null || typeof node !== 'object') return false
  for (const child of node.props?.children ?? []) {
    if (subtreeContains(child, target)) return true
  }
  return false
}

function makeReact(getComponent) {
  const hooks = { states: [], cursor: 0 }
  let schedule = () => {}
  const React = {
    createElement(type, props, ...children) {
      const merged = { ...(props ?? {}) }
      const kids = children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false && child !== true)
      if (kids.length > 0) merged.children = kids
      const node = { type, props: merged }
      if (merged.ref && typeof merged.ref === 'object') merged.ref.current = refHandle(node)
      return node
    },
    useState(initial) {
      const index = hooks.cursor++
      const states = hooks.states
      if (!(index in states)) states[index] = { value: typeof initial === 'function' ? initial() : initial }
      const set = (next) => {
        states[index].value = typeof next === 'function' ? next(states[index].value) : next
        schedule()
      }
      return [states[index].value, set]
    },
    useRef(initial) {
      const index = hooks.cursor++
      const states = hooks.states
      if (!(index in states)) states[index] = { value: { current: initial } }
      return states[index].value
    },
    useCallback(fn, deps) {
      const index = hooks.cursor++
      const slot = hooks.states[index]
      if (!slot || !sameDeps(slot.deps, deps)) hooks.states[index] = { deps, value: fn }
      return hooks.states[index].value
    },
    useEffect(fn, deps) {
      const index = hooks.cursor++
      const slot = hooks.states[index]
      if (!slot) hooks.states[index] = { deps, fn, cleanup: null, pending: true }
      else if (!sameDeps(slot.deps, deps)) { slot.deps = deps; slot.fn = fn; slot.pending = true }
      else slot.fn = fn
    },
  }
  let tree = null
  let queued = false
  const run = () => {
    hooks.cursor = 0
    tree = getComponent()()
    for (const slot of hooks.states) {
      if (slot && slot.pending) {
        slot.pending = false
        if (typeof slot.cleanup === 'function') slot.cleanup()
        const cleanup = slot.fn()
        slot.cleanup = typeof cleanup === 'function' ? cleanup : null
      }
    }
    return tree
  }
  schedule = () => {
    if (queued) return
    queued = true
    queueMicrotask(() => { queued = false; run() })
  }
  React.__render = run
  React.__tree = () => tree
  return React
}

// ------------------------------------------------------------- bundle loader

const source = readFileSync(BUNDLE, 'utf8')
let captured = null
sandbox.window.__ModuleLoader__ = { load: (definition) => { captured = definition } }

const context = createContext(sandbox)
runInContext(source, context, { filename: BUNDLE })

check('the bundle registers itself with the module loader', captured !== null && captured !== undefined)
check('under the package name', captured?.id === 'dsh-translate', String(captured?.id))

const required = []
let Component = null
let registered = null
const React = makeReact(() => Component)
const moduleExports = captured.factory((name) => {
  required.push(name)
  if (name === 'react') return React
  throw new Error(`the client bundle must not require ${name}`)
})

check('the factory only requires react', required.length === 1 && required[0] === 'react', required.join(','))
check('the bundle exports a name', moduleExports.name === 'dsh-translate', String(moduleExports.name))
check('the bundle injects slots', Array.isArray(moduleExports.inject) && moduleExports.inject.join() === 'slots', JSON.stringify(moduleExports.inject))

// ------------------------------------------------------------------- mounting

const injected = []
const entryProps = []
const ctx = {
  slots: {
    inject(key, callback) { injected.push(key); return callback() },
    register(props, component) {
      entryProps.push(props)
      if (props.name === 'shell.overlay') { Component = component; registered = props }
      return () => {}
    },
  },
}
moduleExports.apply(ctx)

check('apply() fills both surfaces', injected.join() === 'shell.overlay,settings.section', injected.join(','))
check('the overlay entry is named shell.overlay', registered?.name === 'shell.overlay', JSON.stringify(registered))
check('with a stable id', registered?.id === 'dsh-translate', String(registered?.id))
check('and a label for the shell', registered?.label?.() === '划词翻译', String(registered?.label?.()))
check(
  'the settings pane is registered under its own id',
  entryProps.some((props) => props.name === 'settings.section' && props.id === 'dsh-translate'),
  JSON.stringify(entryProps),
)
check('the stylesheet is installed once', document.getElementById('dsh-translate/styles') !== null)
check(
  'the stylesheet keys off the root class, not global selectors',
  String(document.getElementById('dsh-translate/styles').textContent).includes('.dsht-root'),
)

const flush = async (ms = 0) => { await new Promise((resolve) => setTimeout(resolve, ms)) }

// -------------------------------------------------------------- helpers

const find = (node, predicate) => {
  if (node === null || node === undefined || typeof node !== 'object') return null
  if (node.type && predicate(node)) return node
  for (const child of node.props?.children ?? []) {
    const hit = find(child, predicate)
    if (hit) return hit
  }
  return null
}
const findAll = (node, predicate, out = []) => {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (node.type && predicate(node)) out.push(node)
  for (const child of node.props?.children ?? []) findAll(child, predicate, out)
  return out
}
const byClass = (root, name) => find(root, (node) => String(node.props.className ?? '').split(/\s+/).includes(name))
const allByClass = (root, name) => findAll(root, (node) => String(node.props.className ?? '').split(/\s+/).includes(name))
const textOf = (node) => {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  return (node.props?.children ?? []).map(textOf).join('')
}
const byTitle = (root, title) => find(root, (node) => node.props?.title === title)

const mouseUp = (x, y, target = {}) => document.dispatch('mouseup', {
  button: 0, clientX: x, clientY: y, target, preventDefault() {}, stopPropagation() {},
})
const keyDown = (key, modifiers = {}, code) => {
  const event = {
    key, code, repeat: false, altKey: false, ctrlKey: false, shiftKey: false, metaKey: false,
    prevented: false, stopped: false,
    preventDefault() { this.prevented = true }, stopPropagation() { this.stopped = true },
    ...modifiers,
  }
  window.dispatch('keydown', event)
  return event
}
const selectText = (text) => { selection.isCollapsed = false; selection.rangeCount = 1; selection.text = text }

console.log('\nconfig load and the selection bubble')

React.__render()
check('the overlay renders a fixed root', byClass(React.__tree(), 'dsht-root') !== null)
check('the theme is probed for a dark surface', String(byClass(React.__tree(), 'dsht-root').props.className).includes('dsht-dark'))

mouseUp(200, 300)
await flush(40)
check('no bubble before the settings arrive', byClass(React.__tree(), 'dsht-bubble') === null)
check('the config route was read', requests.some((entry) => entry.url === '/dsh-translate/config' && entry.method === 'GET'))

selectText('Integer')
mouseUp(200, 300)
await flush(40)
const bubble = byClass(React.__tree(), 'dsht-bubble')
check('a selection raises the bubble', bubble !== null)
check('the bubble sits beside the cursor', bubble?.props.style.left === '210px' && bubble?.props.style.top === '312px', JSON.stringify(bubble?.props.style))
check('the bubble names the action', textOf(bubble).includes('翻译'), textOf(bubble))
check('the bubble advertises the hotkey', String(bubble?.props.title).includes('Alt+T'), String(bubble?.props.title))

selectText('   ')
mouseUp(400, 300)
await flush(40)
check('blank selections raise nothing', byClass(React.__tree(), 'dsht-bubble') === null)

selectText('x'.repeat(3001))
mouseUp(400, 300)
await flush(40)
check('oversized selections raise nothing', byClass(React.__tree(), 'dsht-bubble') === null)

console.log('\nthe card')

selectText('Integer')
mouseUp(200, 300)
await flush(40)
translateImpl = (body) => ({
  ok: true,
  result: {
    from: 'en', to: 'zh', lines: ['整数'],
    phonetic: { en: 'ˈɪntɪdʒə', us: '' },
    parts: [{ part: 'n.', means: ['整数', '整型'] }],
    tts: { src: 'https://example.invalid/src.mp3', dst: 'https://example.invalid/dst.mp3' },
  },
})
byClass(React.__tree(), 'dsht-bubble').props.onClick()
await flush(40)
const sent = requests.at(-1)
check('clicking the bubble asks the host to translate', sent.url === '/dsh-translate/translate' && sent.method === 'POST', `${sent.method} ${sent.url}`)
check('with the selected text and auto languages', sent.body.text === 'Integer' && sent.body.from === 'auto' && sent.body.to === 'auto', JSON.stringify(sent.body))
check('the bubble goes away', byClass(React.__tree(), 'dsht-bubble') === null)

const panel = byClass(React.__tree(), 'dsht-panel')
check('the card appears', panel !== null)
check('the card is pinned to the selection', panel?.props.style.left === '200px' && panel?.props.style.top === '316px', JSON.stringify(panel?.props.style))
check('the source text is shown', textOf(byClass(React.__tree(), 'dsht-src')) === 'Integer', textOf(byClass(React.__tree(), 'dsht-src')))
check('the phonetic is shown', textOf(byClass(React.__tree(), 'dsht-phonetic')).includes('ˈɪntɪdʒə'), textOf(byClass(React.__tree(), 'dsht-phonetic')))
check('the translation is shown', textOf(byClass(React.__tree(), 'dsht-dst')).includes('整数'))
check('dictionary senses are shown', textOf(allByClass(React.__tree(), 'dsht-sense')[0] ?? { props: {} }).includes('整型'), textOf(allByClass(React.__tree(), 'dsht-sense')[0] ?? { props: {} }))
check('the footer credits the engine', textOf(byClass(React.__tree(), 'dsht-foot')).includes('百度翻译'))

byTitle(React.__tree(), '朗读原文').props.onClick()
check('the source audio plays', played.includes('https://example.invalid/src.mp3'), played.join(','))
byTitle(React.__tree(), '朗读译文').props.onClick()
check('the target audio plays', played.includes('https://example.invalid/dst.mp3'), played.join(','))

const copyButton = find(React.__tree(), (node) => node.type === 'button' && textOf(node) === '复制')
copyButton.props.onClick()
await flush(0)
check('copy puts the translation on the clipboard', copied.at(-1) === '整数', copied.join('|'))

console.log('\nswitching the target language')

byTitle(React.__tree(), '切换目标语言，重新翻译').props.onClick()
await flush(40)
check('the swap re-translates into English', requests.at(-1).body.to === 'en', JSON.stringify(requests.at(-1).body))
check('and keeps the same text', requests.at(-1).body.text === 'Integer')

console.log('\nthe hotkey')

const before = requests.length
keyDown('Escape')
await flush(0)
check('Escape closes the card', byClass(React.__tree(), 'dsht-panel') === null)

selectText('hello world')
const wrong = keyDown('t', { ctrlKey: true }, 'KeyT')
await flush(40)
check('a different modifier does not translate', requests.length === before && wrong.prevented === false)

const hot = keyDown('t', { altKey: true }, 'KeyT')
await flush(40)
check('the configured hotkey sends the selection', requests.length === before + 1 && requests.at(-1).body.text === 'hello world', JSON.stringify(requests.at(-1)?.body))
check('and the app never sees the keystroke', hot.prevented === true && hot.stopped === true)
check('the card opened for it', byClass(React.__tree(), 'dsht-panel') !== null)

console.log('\nthe setup form')

selectText('未配置的句子')
translateImpl = (body) => (state.config.hasSecret && state.config.appId !== ''
  ? {
    ok: true,
    result: { from: 'en', to: 'zh', lines: ['配置完成'], parts: [], tts: {} },
  }
  : { ok: false, code: 'NOT_CONFIGURED', error: '尚未配置百度翻译 APP ID 与密钥' })
keyDown('t', { altKey: true }, 'KeyT')
await flush(40)
const form = byClass(React.__tree(), 'dsht-form')
check('an unconfigured host opens the setup form', form !== null)
check('with a field for the APP ID', textOf(form).includes('APP ID'))
check('and the not-configured reason', textOf(form).includes('尚未配置'), textOf(form))
check('the save button is disabled until it is filled', find(byClass(React.__tree(), 'dsht-actions'), (node) => node.type === 'button' && textOf(node).startsWith('保存'))?.props.disabled === true)

// Each keystroke re-renders, so the inputs must be read back from the fresh tree.
const inputAt = (index) => findAll(byClass(React.__tree(), 'dsht-form'), (node) => node.type === 'input')[index]
inputAt(0).props.onChange({ target: { value: '2024000000000001' } })
await flush(0)
check('the typed APP ID is kept', inputAt(0).props.value === '2024000000000001', String(inputAt(0).props.value))
inputAt(1).props.onChange({ target: { value: 'mock-secret-key' } })
await flush(0)
check('the typed secret is kept', inputAt(1).props.value === 'mock-secret-key', String(inputAt(1).props.value))
check('and the APP ID survives the secret keystroke', inputAt(0).props.value === '2024000000000001', String(inputAt(0).props.value))
const saveButton = find(byClass(React.__tree(), 'dsht-actions'), (node) => node.type === 'button' && textOf(node).startsWith('保存'))
check('the save button enables once filled', saveButton?.props.disabled === false)
saveButton.props.onClick()
await flush(60)
const saved = requests.find((entry) => entry.method === 'POST' && entry.url === '/dsh-translate/config')
check('saving posts both credentials to the host', saved?.body.appId === '2024000000000001' && saved?.body.secretKey === 'mock-secret-key', JSON.stringify(saved?.body))
check('the form closes after a successful save', byClass(React.__tree(), 'dsht-form') === null)
check('and the translation is retried', requests.at(-1).url === '/dsh-translate/translate' && requests.at(-1).body.text === '未配置的句子', JSON.stringify(requests.at(-1)?.body))
check('the retry now succeeds', textOf(byClass(React.__tree(), 'dsht-dst')).includes('配置完成'), textOf(byClass(React.__tree(), 'dsht-panel')))

console.log('\nfailure paths')

translateImpl = () => ({ ok: false, error: '百度翻译拒绝了这个请求' })
selectText('boom')
keyDown('t', { altKey: true }, 'KeyT')
await flush(40)
check('a host error is shown in the card', textOf(byClass(React.__tree(), 'dsht-panel')).includes('百度翻译拒绝了这个请求'))
byTitle(React.__tree(), '关闭（Esc）').props.onClick()
await flush(0)
check('the close button dismisses the card', byClass(React.__tree(), 'dsht-panel') === null)

const offline = async () => { throw new Error('Failed to fetch') }
sandbox.fetch = offline
translateImpl = () => ({ ok: true, result: { from: 'en', to: 'zh', lines: ['网络'], parts: [], tts: {} } })
selectText('offline')
keyDown('t', { altKey: true }, 'KeyT')
await flush(40)
check(
  'a dead connection surfaces in the card',
  textOf(byClass(React.__tree(), 'dsht-panel')).includes('Failed to fetch'),
  textOf(byClass(React.__tree(), 'dsht-panel')),
)
sandbox.fetch = fetchMock
byTitle(React.__tree(), '关闭（Esc）').props.onClick()

console.log('\nlive settings updates')

// The shell keeps the settings pane in the same document, so a keystroke that
// starts inside it must never reach the overlay's own hotkey.
const paneTarget = { closest: (selector) => (selector === '[data-dsht-settings]' ? {} : null) }
const beforeGuard = requests.length
const guarded = keyDown('t', { altKey: true, target: paneTarget }, 'KeyT')
await flush(40)
check(
  'the overlay stands down while the settings pane has focus',
  guarded.prevented === false && requests.length === beforeGuard,
  `${requests.length - beforeGuard} request(s)`,
)

moduleExports.settingsStore.publish({ loaded: true, shortcut: 'Ctrl+Alt+K' })
await flush(0)
selectText('live update')
const stale = keyDown('t', { altKey: true }, 'KeyT')
await flush(40)
check('a settings change retires the old hotkey', stale.prevented === false && requests.length === beforeGuard, String(stale.prevented))
const fresh = keyDown('k', { ctrlKey: true, altKey: true }, 'KeyK')
await flush(40)
check('and the new hotkey answers at once', fresh.prevented === true && requests.at(-1).body.text === 'live update', JSON.stringify(requests.at(-1)?.body))
check(
  'the card advertises the new hotkey',
  textOf(byClass(React.__tree(), 'dsht-foot')).includes('Ctrl+Alt+K'),
  textOf(byClass(React.__tree(), 'dsht-foot')),
)
moduleExports.settingsStore.publish({ shortcut: 'Alt+T' })
await flush(0)
check('restoring the default hotkey takes effect the same way', moduleExports.settingsStore.value.shortcut === 'Alt+T')

console.log('\nthe settings pane entry')

runInContext(source, context, { filename: BUNDLE })
let Section = null
let sectionProps = null
const ReactSec = makeReact(() => Section)
const secExports = captured.factory((name) => {
  if (name === 'react') return ReactSec
  throw new Error(`the client bundle must not require ${name}`)
})
const secInjected = []
secExports.apply({
  slots: {
    inject(key, callback) { secInjected.push(key); return callback() },
    register(props, component) {
      if (props.name === 'settings.section') { Section = component; sectionProps = props }
      return () => {}
    },
  },
})

check('the pane registers into settings.section', sectionProps !== null && secInjected.includes('settings.section'), secInjected.join(','))
check('with its own id and label', sectionProps?.id === 'dsh-translate' && sectionProps?.label?.() === '划词翻译', JSON.stringify(sectionProps))

ReactSec.__render()
await flush(20)

const pane = () => ReactSec.__tree()
const noteText = () => textOf(byClass(pane(), 'dsht-sec-pad'))
const findInPane = (predicate) => find(pane(), predicate)
const appIdField = () => findInPane((node) => node.type === 'input' && node.props.placeholder === 'APP ID')
const secretField = () => findInPane((node) => node.type === 'input' && node.props.type === 'password')
const captureField = () => findInPane((node) => node.type === 'input' && node.props['data-dsht-capture'] === '1')
const switches = () => findAll(pane(), (node) => node.type === 'input' && node.props.type === 'checkbox')
const targetSelect = () => findInPane((node) => node.type === 'select')
const buttonExact = (label) => findAll(pane(), (node) => node.type === 'button').find((node) => textOf(node) === label) ?? null

check('the pane renders', byClass(pane(), 'dsht-sec') !== null)
check('and flags itself for the overlay guard', byClass(pane(), 'dsht-sec').props['data-dsht-settings'] === '1')
check('the pane reads the config itself', requests.some((entry) => entry.url === '/dsh-translate/config' && entry.method === 'GET'))
check('the pane lays out one row per concern', allByClass(pane(), 'dsht-sec-row').length === 5, String(allByClass(pane(), 'dsht-sec-row').length))
check('the APP ID field shows the stored id', appIdField()?.props.value === '2024000000000001', String(appIdField()?.props.value))
check(
  'the secret field never receives the stored secret',
  secretField()?.props.value === '' && String(secretField()?.props.placeholder).includes('已保存'),
  `${secretField()?.props.value} / ${secretField()?.props.placeholder}`,
)
check('the hotkey field shows the live hotkey', captureField()?.props.value === 'Alt+T', String(captureField()?.props.value))

console.log('\nthe engine credentials')

check('the save button is ready while a secret is stored', buttonExact('保存')?.props.disabled === false)
appIdField().props.onChange({ target: { value: '' } })
await flush(0)
check('an empty APP ID blocks saving', buttonExact('保存')?.props.disabled === true)
appIdField().props.onChange({ target: { value: '2024111111111111' } })
await flush(0)
secretField().props.onChange({ target: { value: 'fresh-secret-key' } })
await flush(0)
check('the pane keeps both typed values', appIdField().props.value === '2024111111111111' && secretField().props.value === 'fresh-secret-key')
check('and the save button unlocks', buttonExact('保存')?.props.disabled === false)

const beforeSave = requests.length
buttonExact('保存').props.onClick()
await flush(60)
const posted = requests.slice(beforeSave).find((entry) => entry.method === 'POST' && entry.url === '/dsh-translate/config')
check('saving posts both credentials', posted?.body.appId === '2024111111111111' && posted?.body.secretKey === 'fresh-secret-key', JSON.stringify(posted?.body))
check('the pane reports the save', noteText().includes('已保存'), noteText())
check('the secret field is cleared afterwards', secretField()?.props.value === '')
check('and the live channel carries the new id', secExports.settingsStore.value.appId === '2024111111111111', JSON.stringify(secExports.settingsStore.value))

console.log('\ntesting the engine')

translateImpl = () => ({ ok: true, result: { from: 'en', to: 'zh', lines: ['你好，世界！'], parts: [], tts: {} } })
buttonExact('保存并测试').props.onClick()
await flush(80)
check(
  'the test translates a sample sentence',
  requests.at(-1).url === '/dsh-translate/translate' && requests.at(-1).body.text === 'Hello, world!',
  JSON.stringify(requests.at(-1)?.body),
)
check('and reports the round-trip', noteText().includes('连接正常') && noteText().includes('你好，世界！'), noteText())

translateImpl = () => ({ ok: false, code: '54001', error: '签名错误（54001）' })
buttonExact('保存并测试').props.onClick()
await flush(80)
check('a rejected key is reported verbatim', noteText().includes('54001'), noteText())

console.log('\nthe hotkey capture field')

check('the capture field is read-only so a click can focus it', captureField()?.props.readOnly === true)
captureField().props.onFocus()
await flush(0)
check('focusing invites a combination', String(captureField().props.value).includes('按下'), String(captureField().props.value))

const combo = (key, code, modifiers = {}) => ({
  key, code, altKey: false, ctrlKey: false, shiftKey: false, metaKey: false,
  prevented: false, stopped: false,
  preventDefault() { this.prevented = true }, stopPropagation() { this.stopped = true },
  ...modifiers,
})

captureField().props.onKeyDown(combo('Control', 'ControlLeft', { ctrlKey: true }))
await flush(0)
check('holding a modifier previews the combination', String(captureField().props.value).includes('Ctrl+…'), String(captureField().props.value))

const beforeBare = requests.length
const bare = combo('q', 'KeyQ')
captureField().props.onKeyDown(bare)
await flush(0)
check('a bare key is refused', requests.length === beforeBare && noteText().includes('修饰键'), noteText())
check('and the pane swallows the keystroke', bare.prevented === true && bare.stopped === true)

captureField().props.onKeyDown(combo('q', 'KeyQ', { ctrlKey: true, altKey: true }))
await flush(60)
check('a combination is stored as a spec', requests.at(-1).body.shortcut === 'Ctrl+Alt+Q', JSON.stringify(requests.at(-1)?.body))
check('the field shows keyboard spelling', captureField().props.value === 'Ctrl+Alt+Q', String(captureField().props.value))
check('and the live channel retargets the overlay', secExports.settingsStore.value.shortcut === 'Ctrl+Alt+Q', String(secExports.settingsStore.value.shortcut))

captureField().props.onFocus()
await flush(0)
const beforeEscape = requests.length
captureField().props.onKeyDown(combo('Escape', 'Escape'))
await flush(0)
check('Escape abandons the capture', requests.length === beforeEscape)
check('and leaves the hotkey alone', captureField().props.value === 'Ctrl+Alt+Q', String(captureField().props.value))

captureField().props.onKeyDown(combo('Backspace', 'Backspace'))
await flush(60)
check('Backspace restores the default hotkey', requests.at(-1).body.shortcut === 'Alt+T', JSON.stringify(requests.at(-1)?.body))
check('and the field follows', captureField().props.value === 'Alt+T', String(captureField().props.value))

console.log('\nthe behaviour switches')

check('both switches start enabled', switches()[0]?.props.checked === true && switches()[1]?.props.checked === true)
const beforeToggle = requests.length
switches()[1].props.onChange({ target: { checked: false } })
await flush(60)
const toggled = requests.slice(beforeToggle).find((entry) => entry.method === 'POST' && entry.url === '/dsh-translate/config')
check('a switch patches only its own key', toggled !== undefined && toggled.body.showButton === false && Object.keys(toggled.body).length === 1, JSON.stringify(toggled?.body))
check('and reflects the saved value', switches()[1]?.props.checked === false)
check('the overlay sees the same switch', secExports.settingsStore.value.showButton === false, JSON.stringify(secExports.settingsStore.value))

check('the target language defaults to auto', targetSelect()?.props.value === 'auto', String(targetSelect()?.props.value))
targetSelect().props.onChange({ target: { value: 'jp' } })
await flush(60)
check('picking a language patches the default target', requests.at(-1).body.defaultTarget === 'jp', JSON.stringify(requests.at(-1)?.body))
check('and the select follows', targetSelect()?.props.value === 'jp', String(targetSelect()?.props.value))
const options = findAll(pane(), (node) => node.type === 'option')
check(
  'the option list is localized',
  options.length === 15 && textOf(options[0]) === '自动（中 ↔ 英）' && textOf(options[4]) === '日语',
  options.map((option) => textOf(option)).join('/'),
)

console.log('\ndragging the card and clicking outside')

moduleExports.settingsStore.publish({ loaded: true, enabled: true, showButton: true, shortcut: 'Alt+T' })
translateImpl = () => ({
  ok: true,
  result: { from: 'en', to: 'zh', lines: ['拖动我'], phonetic: { en: '', us: '' }, parts: [], tts: { src: '', dst: '' } },
})

selectText('Drag me')
mouseUp(200, 300)
await flush(40)
byClass(React.__tree(), 'dsht-bubble').props.onClick()
await flush(40)
const anchored = byClass(React.__tree(), 'dsht-panel')
check('a fresh card is anchored to the selection', anchored?.props.style.left === '200px', JSON.stringify(anchored?.props.style))
check('the header offers a drag handle', byClass(React.__tree(), 'dsht-grip') !== null)

let prevented = 0
byClass(React.__tree(), 'dsht-head').props.onMouseDown({
  button: 0, clientX: 100, clientY: 50, target: {}, preventDefault() { prevented += 1 },
})
await flush(0)
check('grabbing the header suppresses the native text drag', prevented === 1, String(prevented))
check(
  'and marks the card as being dragged',
  String(byClass(React.__tree(), 'dsht-head').props.className).includes('dsht-dragging'),
  String(byClass(React.__tree(), 'dsht-head').props.className),
)

window.dispatch('mousemove', { clientX: 160, clientY: 90 })
await flush(0)
const moved = byClass(React.__tree(), 'dsht-panel')
check('the card follows the pointer', moved?.props.style.left === '60px' && moved?.props.style.top === '40px', JSON.stringify(moved?.props.style))

document.dispatch('mouseup', { button: 0, clientX: 160, clientY: 90, target: {} })
await flush(0)
check('dropping the card keeps it open', byClass(React.__tree(), 'dsht-panel') !== null)
check('a drag raises no selection bubble', byClass(React.__tree(), 'dsht-bubble') === null)
check(
  'and the header leaves the dragging state',
  String(byClass(React.__tree(), 'dsht-head').props.className).includes('dsht-dragging') === false,
)

byTitle(React.__tree(), '切换目标语言，重新翻译').props.onClick()
await flush(40)
check(
  're-translating the same text keeps the dragged place',
  byClass(React.__tree(), 'dsht-panel')?.props.style.left === '60px',
  JSON.stringify(byClass(React.__tree(), 'dsht-panel')?.props.style),
)

selectText('Another word')
mouseUp(300, 400)
await flush(40)
byClass(React.__tree(), 'dsht-bubble').props.onClick()
await flush(40)
check(
  'a new selection re-anchors the card',
  byClass(React.__tree(), 'dsht-panel')?.props.style.left === '300px',
  JSON.stringify(byClass(React.__tree(), 'dsht-panel')?.props.style),
)

document.dispatch('mousedown', { button: 0, target: byClass(React.__tree(), 'dsht-body') })
await flush(0)
check('pressing inside the card leaves it open', byClass(React.__tree(), 'dsht-panel') !== null)

selectText('Bubble click')
mouseUp(200, 300)
await flush(40)
document.dispatch('mousedown', { button: 0, target: byClass(React.__tree(), 'dsht-bubble') })
await flush(0)
check('pressing the bubble does not unmount it', byClass(React.__tree(), 'dsht-bubble') !== null)

document.dispatch('mousedown', { button: 0, target: { tagName: 'DIV' } })
await flush(0)
check('pressing outside closes the bubble', byClass(React.__tree(), 'dsht-bubble') === null)
check('and closes the card with it', byClass(React.__tree(), 'dsht-panel') === null)

console.log('\ndismissal and the disabled gate')

document.dispatch('mousedown', { button: 0, target: {} })
await flush(0)
check('pressing elsewhere dismisses the bubble', byClass(React.__tree(), 'dsht-bubble') === null)

// A second boot against a disabled profile: the module must stay off entirely.
state.config = {
  enabled: false, showButton: true, shortcut: 'Alt+T', defaultTarget: 'auto',
  appId: '', hasSecret: false, configured: false, configPath: '/tmp/x.json',
}
runInContext(source, context, { filename: BUNDLE })
let ComponentOff = null
const ReactOff = makeReact(() => ComponentOff)
const offExports = captured.factory((name) => {
  if (name === 'react') return ReactOff
  throw new Error(`the client bundle must not require ${name}`)
})
offExports.apply({
  slots: {
    inject: (key, callback) => callback(),
    register: (props, component) => { if (props.name === 'shell.overlay') ComponentOff = component; return () => {} },
  },
})
ReactOff.__render()
await flush(40)
check('a disabled plugin renders nothing', ReactOff.__tree() === null)
selectText('still nothing')
keyDown('t', { altKey: true }, 'KeyT')
await flush(40)
const inert = requests.filter((entry) => entry.body && entry.body.text === 'still nothing').length
check('and its own hotkey handler stays inert', inert === 1, `${inert} request(s) — only the live instance may answer`)

console.log('\nthe textarea path and exported helpers')

document.activeElement = { tagName: 'TEXTAREA', selectionStart: 2, selectionEnd: 7, value: 'xxhelloyy' }
check('a textarea selection is read from its range', moduleExports.readSelection() === 'hello', String(moduleExports.readSelection()))
document.activeElement = { tagName: 'INPUT', selectionStart: 4, selectionEnd: 4, value: 'abcd' }
check('a collapsed input selection is nothing', moduleExports.readSelection() === null)
document.activeElement = null

check('Alt+T matches', moduleExports.matchShortcut('Alt+T', { key: 't', code: 'KeyT', altKey: true, ctrlKey: false, shiftKey: false, metaKey: false }) === true)
check('key case does not matter', moduleExports.matchShortcut('alt+t', { key: 'T', code: 'KeyT', altKey: true, ctrlKey: false, shiftKey: false, metaKey: false }) === true)
check('a missing modifier does not match', moduleExports.matchShortcut('Alt+T', { key: 't', code: 'KeyT', altKey: false, ctrlKey: false, shiftKey: false, metaKey: false }) === false)
check('an extra modifier does not match', moduleExports.matchShortcut('Alt+T', { key: 't', code: 'KeyT', altKey: true, ctrlKey: true, shiftKey: false, metaKey: false }) === false)
check('a bare key matches', moduleExports.matchShortcut('KeyT', { key: 't', code: 'KeyT', altKey: false, ctrlKey: false, shiftKey: false, metaKey: false }) === true)
check('an empty shortcut never matches', moduleExports.matchShortcut('', { key: 't', altKey: false, ctrlKey: false, shiftKey: false, metaKey: false }) === false)

check('key labels read like a keyboard', moduleExports.keyLabel('Alt+T') === 'Alt+T', moduleExports.keyLabel('Alt+T'))
check('primary is spelled Ctrl', moduleExports.keyLabel('Primary+Shift+K') === 'Ctrl+Shift+K', moduleExports.keyLabel('Primary+Shift+K'))
check('key codes are trimmed to letters', moduleExports.keyLabel('Alt+KeyT') === 'Alt+T', moduleExports.keyLabel('Alt+KeyT'))

const shifted = { getBoundingClientRect: () => ({ left: 40, top: 60, width: 1000, height: 700 }) }
const local = moduleExports.toLocal(shifted, 100, 100)
check('a transformed layer shifts child coordinates', local.x === 60 && local.y === 40, JSON.stringify(local))
check('and reports its own size', local.width === 1000 && local.height === 700)
check('without a transformed ancestor nothing moves', moduleExports.toLocal(null, 100, 100).x === 100)
check(
  'the card flips above a low selection',
  moduleExports.placeCard(null, { x: 100, y: 700 }, 240).top === `${700 - 240 - 16}px`,
  moduleExports.placeCard(null, { x: 100, y: 700 }, 240).top,
)
check(
  'the card stays inside a narrow viewport',
  moduleExports.placeCard(null, { x: 1200, y: 100 }, 240).left === `${1280 - 344 - 8}px`,
  moduleExports.placeCard(null, { x: 1200, y: 100 }, 240).left,
)

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  console.log(`failed: ${failures.join(' | ')}`)
  process.exitCode = 1
}
