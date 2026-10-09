#!/usr/bin/env node
// Capture several cropped PNGs from scripted visits to a running page: what
// shot.mjs cannot do in one command. A spec file names the visits; each one may
// run a script before first render, click, type, press keys and drag like a
// user, and capture as many crops as it needs, at every width asked for.
//
//   node shots.mjs <spec.mjs> [options]
//
// No install step and no dependency: one headless Chrome or Edge, driven with
// Node's own fetch and WebSocket, shared by every visit of the run.

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const USAGE = `shots - scripted captures of a running page

  node shots.mjs <spec.mjs> [options]

  --only <prefix>     run only the visits whose name starts with this
  --widths <list>     viewport widths, comma separated (default 1440)
  --height <px>       viewport height (default 900)
  --dpr <n>           device pixel ratio (default 2)
  --base <origin>     prefix for a visit url that starts with "/"
  --out <dir>         where the PNGs go (default: shots/ beside the spec)
  --timeout <ms>      limit for one load, wait or locate (default 30000)

The spec's default export is an array of visits:

  export default [{
    name: 'board',                 // names the visit; --only matches it
    url: '/board?tab=tasks',       // absolute, or "/..." joined to the base
    widths: [1440, 390],           // optional, overrides --widths
    theme: 'dark',                 // optional prefers-color-scheme
    init: 'window.flag = true',    // optional, runs before the page's scripts
    waitFor: '.board',             // optional, awaited after load
    async run(page, width) {       // optional; without it: one full capture
      await page.click({ text: 'New task' });
      await page.type('textarea', 'Add retry');
      await page.shot('board-new-task', '.panel', { pad: 8 });
    },
  }];

A spec may also export base, out, init (prepended to every visit's init) and
widths; a command-line flag wins over the export.

page: goto(url) reload() eval(js) fn(function, ...args) waitFor(css)
waitForText(text) click(target) hover(target) type(target, text, { clear })
press(key) drag(fromCss, toCss, { hold }) drop(fromCss, toCss) text(css)
wait(ms) shot(name, css | { full: true }, { pad }).
A target is a CSS selector or { selector, text, label, within, index, exact }.
shot writes <out>/<name>-<width>.png and prints one line for it.

Exit codes: 0 every visit ran, 1 a visit failed (its line says why and a
<visit>-FAILED capture is kept), 2 usage, 3 no browser, 4 no debugging port.
Set ACOS_CHROME or CHROME_PATH to choose the browser binary.`;

const E_FAILED = 1, E_USAGE = 2, E_NO_BROWSER = 3, E_NO_PORT = 4;

