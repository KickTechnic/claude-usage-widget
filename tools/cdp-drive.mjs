#!/usr/bin/env node
//
// Dev-only. Drives the widget over the Chrome DevTools Protocol instead of taking over the screen.
//
// This fork has no test suite: verification is manual, in the running app (see CLAUDE.md). Driving it over
// CDP keeps that honest without stealing focus, and screenshots the window directly rather than hunting a
// full-screen grab.
//
//   node tools/cdp-drive.mjs                      attach to an instance you started yourself
//   node tools/cdp-drive.mjs --launch             spawn Electron, probe it, kill it
//   node tools/cdp-drive.mjs --launch --profile cdp   ... in a throwaway profile (see "Config safety")
//   node tools/cdp-drive.mjs --launch --expr 'document.body.innerText'
//
// Options:
//   --launch            spawn `electron .` rather than attaching to a running instance
//   --port <n>          CDP port (default 9222)
//   --profile <name>    pass --profile=<name> through to main.js, isolating settings and session
//   --out <dir>         where to write the screenshot (default: a temp dir, never the repo)
//   --expr <js>         extra expression to evaluate in the renderer; result printed as JSON
//   --expr-file <path>  same, read from a file
//   --wait <ms>         settle time before probing (default 3000)
//   --no-screenshot     skip Page.captureScreenshot
//   --keep-open         with --launch, leave the app running (config is still restored)
//   --quiet             suppress the spawned app's stdout/stderr dump
//
// Exit code is 0 only if a target was found, the probe evaluated, and the renderer logged no errors —
// so this can gate a script.
//
// Config safety — two mechanisms, because they serve different needs:
//
//   --launch alone drives the REAL profile, so the probe sees the real session key and live usage data.
//   Running the app rewrites config.json, which holds that session key and the usage history, so this
//   script backs the file up before spawning and restores it in a finally — including on Ctrl-C.
//
//   --launch --profile <name> uses the isolation main.js already implements (userData is redirected to
//   profiles/<name>), so nothing shared is touched and no backup is needed. Safest for a pure smoke test,
//   but the instance is a fresh install: it has no session key, so it shows the logged-out state.

import { spawnSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The dependency-free part is load-bearing: this needs no packages, but global WebSocket landed in Node 22.
if (typeof WebSocket === 'undefined') {
  console.error(`FAIL: needs Node >= 22 for the global WebSocket (running ${process.version}).`);
  process.exit(1);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));

// ---------------------------------------------------------------- arguments

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);

if (has('--help') || has('-h')) {
  // The header comment is the manual; print it rather than maintaining the same text twice.
  const lines = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1);
  const end = lines.findIndex((l) => !l.startsWith('//')); // stop at the first non-comment line
  console.log(lines.slice(0, end).map((l) => l.replace(/^\/\/ ?/, '')).join('\n').trim());
  process.exit(0);
}

const val = (f, d) => {
  const i = argv.indexOf(f);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : d;
};

