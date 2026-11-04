# Rebase the fork onto upstream v1.7.7-rc.2 (T3)

## Context

The fork's work sits on `feature/personal-1.7.6` (based on upstream v1.7.6). Upstream has cut `v1.7.7-rc.2`
(7cdd2ab, 95 commits, +3387/−421). The user wants their features on rc.2 — Fable primary row, the layout
tidy-ups (compact layout, Density, Resets At, chevrons, measured width), and the "colour scheme" (elapsed-ring
staging + deep-orange Monthly Spend) — **without** the session-context panel (8edebc6) or the T4
resets-at diagnostic (cda5ccf). New branch `feature/personal-1.7.7-rc.2`; the old branch stays as the archive.
This closes queue item T3.

## Decision: `version` stays `1.7.7-rc.2`

- Lesson §4's rule is "keep `version` equal to the upstream base". The base is now rc.2.
- Read rc.2's `check-for-update` (main.js ~1960): the banner fires only when GitHub has a release *newer*
  than local. Upstream's latest stable is 1.7.6 (older) and its newest pre-release is rc.2 (equal) → no
  banner. It appears for rc.3 or stable 1.7.7 — exactly the "time to rebase" signal. Not permanent.
- §4's permanent-banner case is a *fork-invented* label (`1.7.6-kt.1`), not an upstream rc base. I'll
  reword §4 to say so.
- Artifact: `Claude-Usage-Widget-1.7.7-rc.2-kt-win-Setup.exe`.

## Steps

**0. Setup**
- Write `PROGRESS.md` (request verbatim, checklist, Decisions / Dead ends).
- `git switch -c feature/personal-1.7.7-rc.2 v1.7.7-rc.2`. Tracked `.claude/` files leave the working tree
  until step 3. Untracked `plans/` stays.