function die(code, message) {
  process.stderr.write(`shots: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const flags = {};
  const numeric = new Set(['height', 'dpr', 'timeout']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { process.stdout.write(`${USAGE}\n`); process.exit(0); }
    if (!arg.startsWith('--')) {
      if (flags.spec) die(E_USAGE, `unexpected argument ${arg}`);
      flags.spec = arg;
      continue;
    }
    const key = arg.slice(2);
    if (!['only', 'widths', 'height', 'dpr', 'base', 'out', 'timeout'].includes(key)) die(E_USAGE, `unknown option ${arg}`);
    const value = argv[++i];
    if (value === undefined) die(E_USAGE, `${arg} needs a value`);
    if (numeric.has(key)) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) die(E_USAGE, `${arg} needs a positive number`);
      flags[key] = n;
    } else {
      flags[key] = value;
    }
  }
  if (!flags.spec) die(E_USAGE, 'missing the spec file');
  return flags;
}

function parseWidths(value) {
  const list = (Array.isArray(value) ? value : String(value).split(',')).map(Number);
  if (!list.length || list.some(n => !Number.isFinite(n) || n <= 0)) die(E_USAGE, 'widths must be positive numbers');
  return list;
}

// Kept in step with shot.mjs, which is a standalone script and cannot be imported.
function browserCandidates() {
  const env = [process.env.ACOS_CHROME, process.env.CHROME_PATH].filter(Boolean);
  if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
      .filter(Boolean);
    return [
      ...env,
      ...roots.map(r => join(r, 'Google', 'Chrome', 'Application', 'chrome.exe')),
      ...roots.map(r => join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
    ];
  }
  if (process.platform === 'darwin') {
    return [
      ...env,
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      join(homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  }
  return [
    ...env,
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium',
    '/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable',
  ];
}

function findBrowser() {
  for (const path of browserCandidates()) {
    try { if (statSync(path).isFile()) return path; } catch { /* next */ }
  }
  return null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const flags = parseArgs(process.argv.slice(2));
const specPath = resolve(flags.spec);
let spec;
try { spec = await import(pathToFileURL(specPath).href); }
catch (error) { die(E_USAGE, `cannot load ${flags.spec}: ${error instanceof Error ? error.message : error}`); }
const visits = spec.default;
if (!Array.isArray(visits) || visits.some(v => !v || typeof v.name !== 'string' || typeof v.url !== 'string')) {
  die(E_USAGE, 'the spec must default-export an array of visits, each with a name and a url');
}

const settings = {
  widths: parseWidths(flags.widths ?? spec.widths ?? [1440]),
  height: flags.height ?? 900,
  dpr: flags.dpr ?? 2,
  base: (flags.base ?? spec.base ?? '').replace(/\/$/, ''),
  out: resolve(flags.out ?? (spec.out ? resolve(dirname(specPath), spec.out) : join(dirname(specPath), 'shots'))),
  timeout: flags.timeout ?? 30000,
};

const binary = findBrowser();
if (!binary) die(E_NO_BROWSER, 'no Chrome or Edge found; set ACOS_CHROME to the browser binary');

const profile = mkdtempSync(join(tmpdir(), 'acos-shot-'));
let browser = spawn(binary, [
  '--headless=new',
  '--remote-debugging-port=0',
  '--remote-allow-origins=*',
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-gpu', '--hide-scrollbars', '--mute-audio',
  'about:blank',
], { stdio: 'ignore' });
browser.on('error', () => die(E_NO_BROWSER, `could not start ${binary}`));

// As in shot.mjs: on Windows only taskkill /T ends the browser's children, which
// otherwise keep the profile locked, and the profile frees a moment after the kill.
const cleanup = () => {
  if (browser) {
    const child = browser;
    browser = null;
    const killed = process.platform === 'win32' && child.pid
      ? spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).status === 0
      : false;
    if (!killed) { try { child.kill(); } catch { /* already gone */ } }
  }
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
  catch { /* best effort */ }
};
process.on('exit', cleanup);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(1));

async function until(predicate, timeout, step = 150) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await sleep(step);
  }
  return null;
}

const port = await until(() => {
  try { return readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim(); }
  catch { return null; }
}, settings.timeout, 100);
if (!port) die(E_NO_PORT, 'the browser never opened a debugging port');
const wsUrl = await until(async () => {
  try { return (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; }
  catch { return null; }
}, settings.timeout);
if (!wsUrl) die(E_NO_PORT, 'the browser opened a port but never answered on it');

const ws = new WebSocket(wsUrl);
await new Promise((done, reject) => {
  ws.addEventListener('open', done, { once: true });
  ws.addEventListener('error', () => reject(new Error('the DevTools connection failed')), { once: true });
}).catch(error => die(E_NO_PORT, error.message));

let nextId = 0;
const pending = new Map();
const listeners = new Set();
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { done, reject, timer } = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(timer);
    if (message.error) reject(new Error(message.error.message)); else done(message.result);
  } else if (message.method) {
    for (const listener of listeners) listener(message);
  }
});
ws.addEventListener('close', () => {
  for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error('the browser closed the DevTools connection')); }
  pending.clear();
});
const send = (method, params = {}, sessionId) => new Promise((done, reject) => {
  if (ws.readyState !== WebSocket.OPEN) { reject(new Error(`cannot send ${method}: the DevTools connection is closed`)); return; }
  const id = ++nextId;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, settings.timeout);
  pending.set(id, { done, reject, timer });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});

const KEY_CODES = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, Delete: 46, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, ' ': 32 };

// Runs in the page: the centre of the one visible element a target names.
const LOCATE = `(spec) => {
  const norm = s => (s || '').replace(/\\s+/g, ' ').trim();
  const visible = el => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const root = spec.within ? document.querySelector(spec.within) : document;
  if (!root) return null;
  const interactive = 'button, a, [role=tab], [role=option], [role=menuitem], [role=radio], [role=checkbox], summary, label, input, select, textarea';
  let pool = [...root.querySelectorAll(spec.selector || interactive)].filter(visible);
  if (spec.text !== undefined) pool = pool.filter(el => spec.exact === false ? norm(el.textContent).includes(spec.text) : norm(el.textContent) === spec.text);
  if (spec.label !== undefined) pool = pool.filter(el => (el.getAttribute('aria-label') || '') === spec.label);
  const el = pool[spec.index || 0];
  if (!el) return null;
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}`;

// Runs in the page: where an element is, and whether it scrolls with the page.
const MEASURE = `(selector) => {
  const el = document.querySelector(selector);
  if (!el) return null;
  let fixed = false;
  for (let p = el; p; p = p.parentElement) if (getComputedStyle(p).position === 'fixed') { fixed = true; break; }
  const r = el.getBoundingClientRect();
  return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height, fixed, viewport: innerHeight };
}`;

class Page {
  constructor(sessionId, width) {
    this.sessionId = sessionId;
    this.width = width;
    this.height = settings.height;
  }

  cdp(method, params) { return send(method, params, this.sessionId); }

  async eval(expression) {
    const { result, exceptionDetails } = await this.cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text ?? 'evaluation failed');
    return result?.value;
  }

  // Runs a function in the page. It is sent as source, so it sees only its arguments.
  fn(func, ...args) { return this.eval(`(${func.toString()})(...${JSON.stringify(args)})`); }

  wait(ms) { return sleep(ms); }

  async #loaded(start) {
    let onLoad;
    const fired = new Promise(done => {
      onLoad = message => { if (message.sessionId === this.sessionId && message.method === 'Page.loadEventFired') done(true); };
      listeners.add(onLoad);
    });
    try {
      await start();
      if (!await Promise.race([fired, sleep(settings.timeout).then(() => false)])) throw new Error(`the page did not finish loading within ${settings.timeout}ms`);
    } finally {
      listeners.delete(onLoad);
    }
  }

  async goto(url) {
    const target = url.startsWith('/') ? settings.base + url : url;
    await this.#loaded(() => this.cdp('Page.navigate', { url: target }));
  }

  async reload() { await this.#loaded(() => this.cdp('Page.reload')); }

  async waitFor(selector, timeout = settings.timeout) {
    if (!await until(() => this.eval(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), timeout)) throw new Error(`${selector} never matched`);
  }

  async waitForText(text, timeout = settings.timeout) {
    if (!await until(() => this.eval(`document.body.innerText.includes(${JSON.stringify(text)})`), timeout)) throw new Error(`the text "${text}" never appeared`);
  }

  async locate(target) {
    const wanted = typeof target === 'string' ? { selector: target } : target;
    const point = await until(() => this.eval(`(${LOCATE})(${JSON.stringify(wanted)})`), Math.min(settings.timeout, 10000));
    if (!point) throw new Error(`could not locate ${JSON.stringify(wanted)}`);
    return point;
  }

  async #mouse(type, point, extra = {}) { await this.cdp('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, ...extra }); }

  async click(target, { settle = 400 } = {}) {
    await this.locate(target);
    await sleep(80);                                  // the first locate may have scrolled it into view
    const point = await this.locate(target);
    await this.#mouse('mouseMoved', point);
    await this.#mouse('mousePressed', point, { button: 'left', clickCount: 1 });
    await this.#mouse('mouseReleased', point, { button: 'left', clickCount: 1 });
    await sleep(settle);
  }

  async hover(target, { settle = 300 } = {}) {
    await this.#mouse('mouseMoved', await this.locate(target));
    await sleep(settle);
  }

  async press(key, { modifiers = 0, commands, settle = 300 } = {}) {
    const code = KEY_CODES[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
    const text = key === 'Enter' ? '\r' : null;
    await this.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code, modifiers, ...(commands ? { commands } : {}), ...(text && !modifiers ? { text, unmodifiedText: text } : {}) });
    await this.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code, modifiers });
    await sleep(settle);
  }

  async type(target, text, { clear = false, settle = 250 } = {}) {
    await this.click(target, { settle: 100 });
    if (clear) {
      await this.press('a', { modifiers: 2, commands: ['selectAll'], settle: 0 });
      await this.press('Delete', { settle: 0 });
    }
    await this.cdp('Input.insertText', { text });
    await sleep(settle);
  }

  // HTML drag and drop, as synthetic DragEvents sharing one DataTransfer: headless
  // browsers do not start a native drag from mouse events. hold: true stops over
  // the target, so the drag-over state can be captured; drop() then finishes it.
  async drag(from, to, { hold = false, settle = 700 } = {}) {
    await this.fn((source, target, held) => {
      const src = document.querySelector(source), dst = document.querySelector(target);
      if (!src || !dst) throw new Error('drag source or target missing');
      const data = new DataTransfer();
      const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
      fire(src, 'dragstart'); fire(dst, 'dragenter'); fire(dst, 'dragover');
      if (held) { window.__acosDrag = data; return; }
      fire(dst, 'drop'); fire(src, 'dragend');
    }, from, to, hold);
    await sleep(settle);
  }

  async drop(from, to, { settle = 700 } = {}) {
    await this.fn((source, target) => {
      const src = document.querySelector(source), dst = document.querySelector(target);
      if (!src || !dst) throw new Error('drag source or target missing');
      const data = window.__acosDrag ?? new DataTransfer();
      delete window.__acosDrag;
      const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
      fire(dst, 'drop'); fire(src, 'dragend');
    }, from, to);
    await sleep(settle);
  }

  text(selector) { return this.eval(`document.querySelector(${JSON.stringify(selector)})?.innerText ?? null`); }

  async #viewport(height) {
    await this.cdp('Emulation.setDeviceMetricsOverride', { width: this.width, height, deviceScaleFactor: settings.dpr, mobile: false });
  }

  async shot(name, target = { full: true }, { pad = 0, settle = 400, keepPointer = false } = {}) {
    if (!keepPointer) await this.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });   // drop hover styles
    await sleep(settle);
    const selector = typeof target === 'string' ? target : target.selector;
    const measure = async () => {
      if (!selector) return { fixed: true, ...await this.eval('({ x: scrollX, y: scrollY, width: innerWidth, height: innerHeight })') };
      const box = await until(() => this.eval(`(${MEASURE})(${JSON.stringify(selector)})`), Math.min(settings.timeout, 10000));
      if (!box) throw new Error(`shot ${name}: ${selector} matched no element`);
      return box;
    };
    let box = await measure();
    // An element taller than the window: grow the window to hold it rather than
    // capture beyond the viewport, which paints sticky and fixed chrome mid-picture.
    const grown = !box.fixed && box.y + box.height + pad > box.viewport;
    if (grown) {
      await this.#viewport(Math.ceil(box.y + box.height + pad + 60));
      await this.eval('window.scrollTo(0, 0)');
      await sleep(500);
      box = await measure();
    }
    const clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2, scale: 1 };
    if (clip.width <= 0 || clip.height <= 0) throw new Error(`shot ${name}: ${selector ?? 'the viewport'} has no area to capture`);
    const { data } = await this.cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip });
    if (grown) { await this.#viewport(this.height); await sleep(200); }
    if (!data) throw new Error(`shot ${name}: the browser returned no image`);
    const file = join(settings.out, `${name}-${this.width}.png`);
    mkdirSync(dirname(file), { recursive: true });
    const bytes = Buffer.from(data, 'base64');
    writeFileSync(file, bytes);
    process.stdout.write(`${file}  ${Math.round(clip.width * settings.dpr)}x${Math.round(clip.height * settings.dpr)}  ${bytes.length} bytes\n`);
    return file;
  }
}

// One browser context per visit, so storage and cookies never leak between visits.
async function openPage(visit, width) {
  const { browserContextId } = await send('Target.createBrowserContext');
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const page = new Page(sessionId, width);
  page.close = async () => {
    try { await send('Target.closeTarget', { targetId }); await send('Target.disposeBrowserContext', { browserContextId }); }
    catch { /* the browser is going away anyway */ }
  };
  await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: settings.height, deviceScaleFactor: settings.dpr, mobile: false });
  await page.cdp('Page.enable');
  if (visit.theme) await page.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: visit.theme }] });
  const init = [spec.init, visit.init].filter(Boolean).join('\n;\n');
  if (init) await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: init });
  return page;
}

let failed = 0, ran = 0;
for (const visit of visits) {
  if (flags.only && !visit.name.startsWith(flags.only)) continue;
  const widths = flags.widths ? settings.widths : visit.widths ? parseWidths(visit.widths) : settings.widths;
  for (const width of widths) {
    ran += 1;
    const page = await openPage(visit, width);
    try {
      await page.goto(visit.url);
      if (visit.waitFor) await page.waitFor(visit.waitFor);
      await sleep(visit.settle ?? 1500);            // hydration, as --settle in shot.mjs
      if (visit.run) await visit.run(page, width);
      else await page.shot(visit.name);
    } catch (error) {
      failed += 1;
      process.stderr.write(`shots: ${visit.name} @${width} failed: ${error instanceof Error ? error.message : error}\n`);
      try { await page.shot(`${visit.name}-FAILED`); } catch { /* nothing to show */ }
    } finally {
      await page.close();
    }
  }
}
ws.close();
if (!ran) die(E_USAGE, flags.only ? `no visit name starts with ${flags.only}` : 'the spec has no visits');
process.exit(failed ? E_FAILED : 0);