const opts = {
  launch: has('--launch'),
  port: val('--port', '9222'),
  profile: val('--profile', null),
  out: val('--out', path.join(os.tmpdir(), 'claude-usage-widget-cdp')),
  wait: Number(val('--wait', '3000')),
  screenshot: !has('--no-screenshot'),
  keepOpen: has('--keep-open'),
  quiet: has('--quiet'),
  expr: has('--expr-file') ? fs.readFileSync(val('--expr-file'), 'utf8') : val('--expr', null),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- config backup

// Electron derives userData from package.json `name` in a dev run (`electron .`); the packaged app uses
// productName instead, but this script only ever drives a dev run from the repo.
function configPath() {
  const base =
    process.platform === 'win32'
      ? process.env.APPDATA
      : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support')
        : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  const userData = path.join(base, pkg.name);
  // A profile instance writes under profiles/<name>, so the shared file is never touched.
  return opts.profile ? null : path.join(userData, 'config.json');
}

let backup = null;
function backupConfig() {
  const cfg = configPath();
  if (!cfg || !fs.existsSync(cfg)) return;
  backup = { file: cfg, data: fs.readFileSync(cfg) };
  console.log(`config backed up: ${cfg} (${backup.data.length} bytes)`);
}
function restoreConfig() {
  if (!backup) return;
  fs.writeFileSync(backup.file, backup.data);
  console.log(`config restored: ${backup.file}`);
  backup = null;
}

// ---------------------------------------------------------------- process control

let child = null;
function launchApp() {
  const electron = require('electron');
  const args = ['.', `--remote-debugging-port=${opts.port}`];
  if (opts.profile) args.push(`--profile=${opts.profile}`);

  child = spawn(electron, args, {
    cwd: REPO,
    // DEBUG_LOG is how this app opts into verbose logging; Electron swallows --debug.
    env: { ...process.env, DEBUG_LOG: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const out = [];
  child.stdout.on('data', (d) => out.push(String(d)));
  child.stderr.on('data', (d) => out.push(String(d)));
  console.log(`launched: ${path.basename(electron)} ${args.join(' ')} (pid ${child.pid})`);
  return out;
}

function killApp() {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    // A bare child.kill() orphans Electron's GPU and renderer children.
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  }
  console.log(`app killed (pid ${child.pid})`);
}

// Ctrl-C must still restore the real config.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { killApp(); restoreConfig(); process.exit(130); });
}

// ---------------------------------------------------------------- CDP

async function waitForTargets(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${opts.port}/json/list`);
      const targets = await r.json();
      if (targets.some((t) => t.type === 'page')) return targets;
    } catch { /* not listening yet */ }
    await sleep(400);
  }
  return [];
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const events = [];
    let id = 0;

    ws.addEventListener('open', () => resolve({ send, events }));
    ws.addEventListener('error', () => reject(new Error(`could not open ${wsUrl}`)));
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
      } else if (msg.method) {
        events.push(msg);
      }
    });

    function send(method, params = {}) {
      return new Promise((res, rej) => {
        const mid = ++id;
        pending.set(mid, { resolve: res, reject: rej });
        ws.send(JSON.stringify({ id: mid, method, params }));
      });
    }
  });
}

// The health probe: what a human glancing at the widget would confirm.
const PROBE = `(() => {
  const body = document.body;
  return {
    href: location.href,
    title: document.title,
    readyState: document.readyState,
    winSize: [window.innerWidth, window.innerHeight],
    bodyChildCount: body ? body.children.length : -1,
    hasElectronAPI: typeof window.electronAPI,
    electronAPIKeys: window.electronAPI ? Object.keys(window.electronAPI).length : 0,
    rings: document.querySelectorAll('.timer-progress').length,
    svgs: document.querySelectorAll('svg').length,
    settingsOverlay: !!document.querySelector('#settingsOverlay, .settings-overlay'),
    visibleText: (body ? body.innerText : '').replace(/\\s+/g, ' ').trim().slice(0, 400),
  };
})()`;

async function evaluate(send, expression) {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description || JSON.stringify(res.exceptionDetails));
  }
  return res.result.value;
}

// ---------------------------------------------------------------- main

let failed = false;
let appOutput = [];

try {
  if (opts.launch) {
    backupConfig();
    appOutput = launchApp();
  }

  const targets = await waitForTargets(opts.launch ? 40000 : 8000);
  if (!targets.length) {
    console.error(`FAIL: no CDP page target on port ${opts.port}` +
      (opts.launch ? ' — the app did not start' : ' — is the app running with --remote-debugging-port?'));
    failed = true;
  } else {
    console.log('=== targets ===');
    for (const t of targets) console.log(`  [${t.type}] ${t.title} :: ${t.url}`);

    // The widget renderer is the local index.html page; claude.ai loads in a separate view.
    const widget = targets.find((t) => t.type === 'page' && /index\.html/.test(t.url))
      || targets.find((t) => t.type === 'page');

    const { send, events } = await connect(widget.webSocketDebuggerUrl);
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Log.enable').catch(() => {});
    await sleep(opts.wait);

    console.log('\n=== probe ===');
    console.log(JSON.stringify(await evaluate(send, PROBE), null, 2));

    if (opts.expr) {
      console.log('\n=== --expr ===');
      console.log(JSON.stringify(await evaluate(send, opts.expr), null, 2));
    }

    if (opts.screenshot) {
      fs.mkdirSync(opts.out, { recursive: true });
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(opts.out, 'widget.png');
      const buf = Buffer.from(shot.data, 'base64');
      fs.writeFileSync(file, buf);
      console.log(`\nscreenshot: ${file} (${buf.length} bytes)`);
    }

    // Console capture starts at attach, so startup logs live in the app's stdout below, not here.
    const logs = events.filter((e) => e.method === 'Runtime.consoleAPICalled' || e.method === 'Log.entryAdded');
    console.log(`\n=== renderer console (${logs.length}) ===`);
    for (const l of logs) {
      const p = l.params;
      const level = p.type || p.entry?.level;
      const text = p.entry
        ? p.entry.text
        : (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
      if (level === 'error') failed = true;
      console.log(`  [${level}] ${String(text).slice(0, 240)}`);
    }
  }
} catch (err) {
  console.error(`FAIL: ${err.message}`);
  failed = true;
} finally {
  if (opts.launch && !opts.keepOpen) killApp();
  // Always restore, even with --keep-open: the file has already been rewritten by then.
  restoreConfig();
}

if (opts.launch && !opts.quiet) {
  await sleep(300); // let the last stdout chunks flush
  const text = appOutput.join('').trim();
  console.log(`\n=== app output ===\n${text || '(none)'}`);
}

console.log(`\n${failed ? 'FAIL' : 'OK'}`);
process.exit(failed ? 1 : 0);
