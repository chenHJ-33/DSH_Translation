import { readFileSync } from "node:fs"
import { createContext, runInContext } from "node:vm"
const src = readFileSync("client/client.js", "utf8")
let captured = null
const sandbox = { window: { __ModuleLoader__: { load: (d) => { captured = d } }, innerWidth: 1280, innerHeight: 800, addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout, getSelection: () => null, matchMedia: () => ({ matches: true }) }, document: { baseURI: "http://127.0.0.1:19387/", head: { appendChild() {} }, body: {}, documentElement: {}, getElementById: () => null, createElement: () => ({ style: {}, appendChild() {} }), addEventListener() {} }, navigator: {}, fetch: async () => ({ json: async () => ({ ok: true, config: {} }) }), getComputedStyle: () => ({ backgroundColor: "rgb(24,26,32)" }), console, URL, Promise, setTimeout, clearTimeout, queueMicrotask }
sandbox.globalThis = sandbox
runInContext(src, createContext(sandbox), { filename: "client.js" })
console.log("captured:", captured && captured.id)
const React = { createElement: (type, props, ...kids) => ({ type, props: { ...(props || {}), children: kids } }), useState: (v) => [typeof v === "function" ? v() : v, () => {}], useRef: (v) => ({ current: v }), useCallback: (fn) => fn, useEffect: () => {} }
let C = null
const mod = captured.factory((n) => { if (n === "react") return React; throw new Error("req " + n) })
mod.apply({ slots: { inject: (k, cb) => cb(), register: (p, c) => { C = c; return () => {} } } })
console.log("component:", typeof C)
const tree = C()
console.log("tree type:", tree && tree.type, "className:", tree && tree.props.className)