- `npm install`. Baseline: `node --test test/` and a headless smoke launch of plain rc.2
  (`node tools/cdp-drive.mjs --launch --profile cdp`, run from the old branch's copy in the scratchpad).
  This records rc.2's own console output, so anything new afterwards is ours.

**1. Cherry-pick in order. Every commit must run.** After each pick: `node --check` on the touched JS, then
the headless smoke launch. Fix any breakage *inside that pick's commit*. History stays bisectable, and no
broken tree is ever committed.

| Pick | Expected resolution |
|---|---|
| 6c0e05a permissions | Clean. rc.2 has no permission handler. |
| 6cef267 Fable primary row | Keep rc.2's `compactFableRow` + `seven_day_fable` normalisation. Add our primary row. |
| 8d984fd layout / Density / Resets At | See the sizing rules below. |
| deca708 ring staging | The settings-listener hunk sits beside rc.2's `applyTrayTaskbarRules` rework. Keep rc.2's three-way funnel. Drop our old bidirectional tray/hide listeners. Add ours. |
| b943855 orange spend | Must land on `.progress-fill.extra`. rc.2's `buildSpendCard()` still uses that class (app.js:679). Also `.compact-bar-fill.spend`. |
| e9797b9 sessionSection id + density staleness | Re-check the id exists in rc.2's markup (§2). |
| d7fb22e `-kt-` artifact names | Clean. |
| 37f2fcd tools/cdp-drive.mjs + build.files | Use `-n`. Keep `tools/` and the `package.json` hunk. Drop its `.claude`/`CLAUDE.md` hunks, which have no base on rc.2. Step 3 brings those. Commit under the original message. |

**Sizing rules (8d984fd, and 6cef267 where it applies)**
- `main.js` `resize-window`: keep our `(height, width, remember)` signature and stored width. Apply rc.2's
  guard (`Math.round`, finite, >0) to **both** height and width before `setContentSize`.
- `main.js` window position: take rc.2's `recoverBounds()`/`orderedDisplays()`. Drop our
  `isPositionOnScreen`, which rc.2 deleted. Feed it `getNormalWidth()`/`getNormalHeight()`, not
  `WIDGET_WIDTH`/`WIDGET_HEIGHT`. Our side removes `WIDGET_HEIGHT`, so rc.2's references to it at the
  `createMainWindow` and recover-to-centre sites (merged ~574, ~596) would throw a ReferenceError.
- `app.js` `resizeWidget()`: keep rc.2's settings-open early return → `resizeSettingsPanel()`. Keep its
  per-child `getBoundingClientRect` expansion measure (the spend card is variable height). Keep our
  `COLLAPSED_HEIGHTS[density] + fableOffset`. Send `Math.round(totalHeight)` with `measuredWidth()`.
- Settings panel: drop `SETTINGS_HEIGHT`. Use rc.2's `measureSettingsHeight()`/`resizeSettingsPanel()`.
  `resizeSettingsPanel()` must pass `PANEL_WIDTH`, or main falls back to the narrow measured widget width.
  Route rc.2's direct `resizeWindow(measureSettingsHeight())` (in `applyTrayTaskbarRules`) through it too.
  Its pinned 530px measuring width equals `PANEL_WIDTH` 560 minus padding, so they agree.
- Login screen `resizeWindow(360)` keeps our `PANEL_WIDTH` argument.
- `index.html`: insert our Density/Resets At and Elapsed-rings rows before rc.2's "date format + auto
  refresh" row, and renumber the row comments.

**2. Knowledge layer (one commit)**
- `git checkout feature/personal-1.7.6 -- .claude CLAUDE.md`
- `.gitignore`: on top of rc.2's version, remove `.claude/` and `CLAUDE.md`, and add
  `.claude/settings.local.json` with the fork's comment.
- `CLAUDE.md`: rc.2 now has `test/` (`node --test test/`). Add `src/logger.js` and `src/window-bounds.js`
  to the layout. Debug is `DEBUG_LOG=1` or `--debug-log`. Base is now `v1.7.7-rc.2` on branch
  `feature/personal-1.7.7-rc.2`. List what the fork drops (the context panel). Stay under 200 lines.
- `.claude/rules/renderer-sizing.md` §1: settings height is now measured (`measureSettingsHeight`), not
  `SETTINGS_HEIGHT`. The footer-bottom check still applies.
- `.claude/rules/fork-versioning.md` §4: an upstream rc base is fine; fork-only labels are not. Update the
  artifact example.
- `ToDo.md`: delete T3 (this task). Fix "There is no test suite" in Verification notes.
- Commit this plan file (`plans/snazzy-conjuring-comet.md`). Do **not** commit `plans/buzzing-discovering-forest.md`.

**3. `npm audit fix`** on rc.2's lockfile, as its own commit, only if `npm audit` reports advisories.
6ac3adf is not picked.

## Verification (headless, `--profile cdp`, injected payload per §5)

- `node --test test/` passes. `node --check` on main.js, preload.js, app.js.
- Console: nothing beyond the rc.2 baseline from step 0.
- Matrix: Density {tight, compact, comfortable} × Fable row {present, absent} × Resets At {on, off}, collapsed
  and expanded with a spend card. Check:
  - Last row's `getBoundingClientRect().bottom <= innerHeight` (§1).
  - `measuredWidth()` returns a number (§2), and the row does not overflow horizontally.
- Settings: footer bottom ≤ innerHeight, window width = PANEL_WIDTH, opened both from the widget and from
  compact.
- Ring staging: all four modes change the `.timer-progress.*` strokes. `RING_BASE_COLORS` still mirrors the
  CSS (§3, by script).
- Orange: the computed background of `.spend-card .progress-fill.extra` contains `rgb(234, 88, 12)`.
- Compact mode with and without Fable: the window fits.
- Absence: `git grep -n -E 'session-context|getSessionContext|showSessionContext|resets-at-debug'` is empty.
- Size: `git diff --stat v1.7.7-rc.2 HEAD` on app files is the same order of magnitude as the ~920-line
  baseline.

## Finish

- Push: `git push -u fork feature/personal-1.7.7-rc.2`. Never push to `origin`.
- Install (needs your action): close the running widget, then `npm run build:win` and
  `dist\Claude-Usage-Widget-1.7.7-rc.2-kt-win-Setup.exe /S`. Then a real-account check with the plain
  `--launch` or the installed app.
- Delete `PROGRESS.md`, folding its Decisions / Dead ends into the final commit.

## Critical files

`main.js`, `preload.js`, `src/renderer/app.js`, `src/renderer/index.html`, `src/renderer/styles.css`,
`package.json`, `.gitignore`, `CLAUDE.md`, `.claude/**`, `tools/cdp-drive.mjs`.

---

# Follow-up (2026-11-04): move the fork onto stable v1.7.7

## Context

Upstream released `v1.7.7` (1473f88). The installed fork build is `1.7.7-rc.2`, and it now shows the
"1.7.7 available" banner. Request: carry the same personalisations onto 1.7.7 and install it.

What 1.7.7 adds over rc.2 (`git log v1.7.7-rc.2..v1.7.7`; rc.2 is an ancestor of it):
- PR #133: the login window allows sign-in popups toward trusted domains, and Google country domains
  (`accounts.google.co.kr` etc.). Before, Google sign-in could fail with a bare "error during login".
- PR #130: profile name in the title bar and the tray tooltips, for `--profile` instances only.
- Docs (README, screenshots, STAGED_CHANGES.md deleted) and `version` 1.7.7.
- Code delta: main.js +66/−20, preload.js +3, app.js +7, index.html +1/−1.

`git merge-tree v1.7.7 feature/personal-1.7.7-rc.2` merges with **no conflicts**. The fork's
deny-all permission handler is a separate mechanism from 1.7.7's `setWindowOpenHandler` popups, so the two
don't overlap.

## Steps

1. `git switch -c feature/personal-1.7.7 feature/personal-1.7.7-rc.2`, then `git rebase v1.7.7`. This is a
   non-interactive replay of the fork's 11 commits. A rebase applies through the merge machinery, so rc.2's
   mixed-CRLF files keep their bytes. `feature/personal-1.7.7-rc.2` stays on `fork` untouched, as the rc.2
   archive.
2. `npm install`, then `npm audit`. If the advisories differ from the rc.2 run, apply `npm audit fix`
   (no `--force`) as its own commit.
3. **Title bar fix (fork-side, one CSS rule).** 1.7.7's `Claude Usage — <profile>` label has no overflow
   handling, and this fork narrows the window to 390px with seven title-bar buttons. Give `.title span` /
   `#titleBarLabel` `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`, with
   `.title` allowed to shrink. Without a profile, nothing changes.
4. Docs commit:
   - CLAUDE.md: base `v1.7.7`, branch `feature/personal-1.7.7`, the rc.2 branch as the second archive.
   - `rules/fork-versioning.md` §4: artifact example `1.7.7-kt`; the rc paragraph stays as history.
   - ToDo guardrail: "currently `1.7.7`".
   - `00_Index` diff base `v1.7.7`.
5. Push: `git push -u fork feature/personal-1.7.7`.
6. `npm run build:win`, then check that the app.asar listing holds no plans/tools/.claude.
7. **Install — ask first.** The widget is running (4 processes) and the installer replaces it and can start
   it on screen. Ask right before:
   `dist\Claude-Usage-Widget-1.7.7-kt-win-Setup.exe /S`.

## Verification (headless, nothing on screen)

- Re-create the scratch driver from the rc.2 session under the ignored `.scratch/`:
  - start the cdp profile hidden;
  - park the window beyond every display via the main inspector, then `showInactive()`;
  - pass `--disable-features=CalculateNativeWinOcclusion`.
  Delete `.scratch/` before building.
- `node --test "test/*.test.js"`.
- The 24-case Density × Fable × Resets At × expanded matrix.
- Ring modes, and the orange spend fill `rgb(234, 88, 12)`.
- Settings at 560px from the widget and from compact.
- Compact 136/108px with and without Fable.
- The title bar with profile `cdp`, and with a long profile name, at 390px: the buttons' right edge stays
  ≤ innerWidth and there is no wrap.
- Version: `package.json` is `1.7.7`, so the banner check finds nothing newer.
- After you install: the real account, in the installed build.
