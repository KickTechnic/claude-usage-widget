# Claude Usage Widget — personal fork

Electron desktop widget showing Claude.ai usage. This repo is a **personal fork** of
[SlavomirDurej/claude-usage-widget](https://github.com/SlavomirDurej/claude-usage-widget); the fork's own work
lives on `feature/personal-1.7.6`, based on upstream `v1.7.6`. Upstream declined the three PRs this work came
from (#111/#112/#113), so it is not maintained for contribution back.

`origin` is upstream (read-only in practice). `fork` is `KickTechnic/claude-usage-widget`, and
`feature/personal-1.7.6` is pushed there — that is the branch's upstream, so `git push` alone is enough.
Nothing is ever pushed to `origin`.

## Layout

Four files carry almost everything. There is no build step for the renderer and **no test suite** —
verification is manual, in the running app.

| Path | What |
|---|---|
| `main.js` | Electron main: window sizing, tray, settings store, IPC, GitHub update check |
| `preload.js` | The `electronAPI` bridge — every renderer→main call goes through here |
| `src/renderer/app.js` | All renderer logic |
| `src/renderer/index.html` | Widget, compact view, Settings overlay |
| `src/renderer/styles.css` | Everything visual, including the `:root` layout-metrics block |

## What this fork changes vs upstream

Compact layout with a Density setting and an optional Resets At column; Fable as a primary row; both chevrons
in the 24px title bar; elapsed-ring staging modes; a deep-orange Monthly Spend bar; renderer permissions
denied. It deliberately does **not** carry the per-row colour configuration or the Colours page that the
superseded `feature/custom-colours` branch had.

## Lesson triggers (project-wide IDs)

Each line says WHEN to look, not what to do — the rule arrives on its own via `.claude/rules/` when a file it
governs is opened. Incidents: `.claude/memory/Lessons_Learned.md`.

1. Changing any window or panel height? → §1
2. Using a renderer DOM id or class from JS? → §2
3. Editing a `.timer-progress.*` stroke in CSS? → §3
4. Touching `version` or the update check? → §4
5. Dev instance won't start — exit 0, no output? → §5

## Working here

- **Open work lives in `.claude/memory/ToDo.md`.** Git is the completed-work log — no `Shipped.md`.
- Run it with `npm start`. Electron swallows `--debug`; use `DEBUG_LOG=1`.
- **Restart the app to test renderer edits** — reloading the page is not reliable for picking up `app.js` /
  `styles.css` changes.
- Driving it headlessly: **`node tools/cdp-drive.mjs --launch`** (`--help` for the options). Drives it over
  CDP without taking over the screen, and backs up `%APPDATA%\claude-usage-widget\config.json` around the run
  — the app rewrites it, and it holds the session key and usage history. Add `--profile cdp` for a throwaway
  instance that touches neither.
