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

## T2. Decide whether to push the fork branch to `KickTechnic/claude-usage-widget`

`feature/personal-1.7.6` exists only on this machine. The `fork` remote already holds the three declined PR
branches (#111/#112/#113) plus `pr-assets`.

**Acceptance.** Either pushed, or a line added to `Guardrails` below recording the decision not to, so this
stops being reconsidered every session.

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

- Launch with `--remote-debugging-port=<port>` and drive over CDP (`Runtime.evaluate` + `Page.captureScreenshot`).
  No screen takeover, and it screenshots the window directly rather than hunting a full-screen grab. A
  dependency-free driver is ~60 lines against Node's global `WebSocket`.
- **Back up `%APPDATA%\claude-usage-widget\config.json` first and restore it after.** Running the app writes
  real settings, and that file holds the session key and the usage history.
- **Restart the app between renderer edits** — reloading the page does not reliably pick up `app.js` /
  `styles.css` changes.
- Electron swallows `--debug`; use `DEBUG_LOG=1`.
- Heights: measure in the running app (see §1). `node --check` will not catch a temporal-dead-zone error, and
  static greps will not catch a missing HTML attribute (see §2).
