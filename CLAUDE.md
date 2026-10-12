# Claude Usage Widget — personal fork

Electron desktop widget showing Claude.ai usage. This repo is a **personal fork** of
[SlavomirDurej/claude-usage-widget](https://github.com/SlavomirDurej/claude-usage-widget); the fork's own work
lives on `feature/personal-1.7.7-rc.2`, based on upstream `v1.7.7-rc.2`. Upstream declined the three PRs this
work came from (#111/#112/#113), so it is not maintained for contribution back. The previous base,
`feature/personal-1.7.6`, is kept untouched as the archive — it alone has the session-context panel.

`origin` is upstream (read-only in practice). `fork` is `KickTechnic/claude-usage-widget`, and
`feature/personal-1.7.7-rc.2` is pushed there — that is the branch's upstream, so `git push` alone is enough.
Nothing is ever pushed to `origin`.

## Layout

Five files carry almost all of the fork's work. There is no build step for the renderer. Upstream's unit
tests (`node --test "test/*.test.js"`) cover only `src/window-bounds.js` and the session starter — the
renderer, sizing and everything this fork changes are verified manually, in the running app.

| Path | What |
|---|---|
| `main.js` | Electron main: window sizing, tray, settings store, IPC, GitHub update check |
| `preload.js` | The `electronAPI` bridge — every renderer→main call goes through here |
| `src/renderer/app.js` | All renderer logic |
| `src/renderer/index.html` | Widget, compact view, Settings overlay |
| `src/renderer/styles.css` | Everything visual, including the `:root` layout-metrics block |
| `src/window-bounds.js` | Upstream's `recoverBounds()` — off-screen recovery, fed this fork's measured size |
| `src/logger.js` | Upstream's file logger: `<userData>\logs\`, verbose lines only with `DEBUG_LOG=1` |

## What this fork changes vs upstream

Compact layout with a Density setting and an optional Resets At column; Fable as a primary row; both chevrons
in the 24px title bar; elapsed-ring staging modes; a deep-orange Monthly Spend bar; renderer permissions
denied. It deliberately does **not** carry the per-row colour configuration or the Colours page that the
superseded `feature/custom-colours` branch had, nor the session-context panel from the 1.7.6 branch.

## Lesson triggers (project-wide IDs)

Each line says WHEN to look, not what to do — the rule arrives on its own via `.claude/rules/` when a file it
governs is opened. Incidents: `.claude/memory/Lessons_Learned.md`.

1. Changing any window or panel height? → §1
2. Using a renderer DOM id or class from JS? → §2
3. Editing a `.timer-progress.*` stroke in CSS? → §3
4. Touching `version` or the update check? → §4
5. Dev instance won't start — exit 0, no output? → §5

## Working here

- **Open work lives in `.claude/memory/ToDo.md`.** Git is the completed-work log — no hand-kept log file.
- Run it with `npm start`. Electron swallows `--debug`; use `DEBUG_LOG=1` (or `--debug-log`).
- **Restart the app to test renderer edits** — reloading the page is not reliable for picking up `app.js` /
  `styles.css` changes.
- Driving it over CDP: **`node tools/cdp-drive.mjs --launch`** (`--help` for the options). It backs up
  `%APPDATA%\claude-usage-widget\config.json` around the run — the app rewrites it, and it holds the session
  key and usage history. Add `--profile cdp` for a throwaway instance that touches neither. **It is not
  headless:** the widget appears on screen, always on top, and takes focus, so a stray keypress can press its
  buttons — "Log in" opens a 1000×700 login window. Ask the user before running it.
