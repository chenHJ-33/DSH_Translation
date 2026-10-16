/**
 * dsh-translate — browser half.
 *
 * Plain-JavaScript cordis plugin bundle for the DSH client module loader. It
 * owns one `shell.overlay` entry holding both surfaces:
 *
 *   - a small bubble next to a mouse-up selection,
 *   - a translation card (source, phonetic, dictionary senses, TTS, copy),
 *   - a hotkey path that translates the current selection immediately.
 *
 * Everything that touches the network, the secret key or the disk lives in
 * this package's host half; this file only calls /dsh-translate/*.
 */

window.__ModuleLoader__.load({
  id: 'dsh-translate',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')

    const API_CONFIG = 'dsh-translate/config'
    const API_TRANSLATE = 'dsh-translate/translate'
    const STYLE_ID = 'dsh-translate/styles'
    const MAX_SELECTION = 3000
    const CARD_WIDTH = 344

    const LANGUAGES = {
      auto: '自动检测',
      zh: '中文（简体）',
      cht: '中文（繁体）',
      en: '英语',
      jp: '日语',
      kor: '韩语',
      fra: '法语',
      de: '德语',
      spa: '西班牙语',
      ru: '俄语',
      it: '意大利语',
      pt: '葡萄牙语',
      ara: '阿拉伯语',
      th: '泰语',
      vie: '越南语',
    }

    const CSS = `
.dsht-root{position:fixed;inset:0;z-index:2147483000;pointer-events:none;
  --dsht-bg:#ffffff;--dsht-bg-soft:#f5f6f8;--dsht-fg:#1b1d21;--dsht-muted:#6b7280;
  --dsht-border:#e3e5ea;--dsht-accent:#c2410c;--dsht-accent-soft:#fdf0e6;--dsht-shadow:0 12px 32px rgba(15,23,42,.18);}
.dsht-root.dsht-dark{--dsht-bg:#23272f;--dsht-bg-soft:#2c313a;--dsht-fg:#e8eaed;--dsht-muted:#9aa2ae;
  --dsht-border:#3a4048;--dsht-accent:#f0a45c;--dsht-accent-soft:#33291f;--dsht-shadow:0 14px 36px rgba(0,0,0,.5);}
.dsht-root *{box-sizing:border-box;}
.dsht-bubble{position:fixed;pointer-events:auto;display:flex;align-items:center;gap:6px;
  padding:5px 10px;border-radius:9px;border:1px solid var(--dsht-border);background:var(--dsht-bg);
  color:var(--dsht-fg);font-size:12px;line-height:18px;font-family:inherit;cursor:pointer;
  box-shadow:var(--dsht-shadow);user-select:none;white-space:nowrap;}
.dsht-bubble:hover{border-color:var(--dsht-accent);color:var(--dsht-accent);}
.dsht-bubble svg{display:block;}
.dsht-panel{position:fixed;pointer-events:auto;width:344px;max-width:calc(100vw - 16px);
  border-radius:12px;border:1px solid var(--dsht-border);background:var(--dsht-bg);color:var(--dsht-fg);
  box-shadow:var(--dsht-shadow);font-size:13px;line-height:1.55;overflow:hidden;font-family:inherit;}
.dsht-head{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--dsht-border);
  cursor:move;user-select:none;-webkit-user-select:none;}
.dsht-head.dsht-dragging{cursor:grabbing;}
.dsht-head.dsht-dragging .dsht-icon,.dsht-head.dsht-dragging .dsht-text{cursor:grabbing;}
.dsht-grip{display:flex;align-items:center;flex:0 0 auto;color:var(--dsht-muted);cursor:move;}
.dsht-lang{font-size:12px;color:var(--dsht-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.dsht-spacer{flex:1 1 auto;}
.dsht-icon{pointer-events:auto;display:inline-flex;align-items:center;justify-content:center;
  width:24px;height:24px;border-radius:7px;border:1px solid transparent;background:transparent;
  color:var(--dsht-muted);cursor:pointer;padding:0;}
.dsht-icon:hover{background:var(--dsht-bg-soft);color:var(--dsht-fg);}
.dsht-icon[disabled]{opacity:.4;cursor:default;}
.dsht-body{padding:10px;max-height:52vh;overflow:auto;}
.dsht-src{font-size:15px;color:var(--dsht-accent);word-break:break-word;white-space:pre-wrap;}
.dsht-phonetic{margin-top:2px;font-size:12px;color:var(--dsht-muted);display:flex;gap:10px;flex-wrap:wrap;}
.dsht-divider{height:1px;background:var(--dsht-border);margin:9px 0;}
.dsht-dst{word-break:break-word;white-space:pre-wrap;}
.dsht-sense{margin-top:6px;font-size:12.5px;}
.dsht-sense b{color:var(--dsht-muted);font-weight:600;margin-right:6px;}
.dsht-foot{display:flex;align-items:center;gap:6px;padding:6px 10px;border-top:1px solid var(--dsht-border);
  background:var(--dsht-bg-soft);font-size:11.5px;color:var(--dsht-muted);}
.dsht-text{background:transparent;border:1px solid transparent;border-radius:6px;color:var(--dsht-muted);
  font-size:11.5px;padding:2px 6px;cursor:pointer;font-family:inherit;}
.dsht-text:hover{background:var(--dsht-bg);color:var(--dsht-fg);}
.dsht-status{padding:14px 12px;color:var(--dsht-muted);font-size:12.5px;text-align:center;}
.dsht-err{color:#dc2626;}
.dsht-root.dsht-dark .dsht-err{color:#f87171;}
.dsht-form{padding:12px;display:flex;flex-direction:column;gap:8px;}
.dsht-form label{font-size:12px;color:var(--dsht-muted);display:flex;flex-direction:column;gap:4px;}
.dsht-input{border:1px solid var(--dsht-border);border-radius:7px;background:var(--dsht-bg-soft);
  color:var(--dsht-fg);padding:6px 8px;font-size:12.5px;font-family:inherit;outline:none;}
.dsht-input:focus{border-color:var(--dsht-accent);}
.dsht-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:2px;}
.dsht-btn{border-radius:7px;border:1px solid var(--dsht-accent);background:var(--dsht-accent);
  color:#fff;font-size:12.5px;padding:5px 12px;cursor:pointer;font-family:inherit;}
.dsht-root.dsht-dark .dsht-btn{color:#1b1d21;}
.dsht-btn[disabled]{opacity:.55;cursor:default;}
.dsht-btn.dsht-ghost{background:transparent;color:var(--dsht-fg);border-color:var(--dsht-border);}
.dsht-hint{font-size:11px;color:var(--dsht-muted);}
.dsht-spin{display:inline-block;width:12px;height:12px;border:2px solid var(--dsht-border);
  border-top-color:var(--dsht-accent);border-radius:50%;animation:dsht-spin .7s linear infinite;vertical-align:-2px;}
@keyframes dsht-spin{to{transform:rotate(360deg)}}

/* The settings pane lives outside .dsht-root, so it is themed with the app's
   own tokens instead of the card's light/dark variables. */
.dsht-sec{display:flex;flex-direction:column;width:100%}
.dsht-sec-head{padding:14px 0 2px}
.dsht-sec-h{color:var(--dsw-alias-label-primary);margin:0;font-size:15px;font-weight:600;line-height:22px}
.dsht-sec-lead{color:var(--dsw-alias-label-secondary);margin-top:4px;font-size:12px;line-height:18px}
.dsht-sec-row{border-bottom:.5px solid var(--dsw-alias-border-l2);justify-content:space-between;align-items:flex-start;
  gap:24px;padding:16px 0;display:flex}
.dsht-sec-row:last-child{border-bottom:none}
.dsht-sec-main{flex:1;min-width:0}
.dsht-sec-title{color:var(--dsw-alias-label-primary);font-size:14px;line-height:20px}
.dsht-sec-desc{color:var(--dsw-alias-label-secondary);margin-top:4px;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dsht-sec-side{flex:0 0 auto;flex-direction:column;align-items:flex-end;gap:8px;min-width:248px;max-width:320px;display:flex}
.dsht-sec-input{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;
  background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:7px 10px;
  font-family:inherit;font-size:13px;line-height:18px;outline:none}
.dsht-sec-input:focus{border-color:var(--dsw-alias-brand-primary)}
.dsht-sec-input[readonly]{cursor:pointer}
.dsht-sec-input::placeholder{color:var(--dsw-alias-label-secondary)}
.dsht-sec-key{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.6px}
.dsht-sec-actions{flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:8px;display:flex}
.dsht-sec-btn{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;
  color:var(--dsw-alias-label-primary);cursor:pointer;padding:6px 14px;font-family:inherit;font-size:13px;line-height:18px}
.dsht-sec-btn:hover:enabled{border-color:var(--dsw-alias-brand-primary)}
.dsht-sec-btn:disabled{opacity:.5;cursor:default}
.dsht-sec-btn.dsht-sec-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);
  color:var(--dsw-alias-bg-base)}
.dsht-sec-note{font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dsht-sec-ok{color:var(--dsw-alias-state-success-primary)}
.dsht-sec-bad{color:var(--dsw-alias-state-error-primary)}
.dsht-sec-check{color:var(--dsw-alias-label-primary);cursor:pointer;align-items:center;gap:8px;font-size:13px;line-height:18px;display:flex}
.dsht-sec-check input{accent-color:var(--dsw-alias-brand-primary);width:15px;height:15px;margin:0}
.dsht-sec-select{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;
  background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:7px 10px;
  font-family:inherit;font-size:13px;line-height:18px;outline:none}
.dsht-sec-pad{padding-top:12px}
`

    // ---------------------------------------------------------------- utilities

    function ensureStyles() {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      document.head.appendChild(style)
    }

    /** Resolve one of our routes against the page's own base, like the shell does. */
    function apiUrl(path) {
      if (typeof document === 'undefined') return `/${path}`
      return new URL(path.replace(/^\/+/, ''), document.baseURI).pathname
    }

    async function apiGet(path) {
      const response = await fetch(apiUrl(path), { headers: { accept: 'application/json' }, cache: 'no-store' })
      return response.json()
    }

    async function apiPost(path, body) {
      const response = await fetch(apiUrl(path), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      return response.json()
    }

    function clamp(value, low, high) {
      return Math.min(Math.max(value, low), high)
    }

    function isDark() {
      if (typeof document === 'undefined') return false
      const probe = (element) => {
        if (!element) return null
        const raw = getComputedStyle(element).backgroundColor || ''
        const nums = raw.match(/[\d.]+/g)
        if (!nums || nums.length < 3) return null
        const alpha = nums.length > 3 ? Number(nums[3]) : 1
        if (alpha === 0) return null
        const [r, g, b] = nums.map(Number)
        return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128
      }
      const byDom = probe(document.body) ?? probe(document.documentElement)
      if (byDom !== null) return byDom
      return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    }

    /**
     * The text the user just selected, from wherever the focus is.
     *
     * A focused input or textarea (including Monaco's mirrored `inputarea`,
     * which is how the editor publishes its selection for Ctrl+C) reports the
     * range through `selectionStart/End`; every other surface uses the DOM
     * selection. Collapsed selections are no selection at all.
     * @returns the selected text, or null.
     */
    function readSelection() {
      const el = typeof document === 'undefined' ? null : document.activeElement
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
        const start = el.selectionStart
        const end = el.selectionEnd
        if (typeof start === 'number' && typeof end === 'number' && end > start && end - start <= MAX_SELECTION) {
          const slice = String(el.value ?? '').slice(start, end)
          if (slice.trim()) return slice
        }
        return null
      }
      const selection = typeof window === 'undefined' || !window.getSelection ? null : window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
      const text = selection.toString()
      if (!text || !text.trim() || text.length > MAX_SELECTION) return null
      return text
    }

    /** Short human label for a hotkey, so the card can advertise it. */
    function keyLabel(spec) {
      return String(spec || '').split('+').map((raw) => raw.trim()).filter(Boolean)
        .map((part) => {
          const lower = part.toLowerCase()
          if (lower === 'alt' || lower === 'option') return 'Alt'
          if (lower === 'ctrl' || lower === 'control') return 'Ctrl'
          if (lower === 'shift') return 'Shift'
          if (lower === 'meta' || lower === 'cmd' || lower === 'command' || lower === 'super') return 'Cmd'
          if (lower === 'primary' || lower === 'mod') return 'Ctrl'
          if (/^key[a-z]$/.test(lower)) return part.slice(3).toUpperCase()
          return part.length === 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)
        })
        .join('+')
    }

    /**
     * Does this keyboard event carry exactly the modifiers `spec` names?
     * @param spec - e.g. `Alt+T`, `Ctrl+Shift+T`, or `KeyT`.
     * @param event - the KeyboardEvent.
     */
    function matchShortcut(spec, event) {
      const parts = String(spec || '').split('+').map((raw) => raw.trim()).filter(Boolean)
      if (parts.length === 0) return false
      let alt = false
      let ctrl = false
      let shift = false
      let meta = false
      let key = null
      for (const raw of parts) {
        const part = raw.toLowerCase()
        if (part === 'alt' || part === 'option') alt = true
        else if (part === 'ctrl' || part === 'control') ctrl = true
        else if (part === 'shift') shift = true
        else if (part === 'meta' || part === 'cmd' || part === 'command' || part === 'super') meta = true
        else if (part === 'primary' || part === 'mod') ctrl = true
        else key = part
      }
      if (key === null) return false
      const eventKey = String(event.key || '').toLowerCase()
      const eventCode = String(event.code || '').toLowerCase()
      const keyOk = eventKey === key || eventCode === key || eventCode === `key${key}`
      if (!keyOk) return false
      return alt === !!event.altKey && ctrl === !!event.ctrlKey && shift === !!event.shiftKey && meta === !!event.metaKey
    }

    /**
     * Viewport coordinates to coordinates inside our own fixed layer.
     *
     * A `position: fixed` element is laid out against its own containing block,
     * which is the viewport only while no ancestor carries a transform. Our
     * root spans that block (`inset: 0`), so subtracting its own rect turns a
     * mouse position into the coordinates its children must use — and it is a
     * no-op in the ordinary case where that rect starts at the viewport origin.
     */
    function toLocal(root, x, y) {
      const rect = root && typeof root.getBoundingClientRect === 'function' ? root.getBoundingClientRect() : null
      return {
        x: x - (rect ? rect.left : 0),
        y: y - (rect ? rect.top : 0),
        width: rect && rect.width ? rect.width : window.innerWidth,
        height: rect && rect.height ? rect.height : window.innerHeight,
      }
    }

    /** Where a box of `width`×`height` goes, anchored at a viewport point. */
    function placeBeside(root, point, width, height, offsetX, offsetY) {
      const local = toLocal(root, point.x, point.y)
      return {
        left: `${clamp(local.x + offsetX, 8, Math.max(8, local.width - width - 8))}px`,
        top: `${clamp(local.y + offsetY, 8, Math.max(8, local.height - height - 8))}px`,
      }
    }

    /** Where the card goes: under the selection, flipped above when it must be. */
    function placeCard(root, point, height) {
      const local = toLocal(root, point.x, point.y)
      const below = local.y + 16
      const above = local.y - height - 16
      const top = below + height > local.height - 8 && above > 8 ? above : below
      return {
        left: `${clamp(local.x, 8, Math.max(8, local.width - CARD_WIDTH - 8))}px`,
        top: `${clamp(top, 8, Math.max(8, local.height - 60))}px`,
      }
    }

    function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text)
      return new Promise((resolve, reject) => {
        try {
          const area = document.createElement('textarea')
          area.value = text
          area.setAttribute('readonly', 'readonly')
          area.style.position = 'fixed'
          area.style.opacity = '0'
          document.body.appendChild(area)
          area.select()
          document.execCommand('copy')
          document.body.removeChild(area)
          resolve()
        } catch (error) {
          reject(error)
        }
      })
    }

    function speak(url) {
      if (!url) return
      try {
        const audio = new Audio(url)
        audio.play().catch(() => {})
      } catch {
        /* autoplay or codec refusal: nothing useful to say */
      }
    }

    // ------------------------------------------------------------------- icons

    const icon = (paths, size = 15) => React.createElement(
      'svg',
      { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' },
      ...paths.map((d, index) => React.createElement('path', { key: index, d })),
    )

    const IconTranslate = (size) => icon(['M4 5h10', 'M9 3v2c0 5-2.4 8.4-5 10', 'M6 11c1.6 2.6 3.4 4.6 5.5 6', 'M13 21l4.2-9.6L21.5 21', 'M14.6 17.6h6'], size)
    const IconClose = (size) => icon(['M6 6l12 12', 'M18 6L6 18'], size)
    const IconSwap = (size) => icon(['M7 4L4 7l3 3', 'M4 7h13a3 3 0 0 1 0 6h-1', 'M17 20l3-3-3-3', 'M20 17H7a3 3 0 0 1 0-6h1'], size)
    const IconVolume = (size) => icon(['M11 5L6.5 9H3v6h3.5L11 19V5z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M18 6a8.5 8.5 0 0 1 0 12'], size)
    const IconCopy = (size) => icon(['M9 9V5.5A1.5 1.5 0 0 1 10.5 4h8A1.5 1.5 0 0 1 20 5.5v8a1.5 1.5 0 0 1-1.5 1.5H15', 'M5.5 9h8A1.5 1.5 0 0 1 15 10.5v8a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 4 18.5v-8A1.5 1.5 0 0 1 5.5 9z'], size)
    const IconGrip = (size) => icon(['M9 6h.01', 'M15 6h.01', 'M9 12h.01', 'M15 12h.01', 'M9 18h.01', 'M15 18h.01'], size)
    const IconSettings = (size) => icon(['M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z', 'M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.87 1.2V21a2 2 0 1 1-4 0v-.11A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 2.6 15H2.5a2 2 0 1 1 0-4h.11A1.7 1.7 0 0 0 4.6 7a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 2.6h.09A2 2 0 0 1 13 2.5v.11A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 21.4 9v.09a2 2 0 0 1 0 3.91z'], size)

    // ---------------------------------------------------------------- component

    const DEFAULT_SHORTCUT = 'Alt+T'

    const INITIAL_SETTINGS = {
      loaded: false,
      enabled: true,
      showButton: true,
      shortcut: DEFAULT_SHORTCUT,
      defaultTarget: 'auto',
      appId: '',
      hasSecret: false,
      configured: false,
      configPath: '',
    }

    /**
     * The one live settings channel.
     *
     * The overlay entry and the settings-pane entry are separate trees (and,
     * in the shell, separate Slot roots), so neither can see the other's
     * state. Both read this channel and both write it after a successful host
     * round-trip, which is what makes "change the hotkey in Settings" take
     * effect without a page reload.
     */
    const settingsStore = {
      value: INITIAL_SETTINGS,
      listeners: new Set(),
      /** Merge a patch into the live settings and wake every subscriber. */
      publish(patch) {
        settingsStore.value = { ...settingsStore.value, ...patch }
        for (const listener of [...settingsStore.listeners]) listener(settingsStore.value)
      },
      /** @returns an unsubscribe function. */
      subscribe(listener) {
        settingsStore.listeners.add(listener)
        return () => { settingsStore.listeners.delete(listener) }
      },
    }

    const MODIFIER_KEYS = ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock', 'OS', 'ContextMenu']

    /** Is this keydown nothing but a modifier being held down? */
    function isModifierKey(key, code) {
      return MODIFIER_KEYS.includes(key) || /^(Control|Alt|Shift|Meta|AltGraph)(Left|Right)$/.test(code)
    }

    /** The modifiers a keyboard event is currently holding, for the live preview. */
    function modifierLabel(event) {
      const parts = []
      if (event.ctrlKey) parts.push('Ctrl')
      if (event.altKey) parts.push('Alt')
      if (event.shiftKey) parts.push('Shift')
      if (event.metaKey) parts.push('Meta')
      return parts.length > 0 ? `${parts.join('+')}+…` : ''
    }

    /**
     * Read a keyboard event as a shortcut spec.
     *
     * Letters and digits come from `event.code`, so a combination keeps working
     * on layouts where the physical key and the produced character differ.
     * @returns `{ spec }` for a complete combination, `{ reset: true }` for
     * Backspace/Delete, `{ cancel: true }` for Escape, `{ invalid: true }` when
     * no modifier was held, or null while only modifiers are pressed.
     */
    function shortcutFromEvent(event) {
      const key = String(event.key ?? '')
      const code = String(event.code ?? '')
      if (key === 'Escape') return { cancel: true }
      if (key === 'Backspace' || key === 'Delete') return { reset: true }
      if (isModifierKey(key, code)) return null
      const parts = []
      if (event.ctrlKey) parts.push('Ctrl')
      if (event.altKey) parts.push('Alt')
      if (event.shiftKey) parts.push('Shift')
      if (event.metaKey) parts.push('Meta')
      let name = null
      if (/^Key[A-Z]$/.test(code)) name = code.slice(3)
      else if (/^Digit[0-9]$/.test(code)) name = code.slice(5)
      else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) name = code
      else if (key === ' ') name = 'Space'
      else if (key.length === 1) name = key.toUpperCase()
      else if (key !== '') name = key
      if (name === null) return { invalid: true }
      if (parts.length === 0) return { invalid: true }
      return { spec: [...parts, name].join('+') }
    }

    function Translator() {
      const [settings, setSettings] = React.useState(settingsStore.value)
      const [bubble, setBubble] = React.useState(null)
      const [panel, setPanel] = React.useState(null)
      const [setup, setSetup] = React.useState(null)
      const [dark, setDark] = React.useState(isDark)

      const rootRef = React.useRef(null)
      const cardRef = React.useRef(null)
      const bubbleRef = React.useRef(null)
      const drag = React.useRef(null)
      const settingsRef = React.useRef(settings)
      const pointer = React.useRef({ x: 0, y: 0 })
      const timer = React.useRef(0)

      settingsRef.current = settings

      // Both entries share one live settings channel, so a save made in the
      // settings pane retargets the hotkey here without a reload.
      React.useEffect(() => settingsStore.subscribe(setSettings), [])

      const closePanel = React.useCallback(() => {
        setPanel(null)
        setSetup(null)
      }, [])

      const run = React.useCallback(async (rawText, anchor, override) => {
        const text = String(rawText ?? '').trim()
        if (!text) return
        setBubble(null)
        setSetup(null)
        // Re-running the same text (语言切换 / 保存后重试) keeps the place the
        // user dragged the card to; a brand-new selection puts it back under
        // the selection.
        setPanel((current) => ({
          text,
          x: anchor.x,
          y: anchor.y,
          phase: 'loading',
          result: null,
          error: null,
          pos: current && current.text === text ? current.pos : null,
          dragging: false,
        }))
        try {
          const payload = await apiPost(API_TRANSLATE, {
            text,
            from: override?.from ?? 'auto',
            to: override?.to ?? 'auto',
          })
          if (payload && payload.ok) {
            setPanel((current) => (current ? { ...current, phase: 'done', result: payload.result } : current))
            return
          }
          if (payload && payload.code === 'NOT_CONFIGURED') {
            setPanel((current) => (current ? { ...current, phase: 'unconfigured', error: payload.error } : current))
            setSetup({
              appId: settingsRef.current.appId || '',
              secretKey: '',
              saving: false,
              error: payload.error ?? null,
            })
            return
          }
          setPanel((current) => (current ? { ...current, phase: 'error', error: payload?.error ?? '翻译失败' } : current))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          setPanel((current) => (current ? { ...current, phase: 'error', error: message } : current))
        }
      }, [])

      /**
       * Grab the card by its header. The position lives in the layer's own
       * coordinates (`toLocal`), because `.dsht-root` is a fixed layer whose
       * origin an ancestor transform may shift; the move itself is applied by
       * the window-level pointer handler below.
       */
      const startDrag = React.useCallback((event) => {
        if (event.button !== 0) return
        const target = event.target
        // The header's own buttons keep working: only the bare header drags.
        if (target && typeof target.closest === 'function' && target.closest('.dsht-icon')) return
        const card = cardRef.current
        if (!card || typeof card.getBoundingClientRect !== 'function') return
        const rect = card.getBoundingClientRect()
        const local = toLocal(rootRef.current, rect.left, rect.top)
        drag.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top }
        setPanel((current) => (current
          ? {
            ...current,
            dragging: true,
            pos: {
              x: clamp(local.x, 8, Math.max(8, local.width - CARD_WIDTH - 8)),
              y: clamp(local.y, 8, Math.max(8, local.height - 48)),
            },
          }
          : current))
        event.preventDefault()
      }, [])

      // Settings are read once at mount; the card's own form rewrites them.
      React.useEffect(() => {
        let alive = true
        apiGet(API_CONFIG)
          .then((payload) => {
            if (!alive || !payload || !payload.ok) return
            settingsStore.publish({ ...INITIAL_SETTINGS, ...payload.config, loaded: true })
          })
          .catch(() => {
            if (alive) settingsStore.publish({ loaded: true })
          })
        return () => { alive = false }
      }, [])

      // The card follows the app's appearance, which is not the OS preference.
      React.useEffect(() => {
        if (typeof MutationObserver !== 'function') return undefined
        const observer = new MutationObserver(() => setDark(isDark()))
        observer.observe(document.documentElement, { attributes: true })
        if (document.body) observer.observe(document.body, { attributes: true })
        return () => observer.disconnect()
      }, [])

      React.useEffect(() => {
        const inside = (node, target) => (
          node !== null && node !== undefined && typeof node.contains === 'function'
            ? node.contains(target)
            : false
        )

        const insideOwnUi = (target) => inside(rootRef.current, target)

        const onPointerMove = (event) => {
          pointer.current = { x: event.clientX, y: event.clientY }
          const session = drag.current
          if (!session) return
          // Dragging in the layer's coordinates: subtract where inside the card
          // the user grabbed it, then keep the card inside the viewport.
          const local = toLocal(rootRef.current, event.clientX - session.dx, event.clientY - session.dy)
          setPanel((current) => (current
            ? {
              ...current,
              pos: {
                x: clamp(local.x, 8, Math.max(8, local.width - CARD_WIDTH - 8)),
                y: clamp(local.y, 8, Math.max(8, local.height - 48)),
              },
            }
            : current))
        }

        const onMouseUp = (event) => {
          if (drag.current) {
            // A drag is not a text selection: finish it and stay out of the way.
            drag.current = null
            setPanel((current) => (current ? { ...current, dragging: false } : current))
            return
          }
          if (event.button !== 0) return
          if (insideOwnUi(event.target)) return
          const anchor = { x: event.clientX, y: event.clientY }
          if (timer.current) window.clearTimeout(timer.current)
          // The selection settles one task after mouseup, so read it late.
          timer.current = window.setTimeout(() => {
            const current = settingsRef.current
            if (!current.loaded || !current.enabled || !current.showButton) return
            const text = readSelection()
            if (!text || !text.trim()) {
              setBubble(null)
              return
            }
            setBubble({ text, x: anchor.x, y: anchor.y })
          }, 12)
        }

        const onMouseDown = (event) => {
          // A click on the card (its buttons, inputs, text, drag handle) never
          // dismisses it, and neither does one on the bubble — that click is
          // about to open a fresh translation.
          if (inside(cardRef.current, event.target)) return
          if (inside(bubbleRef.current, event.target)) return
          // Anywhere else — the app, another panel, the settings pane — closes
          // both the bubble and the card.
          setBubble(null)
          closePanel()
        }

        const onKeyDown = (event) => {
          const current = settingsRef.current
          if (!current.loaded || !current.enabled) return
          // Never answer our own settings pane: while the shortcut field is
          // capturing a combination, or while the credentials are being typed,
          // the overlay must stay out of the way.
          const target = event.target
          if (target && typeof target.closest === 'function' && target.closest('[data-dsht-settings]')) return
          if (event.key === 'Escape') {
            setBubble(null)
            closePanel()
            return
          }
          if (event.repeat || !matchShortcut(current.shortcut, event)) return
          const text = readSelection()
          if (!text) return
          event.preventDefault()
          event.stopPropagation()
          const active = document.activeElement
          const rect = active && typeof active.getBoundingClientRect === 'function' ? active.getBoundingClientRect() : null
          const fallback = rect && (rect.width > 40 || rect.height > 20)
            ? { x: rect.left + Math.min(rect.width, 320) / 2, y: rect.top + Math.min(rect.height, 40) }
            : { x: window.innerWidth / 2, y: 120 }
          const at = pointer.current.x !== 0 || pointer.current.y !== 0 ? pointer.current : fallback
          void run(text, at)
        }

        const hideBubble = () => setBubble(null)

        window.addEventListener('mousemove', onPointerMove, true)
        document.addEventListener('mouseup', onMouseUp, true)
        document.addEventListener('mousedown', onMouseDown, true)
        window.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('scroll', hideBubble, true)
        window.addEventListener('resize', hideBubble, true)
        return () => {
          if (timer.current) window.clearTimeout(timer.current)
          window.removeEventListener('mousemove', onPointerMove, true)
          document.removeEventListener('mouseup', onMouseUp, true)
          document.removeEventListener('mousedown', onMouseDown, true)
          window.removeEventListener('keydown', onKeyDown, true)
          window.removeEventListener('scroll', hideBubble, true)
          window.removeEventListener('resize', hideBubble, true)
        }
      }, [closePanel, run])

      if (!settings.enabled) return null

      const children = []

      if (bubble) {
        children.push(React.createElement(
          'button',
          {
            key: 'bubble',
            type: 'button',
            className: 'dsht-bubble',
            ref: bubbleRef,
            style: placeBeside(rootRef.current, bubble, 84, 30, 10, 12),
            title: `翻译选中内容（${keyLabel(settings.shortcut)}）`,
            onMouseDown: (event) => event.preventDefault(),
            onClick: () => { void run(bubble.text, { x: bubble.x, y: bubble.y }) },
          },
          IconTranslate(14),
          React.createElement('span', null, '翻译'),
        ))
      }

      if (panel) {
        children.push(renderPanel(panel, {
          // A dragged card keeps the position the user put it in; otherwise it
          // is re-placed under the current selection on every render.
          style: panel.pos
            ? { left: `${panel.pos.x}px`, top: `${panel.pos.y}px` }
            : placeCard(rootRef.current, panel, 240),
          settings,
          setup,
          setSetup,
          setSettings,
          run,
          closePanel,
          cardRef,
          onDragStart: startDrag,
        }))
      }

      return React.createElement('div', { className: `dsht-root${dark ? ' dsht-dark' : ''}`, ref: rootRef }, ...children)
    }

    /** One card: header icons, body (loading / error / result / setup), footer. */
    function renderPanel(panel, api) {
      const { style, settings, setup, setSetup, setSettings, run, closePanel, cardRef, onDragStart } = api
      const result = panel.result
      const fromLabel = LANGUAGES[result?.from] ?? (result?.from || '翻译')
      const toLabel = LANGUAGES[result?.to] ?? (result?.to || '')

      const head = React.createElement(
        'div',
        {
          className: `dsht-head${panel.dragging ? ' dsht-dragging' : ''}`,
          title: '按住这里可以拖动卡片',
          onMouseDown: onDragStart,
        },
        React.createElement('span', { className: 'dsht-grip' }, IconGrip(14)),
        React.createElement('span', { className: 'dsht-lang' }, fromLabel),
        result && result.tts && result.tts.src
          ? React.createElement('button', { type: 'button', className: 'dsht-icon', title: '朗读原文', onClick: () => speak(result.tts.src) }, IconVolume(15))
          : null,
        React.createElement('span', { className: 'dsht-spacer' }),
        panel.phase === 'done' && result
          ? React.createElement('button', {
            type: 'button',
            className: 'dsht-icon',
            title: '切换目标语言，重新翻译',
            onClick: () => {
              const next = result.to === 'zh' || result.to === 'cht' ? 'en' : 'zh'
              void run(panel.text, { x: panel.x, y: panel.y }, { to: next })
            },
          }, IconSwap(15))
          : null,
        React.createElement('button', {
          type: 'button',
          className: 'dsht-icon',
          title: '设置',
          onClick: () => setSetup((current) => (current ? null : { appId: settings.appId || '', secretKey: '', saving: false, error: null })),
        }, IconSettings(15)),
        React.createElement('button', { type: 'button', className: 'dsht-icon', title: '关闭（Esc）', onClick: closePanel }, IconClose(15)),
      )

      if (setup) {
        const save = async () => {
          setSetup({ ...setup, saving: true, error: null })
          try {
            const payload = await apiPost(API_CONFIG, { appId: setup.appId.trim(), secretKey: setup.secretKey.trim() })
            if (!payload || !payload.ok) throw new Error(payload?.error ?? '保存失败')
            settingsStore.publish({ ...payload.config, loaded: true })
            setSetup(null)
            void run(panel.text, { x: panel.x, y: panel.y })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            setSetup({ ...setup, saving: false, error: message })
          }
        }
        const needsSecret = settings.hasSecret !== true
        return React.createElement(
          'div',
          { className: 'dsht-panel', style, key: 'panel', ref: cardRef },
          head,
          React.createElement(
            'div',
            { className: 'dsht-form' },
            React.createElement('div', { className: 'dsht-hint' }, '填写百度翻译开放平台「通用文本翻译」应用的 APP ID 与密钥：'),
            React.createElement('label', null, 'APP ID',
              React.createElement('input', {
                className: 'dsht-input',
                value: setup.appId,
                spellCheck: false,
                autoComplete: 'off',
                onChange: (event) => setSetup({ ...setup, appId: event.target.value }),
              })),
            React.createElement('label', null,
              setup.error !== null && setup.error !== undefined
                ? React.createElement('span', { className: 'dsht-err' }, setup.error)
                : (settings.hasSecret ? '密钥（留空则保持不变）' : '密钥'),
              React.createElement('input', {
                className: 'dsht-input',
                type: 'password',
                value: setup.secretKey,
                spellCheck: false,
                autoComplete: 'off',
                placeholder: settings.hasSecret ? '已保存，留空不修改' : '',
                onChange: (event) => setSetup({ ...setup, secretKey: event.target.value }),
              })),
            React.createElement('div', { className: 'dsht-actions' },
              React.createElement('button', { type: 'button', className: 'dsht-btn dsht-ghost', onClick: () => setSetup(null) }, '取消'),
              React.createElement('button', {
                type: 'button',
                className: 'dsht-btn',
                disabled: setup.saving || setup.appId.trim() === '' || (needsSecret && setup.secretKey.trim() === ''),
                onClick: () => { void save() },
              }, setup.saving ? '保存中…' : '保存并翻译')),
            React.createElement('div', { className: 'dsht-hint' }, `保存位置：${settings.configPath || '$DSH_HOME/dsh-translate.json'}`),
          ),
        )
      }

      const body = [React.createElement('div', { className: 'dsht-src', key: 'src' }, panel.text)]
      if (result && result.phonetic && (result.phonetic.en || result.phonetic.us)) {
        body.push(React.createElement(
          'div',
          { className: 'dsht-phonetic', key: 'ph' },
          result.phonetic.en ? React.createElement('span', null, `英 /${result.phonetic.en}/`) : null,
          result.phonetic.us ? React.createElement('span', null, `美 /${result.phonetic.us}/`) : null,
        ))
      }
      if (panel.phase === 'loading') {
        body.push(React.createElement('div', { className: 'dsht-status', key: 'loading' }, React.createElement('span', { className: 'dsht-spin' }), ' 正在翻译…'))
      } else if (panel.phase === 'error' || panel.phase === 'unconfigured') {
        body.push(React.createElement('div', { className: 'dsht-status dsht-err', key: 'error' }, panel.error))
      } else if (result) {
        body.push(React.createElement('div', { className: 'dsht-divider', key: 'divider' }))
        body.push(React.createElement(
          'div',
          { className: 'dsht-dst', key: 'dst' },
          toLabel
            ? React.createElement(
              'div',
              { className: 'dsht-hint', style: { marginBottom: '3px', display: 'flex', alignItems: 'center', gap: '6px' } },
              toLabel,
              result.tts && result.tts.dst
                ? React.createElement('button', { type: 'button', className: 'dsht-icon', style: { width: '20px', height: '20px' }, title: '朗读译文', onClick: () => speak(result.tts.dst) }, IconVolume(13))
                : null,
            )
            : null,
          result.lines && result.lines.length > 0 ? result.lines.join('\n') : '（无译文）',
        ))
        for (const [index, sense] of (result.parts ?? []).entries()) {
          body.push(React.createElement(
            'div',
            { className: 'dsht-sense', key: `sense-${index}` },
            React.createElement('b', null, sense.part),
            sense.means.join('；'),
          ))
        }
      }

      const translated = panel.phase === 'done' && result && result.lines && result.lines.length > 0
      const footer = React.createElement(
        'div',
        { className: 'dsht-foot' },
        React.createElement('span', null, '百度翻译'),
        React.createElement('span', { className: 'dsht-spacer' }),
        React.createElement('button', {
          type: 'button',
          className: 'dsht-text',
          title: '复制译文',
          onClick: () => { void copyText(translated ? result.lines.join('\n') : panel.text) },
        }, '复制'),
        React.createElement('button', {
          type: 'button',
          className: 'dsht-text',
          title: '在百度翻译中打开',
          onClick: () => {
            const from = result?.from ?? 'auto'
            const to = result?.to ?? 'zh'
            window.open(`https://fanyi.baidu.com/#${from}/${to}/${encodeURIComponent(panel.text)}`, '_blank', 'noopener')
          },
        }, '百度翻译'),
        React.createElement('span', { style: { opacity: 0.7 } }, keyLabel(settings.shortcut)),
      )

      return React.createElement(
        'div',
        { className: 'dsht-panel', style, key: 'panel', ref: cardRef },
        head,
        React.createElement('div', { className: 'dsht-body' }, ...body),
        footer,
      )
    }

    /** Target languages offered by the settings pane; `auto` decides per text. */
    const TARGET_LANGUAGES = ['auto', 'zh', 'cht', 'en', 'jp', 'kor', 'fra', 'de', 'spa', 'ru', 'it', 'pt', 'ara', 'th', 'vie']

    /**
     * The `settings.section` entry — 引擎凭据 / 快捷键 / 行为开关.
     *
     * Every write goes through the host (which owns the secret and the file on
     * disk); every successful write is published to the shared settings channel
     * so the overlay picks it up immediately.
     */
    function SettingsSection() {
      const [settings, setSettings] = React.useState(settingsStore.value)
      const [form, setForm] = React.useState(null)
      const [busy, setBusy] = React.useState(null)
      const [note, setNote] = React.useState(null)
      const [capturing, setCapturing] = React.useState(false)
      const [pending, setPending] = React.useState('')

      React.useEffect(() => settingsStore.subscribe(setSettings), [])

      // The pane can be the first entry the user opens, so it reads the config
      // itself instead of waiting for the overlay to have mounted.
      React.useEffect(() => {
        let alive = true
        apiGet(API_CONFIG)
          .then((payload) => {
            if (alive && payload && payload.ok) settingsStore.publish({ ...payload.config, loaded: true })
          })
          .catch(() => {
            if (alive) setNote({ kind: 'bad', text: '无法读取当前设置，宿主可能尚未就绪。' })
          })
        return () => { alive = false }
      }, [])

      // Seed the credential fields once, and follow edits made elsewhere (the
      // card's own settings form) unless this pane is the one being typed in.
      React.useEffect(() => {
        if (!settings.loaded) return
        setForm((current) => {
          if (current === null) return { appId: settings.appId || '', secretKey: '', touched: false }
          if (current.touched || current.appId === (settings.appId || '')) return current
          return { ...current, appId: settings.appId || '' }
        })
      }, [settings.loaded, settings.appId])

      const save = React.useCallback(async (patch, busyKey, okText) => {
        setBusy(busyKey)
        setNote(null)
        try {
          const payload = await apiPost(API_CONFIG, patch)
          if (!payload || !payload.ok) throw new Error(payload?.error ?? '保存失败')
          settingsStore.publish({ ...payload.config, loaded: true })
          setNote({ kind: 'ok', text: okText ?? '已保存' })
          return payload.config
        } catch (error) {
          setNote({ kind: 'bad', text: error instanceof Error ? error.message : String(error) })
          return null
        } finally {
          setBusy(null)
        }
      }, [])

      const patchForm = (patch) => setForm((current) => ({ appId: '', secretKey: '', touched: false, ...(current ?? {}), ...patch }))

      const submitCredentials = async (withTest) => {
        const appId = (form?.appId ?? '').trim()
        const secretKey = (form?.secretKey ?? '').trim()
        const config = await save({ appId, secretKey }, withTest ? 'test' : 'save',
          withTest ? '凭据已保存，正在测试…' : (secretKey === '' ? '已保存' : '已保存，密钥已更新'))
        if (config === null) return
        setForm({ appId: config.appId ?? '', secretKey: '', touched: false })
        if (!withTest) return
        setBusy('test')
        try {
          const payload = await apiPost(API_TRANSLATE, { text: 'Hello, world!', from: 'en', to: 'zh' })
          if (payload && payload.ok) {
            const line = (payload.result?.lines ?? []).join(' ')
            setNote({ kind: 'ok', text: `连接正常 · Hello, world! → ${line || '（无译文返回）'}` })
          } else {
            setNote({ kind: 'bad', text: payload?.error ?? '翻译失败' })
          }
        } catch (error) {
          setNote({ kind: 'bad', text: error instanceof Error ? error.message : String(error) })
        } finally {
          setBusy(null)
        }
      }

      const onShortcutKeyDown = (event) => {
        event.preventDefault()
        event.stopPropagation()
        const result = shortcutFromEvent(event)
        if (result === null) {
          setPending(modifierLabel(event))
          return
        }
        if (result.cancel) {
          setPending('')
          setCapturing(false)
          return
        }
        if (result.reset) {
          setPending('')
          setCapturing(false)
          void save({ shortcut: DEFAULT_SHORTCUT }, 'shortcut', `已恢复默认快捷键 ${keyLabel(DEFAULT_SHORTCUT)}`)
          return
        }
        if (result.invalid) {
          setNote({ kind: 'bad', text: '请至少包含一个修饰键（Ctrl / Alt / Shift / Cmd）和一个按键。' })
          return
        }
        setPending('')
        setCapturing(false)
        void save({ shortcut: result.spec }, 'shortcut', `快捷键已设为 ${keyLabel(result.spec)}`)
      }

      const loaded = settings.loaded
      const idle = busy === null
      const appId = form === null ? (settings.appId || '') : form.appId
      const secretKey = form === null ? '' : form.secretKey
      const canSave = loaded && idle && appId.trim() !== '' && (settings.hasSecret === true || secretKey.trim() !== '')

      const row = (key, title, description, side) => React.createElement(
        'div',
        { className: 'dsht-sec-row', key },
        React.createElement('div', { className: 'dsht-sec-main' },
          React.createElement('div', { className: 'dsht-sec-title' }, title),
          React.createElement('div', { className: 'dsht-sec-desc' }, description),
        ),
        React.createElement('div', { className: 'dsht-sec-side' }, ...side),
      )

      const switchRow = (key, title, description) => row(key, title, description, [
        React.createElement('label', { className: 'dsht-sec-check', key: 'switch' },
          React.createElement('input', {
            type: 'checkbox',
            checked: settings[key] !== false,
            disabled: !loaded || !idle,
            onChange: (event) => { void save({ [key]: event.target.checked }, key, event.target.checked ? '已开启' : '已关闭') },
          }),
          settings[key] !== false ? '已开启' : '已关闭',
        ),
      ])

      const engine = row(
        'engine',
        '翻译引擎',
        React.createElement('span', null,
          '百度翻译开放平台「通用文本翻译」应用的 APP ID 与密钥。密钥只写入本机 ',
          React.createElement('code', { className: 'dsht-sec-key' }, settings.configPath || '$DSH_HOME/dsh-translate.json'),
          '，不会回传给浏览器；留空表示保持已保存的密钥不变。',
        ),
        [
          React.createElement('input', {
            key: 'appid',
            className: 'dsht-sec-input dsht-sec-key',
            placeholder: 'APP ID',
            value: appId,
            spellCheck: false,
            autoComplete: 'off',
            disabled: !loaded,
            onChange: (event) => patchForm({ appId: event.target.value, touched: true }),
          }),
          React.createElement('input', {
            key: 'secret',
            className: 'dsht-sec-input dsht-sec-key',
            type: 'password',
            placeholder: settings.hasSecret === true ? '密钥（已保存，留空不修改）' : '密钥',
            value: secretKey,
            spellCheck: false,
            autoComplete: 'off',
            disabled: !loaded,
            onChange: (event) => patchForm({ secretKey: event.target.value }),
          }),
          React.createElement('div', { className: 'dsht-sec-actions', key: 'actions' },
            React.createElement('button', {
              type: 'button',
              className: 'dsht-sec-btn',
              disabled: !canSave || busy === 'test',
              onClick: () => { void submitCredentials(false) },
            }, busy === 'save' ? '保存中…' : '保存'),
            React.createElement('button', {
              type: 'button',
              className: 'dsht-sec-btn dsht-sec-primary',
              disabled: !canSave || busy === 'save',
              onClick: () => { void submitCredentials(true) },
            }, busy === 'test' && note === null ? '测试中…' : '保存并测试'),
          ),
        ],
      )

      const shortcut = row(
        'shortcut',
        '快捷键',
        '选中文本后按下该快捷键即可直接翻译。点击右侧输入框，然后按下新的组合键即可修改；Backspace 恢复默认，Esc 取消。',
        [
          React.createElement('input', {
            key: 'capture',
            className: 'dsht-sec-input dsht-sec-key',
            'data-dsht-capture': '1',
            readOnly: true,
            title: '点击后按下新的组合键',
            value: capturing ? (pending === '' ? '请按下组合键…' : pending) : keyLabel(settings.shortcut || DEFAULT_SHORTCUT),
            disabled: !loaded,
            onFocus: () => { setCapturing(true); setPending('') },
            onBlur: () => { setCapturing(false); setPending('') },
            onKeyDown: onShortcutKeyDown,
          }),
          React.createElement('div', { className: 'dsht-sec-actions', key: 'actions' },
            React.createElement('span', { className: 'dsht-sec-note' }, `默认 ${keyLabel(DEFAULT_SHORTCUT)}`),
            React.createElement('button', {
              type: 'button',
              className: 'dsht-sec-btn',
              disabled: !loaded || !idle,
              onClick: () => { void save({ shortcut: DEFAULT_SHORTCUT }, 'shortcut', `已恢复默认快捷键 ${keyLabel(DEFAULT_SHORTCUT)}`) },
            }, '恢复默认'),
          ),
        ],
      )

      const target = row(
        'target',
        '默认目标语言',
        '自动时按原文判断：含中日韩文字译成英文，其余译成简体中文。也可以在翻译卡片里用 ⇄ 临时切换。',
        [
          React.createElement('select', {
            key: 'select',
            className: 'dsht-sec-select',
            value: settings.defaultTarget || 'auto',
            disabled: !loaded || !idle,
            onChange: (event) => { void save({ defaultTarget: event.target.value }, 'target', '已保存默认目标语言') },
          }, ...TARGET_LANGUAGES.map((code) => React.createElement(
            'option',
            { key: code, value: code },
            code === 'auto' ? '自动（中 ↔ 英）' : (LANGUAGES[code] ?? code),
          ))),
        ],
      )

      return React.createElement(
        'div',
        { className: 'dsht-sec', 'data-dsht-settings': '1' },
        React.createElement('div', { className: 'dsht-sec-head', key: 'head' },
          React.createElement('h3', { className: 'dsht-sec-h' }, '划词翻译'),
          React.createElement('div', { className: 'dsht-sec-lead' },
            loaded && settings.configured
              ? '已配置好百度翻译。选中文本后点击气泡或按快捷键即可翻译。'
              : '选中文本后点击气泡或按快捷键即可翻译；也可以随时在翻译卡片里修改引擎与目标语言。'),
        ),
        engine,
        shortcut,
        switchRow('enabled', '启用划词翻译', '关闭后不再响应划词与快捷键，设置和凭据都会保留。'),
        switchRow('showButton', '划词后显示翻译按钮', '关闭后只保留快捷键，选中文本时不再弹出小按钮。'),
        target,
        note === null ? null : React.createElement('div', {
          key: 'note',
          className: `dsht-sec-note dsht-sec-pad ${note.kind === 'ok' ? 'dsht-sec-ok' : 'dsht-sec-bad'}`,
        }, note.text),
      )
    }

    const inject = ['slots']

    function apply(ctx) {
      ensureStyles()
      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'dsh-translate', order: 60, label: () => '划词翻译' },
        Translator,
      ))
      ctx.slots.inject('settings.section', () => ctx.slots.register(
        { name: 'settings.section', id: 'dsh-translate', order: 60, label: () => '划词翻译' },
        SettingsSection,
      ))
    }

    exports.name = 'dsh-translate'
    exports.apply = apply
    exports.inject = inject
    exports.Translator = Translator
    exports.SettingsSection = SettingsSection
    exports.settingsStore = settingsStore
    exports.readSelection = readSelection
    exports.matchShortcut = matchShortcut
    exports.keyLabel = keyLabel
    exports.shortcutFromEvent = shortcutFromEvent
    exports.toLocal = toLocal
    exports.placeBeside = placeBeside
    exports.placeCard = placeCard
    return module.exports
  },
})
