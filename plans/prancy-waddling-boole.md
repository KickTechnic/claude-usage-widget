# Hide the normal view's Current Session row when there is no session limit

## Context

785bfa8 hid the Session row in **compact** mode only. The plan behind it (`plans/snazzy-conjuring-comet.md`,
Follow-up 2) mapped "minimal view" to compact mode and ruled the normal view's row out of scope. The view the
user actually means is different:
- The live app runs in **normal** mode at **Tight** density (`settings.compactMode: false`, `density: tight`).
- Its "Current Session" row (`#sessionSection`) still shows, even though the live payload still has
  `five_hour: null`.

Goal: the normal view hides the Current Session row whenever the API sends no `five_hour`, and shows it again
when one appears. This is the same data test compact mode already uses.

Trap (lesson §2): `measuredWidth()` reads the grid tracks off `elements.sessionSection` to size the window. A
hidden row has no `offsetParent`, so it would return `undefined` forever, and the width would silently freeze
at the stored value. The measurement has to move to a row that is always present.

## Step 0 — Commit the off-screen driver (own commit)

Both scratchpad copies of the off-screen driver are gone (session cleanup). This is the second time it has had
to be rebuilt. Commit it under `tools/`, which `build.files` already excludes (`!tools`).
- `tools/offscreen-drive.mjs`: the scratch `drive.mjs`, unchanged in behaviour.
  - It starts the `cdp` profile hidden, parks the window beyond every display, and calls `showInactive()`.
  - Nothing appears on screen.
- `tools/probes/{layout,settings,compact,rings}.js`: rebuilt from the copies read in this session. The rings
  probe is rewritten. The title probe is dropped, because this change doesn't touch it.
- `tools/keep_eol.py`: stages a mixed-EOL file (`index.html`) without whitespace churn.
- `CLAUDE.md` "Working here" gets one line pointing at `tools/offscreen-drive.mjs` as the no-screen
  alternative to `cdp-drive.mjs`.

## Step 1 — The change

**`src/renderer/index.html`** (stage via `tools/keep_eol.py`; the file is mixed CRLF/LF)
- Weekly row: add `id="weeklySection"`. Move the "the id is load-bearing: `measuredWidth()` reads…" comment
  there from the Session row.
- Bar column header: add `id="usedColHeader"`.

**`src/renderer/app.js`**
- `elements`: add `weeklySection` and `usedColHeader`.
- Rename `FABLE_ROW_HEIGHTS` → `PRIMARY_ROW_HEIGHTS`.
  - The value is `--row-height` + `--row-gap`, which is what any optional primary row adds.
  - It now applies to both Fable and Session.
  - Update its comment.
- `updateUI()`, next to the existing `fableSection` toggle:
  - `elements.sessionSection.style.display = latestUsageData.five_hour ? '' : 'none'`
  - `usedColHeader` text is `Session Used` while the row shows, and `Used` while it is hidden.
  - Reason: a "SESSION USED" header over Weekly and Fable rows would be wrong.
- `resizeWidget()`:
  - Add `sessionOffset = latestUsageData && !latestUsageData.five_hour ? -PRIMARY_ROW_HEIGHTS[density] : 0`.
  - With no data yet (login screen, first paint), the row stays, matching the markup.
  - The comment says it mirrors `getNormalHeight()`.
- `measuredWidth()`: read `elements.weeklySection` instead of `sessionSection`. Weekly is always present, and
  every primary row shares `--grid-cols`.

**`main.js`**
- The same rename, `FABLE_ROW_HEIGHTS` → `PRIMARY_ROW_HEIGHTS`.
- `getNormalHeight()` subtracts `PRIMARY_ROW_HEIGHTS[density]` when `data && !data.five_hour`.
- Comments on both sides name their twin (§1).

**Docs**
- `CLAUDE.md`: the fork-changes clause becomes "the Session row hidden in both views while the API sends no
  `five_hour` window".
- `.claude/rules/renderer-sizing.md`:
  - §1: constant names, plus one line saying both views drop the Session row on `!five_hour`.
  - §2: `measuredWidth()` now reads `#weeklySection`, because the Session row can be hidden. Keep the
    incident history.

**Out of scope, unchanged**
- The purple session tray icon and the taskbar session panel. These still show 0%.
- Alerts: with `five_hour` null, `sessionPct` is 0, so they never fire.

## Verification (off-screen, `--profile cdp`, nothing on screen)

- **Layout matrix:** Density × Fable × Resets At × expanded × `five_hour` {present, null}, 48 cases. For each
  null case:
  - the last row's bottom is ≤ innerHeight (§1);
  - the bottom clearance equals the session-present twin's;
  - the window height equals the twin's minus `PRIMARY_ROW_HEIGHTS[density]`;
  - `measuredWidth()` is a number, equal to the twin's width.
- **Main's mirror:**
  - Seed main's store with `five_hour: null`, then send only `setCompactMode(false)` with no renderer resize.
  - The window height must equal the renderer's own `resizeWidget()` result, across 3 densities × Fable.
- **Header:** reads `Used` with no session and `Session Used` with one.
- **Other probes:** the compact probe (7 cases, unchanged), rings (4 modes, orange spend fill), and Settings
  (8 steps).
- **Unit tests and syntax:** `node --test "test/*.test.js"`, and `node --check` on main, preload and app.
- **Rename:** `git grep FABLE_ROW_HEIGHTS` is empty.
- **Screenshot:** Tight + Fable + no session, normal view.

## Finish

- Commits:
  - Step 0: `chore: commit the off-screen CDP driver and its probes`.
  - Step 1: `feat: hide the normal view's Current Session row when there is no five_hour window`.
  - Push both to `fork`.
- `npm run build:win`, then check that the app.asar holds no tools, plans or `.claude`.
- **Ask before installing.** The widget is running (4 processes), and the installer replaces it.

## Critical files

`src/renderer/index.html`, `src/renderer/app.js`, `main.js`, `CLAUDE.md`, `.claude/rules/renderer-sizing.md`,
`tools/offscreen-drive.mjs` and `tools/probes/*.js` (new), `tools/keep_eol.py` (new).
