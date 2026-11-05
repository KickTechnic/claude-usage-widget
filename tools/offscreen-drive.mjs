#!/usr/bin/env node
//
// Dev-only. The off-screen companion to cdp-drive.mjs: runs a probe's cases against a throwaway profile
// without anything appearing on screen, so it needs no permission to run and cannot catch a stray keypress.
//
//   node tools/offscreen-drive.mjs tools/probes/<probe>.js [--profile <name>] [--only 'case|case'] [--shot <png>]
//
// How it stays off screen: the profile's config.json is rewritten every run to start hidden (tray-verified),
// then, through the main-process inspector, the window is parked beyond the right edge of every display and
// shown with showInactive() — shown, so resizes reach the renderer, but never focused and never visible.
// --disable-features=CalculateNativeWinOcclusion stops Windows treating the parked window as occluded.
//
// A profile instance cannot log in (see .claude/rules/dev-instance.md §5), so probes drive the real render
// path with injected payloads instead.
//
// A probe file evaluates to true and defines globalThis.__probe = {
//   cases: [names],
//   prepare?(name) -> main-process JS string | null   run in main before the case (e.g. seed the store)
//   run(name) -> Promise                              drive the renderer
//   measure() -> { bottom, right, innerW, innerH, note, overflowing? }
// }
// A case passes when the content fits the window (bottom/right within the content bounds, innerH matching
// the window) and `overflowing` is falsy — probes set it to flag their own failed assertions.
//
// Exit code is 1 on any failed case, missing target or renderer console error.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(REPO, 'package.json'));
const argv = process.argv.slice(2);
const opt = (f, d) => { const i = argv.indexOf(f); return i !== -1 ? argv[i + 1] : d; };
const probeFile = argv[0];
const shot = opt('--shot', null);
const only = opt('--only', null);
const profile = opt('--profile', 'cdp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!probeFile || !fs.existsSync(probeFile)) {
  console.error('usage: node tools/offscreen-drive.mjs tools/probes/<probe>.js [--profile <name>] [--only \'a|b\'] [--shot <png>]');
  process.exit(2);
}
if (profile === '' || /[\\/]/.test(profile)) {
  console.error('--profile must be a plain name: the real config is never touched by this driver');
  process.exit(2);
}

// Fresh profile config every run, so one run's saved settings can't leak into the next. Hidden start
// (tray-verified) means the window is never shown normally — it is parked off-screen below instead.
const profileDir = path.join(process.env.APPDATA, 'claude-usage-widget', 'profiles', profile);
fs.mkdirSync(profileDir, { recursive: true });
fs.writeFileSync(path.join(profileDir, 'config.json'), JSON.stringify({
  state: { windowVisibilityOnExit: 'hidden' },
  settings: { minimizeToTray: true, showTrayStats: true },
}, null, '\t'));

const electron = require('electron');
const child = spawn(electron, ['--inspect=9229', '.', '--remote-debugging-port=9222', `--profile=${profile}`,
  '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'], {
  cwd: REPO, env: { ...process.env, DEBUG_LOG: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
});
const out = [];
child.stdout.on('data', (d) => out.push(String(d)));
child.stderr.on('data', (d) => out.push(String(d)));
const kill = () => spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });

async function list(port) {
  try { return await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { return []; }
}
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0; const pending = new Map(); const events = [];
    ws.addEventListener('open', () => resolve({
      events,
      send: (method, params = {}) => new Promise((res, rej) => {
        const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params }));
      }),
    }));
    ws.addEventListener('error', reject);
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
      else if (m.method) events.push(m);
    });
  });
}
async function evaluate(c, expression) {
  const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

let failed = false;
try {
  let page = null, mainT = null;
  for (let i = 0; i < 80 && !(page && mainT); i++) {
    await sleep(500);
    page ??= (await list(9222)).find((t) => t.type === 'page' && /index\.html/.test(t.url));
    mainT ??= (await list(9229))[0];
  }
  if (!page || !mainT) throw new Error(`targets missing: page=${!!page} main=${!!mainT} — is another instance holding port 9222/9229?`);

  const main = await connect(mainT.webSocketDebuggerUrl);
  await main.send('Runtime.enable');
  let parked = null;
  for (let i = 0; i < 40 && !parked; i++) {
    await sleep(250);
    parked = await evaluate(main, `(() => {
      const { BrowserWindow, screen } = process.mainModule.require('electron');
      const w = BrowserWindow.getAllWindows().find((x) => /index\\.html/.test(x.webContents.getURL()));
      if (!w) return null;
      const right = Math.max(...screen.getAllDisplays().map((d) => d.bounds.x + d.bounds.width));
      w.setPosition(right + 2000, 0);
      w.showInactive();
      globalThis.__probeWin = w;
      return { pos: w.getPosition(), visible: w.isVisible(), focused: w.isFocused() };
    })()`).catch(() => null);
  }
  console.log('parked:', JSON.stringify(parked));

  const r = await connect(page.webSocketDebuggerUrl);
  await r.send('Runtime.enable'); await r.send('Log.enable').catch(() => {}); await r.send('Page.enable');
  await sleep(2500);
  await evaluate(r, fs.readFileSync(probeFile, 'utf8'));
  const cases = (await evaluate(r, '__probe.cases')).filter((c) => !only || only.split('|').includes(c));
  for (const name of cases) {
    const prep = await evaluate(r, `__probe.prepare ? __probe.prepare(${JSON.stringify(name)}) : null`);
    if (prep) await evaluate(main, prep);
    await evaluate(r, `__probe.run(${JSON.stringify(name)})`);
    await sleep(700);
    const b = await evaluate(main, '__probeWin.getContentBounds()');
    const m = await evaluate(r, '__probe.measure()');
    const fits = m.bottom <= b.height && m.right <= b.width && (m.innerH === undefined || m.innerH === b.height)
      && !m.overflowing;
    if (!fits) failed = true;
    console.log(`${fits ? 'ok  ' : 'BAD '} ${name.padEnd(34)} window ${b.width}x${b.height}  inner ${m.innerW}x${m.innerH}  content ->${m.right} v${m.bottom}  ${m.note || ''}`);
  }
  const after = await evaluate(main, `(() => ({ focused: __probeWin.isFocused(), anyFocused: !!process.mainModule.require('electron').BrowserWindow.getFocusedWindow() }))()`);
  console.log('main after:', JSON.stringify(after));
  if (shot) {
    const s = await r.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(shot, Buffer.from(s.data, 'base64'));
    console.log('shot:', shot);
  }
  const logs = r.events.filter((e) => e.method === 'Runtime.consoleAPICalled' || e.method === 'Log.entryAdded');
  console.log(`renderer console (${logs.length})`);
  for (const l of logs) {
    const p = l.params; const level = p.type || p.entry?.level;
    if (level === 'error') failed = true;
    console.log(`  [${level}] ${String(p.entry ? p.entry.text : (p.args || []).map((a) => a.value ?? a.description).join(' ')).slice(0, 300)}`);
  }
} catch (e) {
  console.error('FAIL:', e.message); failed = true;
} finally {
  kill();
}
await sleep(300);
console.log('--- app output ---\n' + out.join('').split('\n').filter((l) => !/Denied "(media|geolocation|web-app-installation)" requested by|Debugger listening|For help, see|^\s*$/.test(l)).join('\n'));
console.log(failed ? 'FAIL' : 'OK');
process.exit(failed ? 1 : 0);
