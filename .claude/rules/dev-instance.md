---
paths:
  - "main.js"
  - "tools/cdp-drive.mjs"
---

# Running a dev instance

## §5 — A dev instance quits silently when the installed app is running. Check that first.

`main.js` ends with the standard guard:

```js
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}
```

The installed build (`%LOCALAPPDATA%\Programs\Claude-Usage-Widget\Claude-Usage-Widget.exe`) holds that lock
whenever it is running — including from the tray, where it is easy to forget it exists. A second instance
launched from the repo then **exits 0, prints nothing, and creates no window**.

**That failure is indistinguishable from a crash in whatever you just edited.** There is no error, no stack,
no `[Debug]` line, and the exit code says success. `tools/cdp-drive.mjs` reports only `no CDP page target —
the app did not start`, because Electron does start: the browser-level DevTools endpoint comes up and answers,
so `/json/list` returns a browser target and no page. Everything points at your own change.

**So: before debugging a dev instance that will not start, check for the installed one.**

```powershell
Get-Process -Name Claude-Usage-Widget -ErrorAction SilentlyContinue
```

**The fix is `--profile`, not closing the app.** `main.js` redirects `userData` to `profiles/<name>` before
anything reads it, and the lock is keyed on that directory, so `node tools/cdp-drive.mjs --launch --profile cdp`
runs happily alongside the installed build.

**What a profile instance cannot do is log in**, so plan verification around that. Its `config.json` is a
fresh install, and seeding it by copying the real one does not work either: `safeStorage.decryptString` fails
(`Failed to decrypt session key on startup`) because the DPAPI blob belongs to the installed app. A profile
instance therefore shows the login screen, with `#mainContent` hidden.

That is not a dead end — it only blocks the claude.ai half. Reveal the content view and drive the real render
path with an injected payload, which covers layout, sizing and any local data source:

```js
document.getElementById('loginContainer').style.display = 'none';
document.getElementById('mainContent').style.display = '';
updateUI({ five_hour: { utilization: 41, resets_at: iso }, seven_day: { ... } });
```

Anything needing **real** account data still needs the installed app closed and a plain `--launch`.

(Incident: `.claude/memory/Lessons_Learned.md` §5.)
