# Queue — open work only

Open work only. Git is the completed-work log: closing an item means **deleting it here in the same commit as
the work**, whose message carries the record. Never mark an item DONE in place.

`T`-numbers are stable and never reused — completing T2 leaves a gap; a new task takes the highest + 1.

---

## T1. Verify the extra-row elapsed rings against real data

**Problem.** The four ring staging modes were verified live on the three primary rings (Session, Weekly,
Fable). The extra rows — Opus, Sonnet, Cowork, Design, OAuth Apps — could not be checked the same way,
because every one of those limits was `null` on the account at the time, so `buildExtraRows()` built only
Monthly Spend and there were no extra rings in the DOM.

They were verified **synthetically** instead: circles carrying each identity class were injected, cycled
through all four modes, and their computed strokes read back. That exercises the same code path
(`ringBaseColor()` → `elapsedPairFor()` → the CSS rule) and all seven classes passed.

**Acceptance.** Next time the account has real model usage, expand the panel and confirm the extra rings stage
correctly in Lighten — in particular that each keeps its own hue rather than falling back to Session purple.

**Note while checking:** in **Original** mode the Opus ring's warn stage is invisible, because Opus's base
`#f59e0b` *is* the original warn colour. That is upstream behaviour, not a regression — decide whether it is
worth caring about.

---

## T3. Rebase onto upstream when 1.7.7 ships

The fork's whole design assumes cheap rebases: CSS was kept at upstream's literal values rather than
tokenised, precisely so the diff stays small.

**Acceptance.** `git diff --stat <new-tag> HEAD` stays in the same order of magnitude as today's baseline
(~920 insertions across 6 app files), `version` in `package.json` moved to the new upstream number (see §4),
and the app launches with no console output.

---

# Guardrails — decided, do NOT undo

- **Do not re-add the Colours page or per-row colour pickers.** Deliberately dropped when porting onto v1.7.6.
  The Lighten/Darken engine was kept; the configurability around it was not.
- **Do not tokenise the CSS colours** into `--row-*` / `--status-*` custom properties. They were reverted to
  upstream's literals on purpose, to keep the rebase diff small. Nothing writes to them any more.
- **Do not change `productName`** — it sets the install directory *and* the `userData` path, so changing it
  orphans the existing `config.json` (session key, settings, usage history) rather than upgrading it.
- **Do not give the fork a pre-release `version`** to mark it as a fork build — see §4; it causes a permanent,
  unclearable update banner. Mark builds in `artifactName` instead.

---

# Verification notes (how to check things here)

There is no test suite. What worked, and is worth reusing:

- **`node tools/cdp-drive.mjs --launch`** — drives the app over CDP (`Runtime.evaluate` +
  `Page.captureScreenshot`). No screen takeover, and it screenshots the window directly rather than hunting a
  full-screen grab. It backs up `%APPDATA%\claude-usage-widget\config.json` before the run and restores it in
  a `finally` (Ctrl-C included), because running the app rewrites that file and it holds the session key and
  the usage history. Exit code is 1 on a failed probe or a renderer error, so it can gate a script.
- `--profile cdp` uses `main.js`'s profile isolation instead of the backup: a throwaway instance that never
  touches the real settings, at the cost of having no session key, so it shows the logged-out state. Use it
  for a pure smoke test; use the plain `--launch` when the check needs real usage data.
- `--expr '<js>'` adds a custom probe alongside the built-in one; `--help` prints the rest. It is
  dependency-free (Node's global `WebSocket`, so **Node ≥ 22**) and kept out of the packaged app by
  `build.files`.
- **Restart the app between renderer edits** — reloading the page does not reliably pick up `app.js` /
  `styles.css` changes.
- Electron swallows `--debug`; use `DEBUG_LOG=1`.
- Heights: measure in the running app (see §1). `node --check` will not catch a temporal-dead-zone error, and
  static greps will not catch a missing HTML attribute (see §2).
