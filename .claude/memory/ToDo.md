# Queue — open work only

Open work only. Git is the completed-work log: closing an item means **deleting it here in the same commit as
the work**, whose message carries the record. Never mark an item DONE in place.

`T`-numbers are stable and never reused — completing T2 leaves a gap; a new task takes the highest + 1.

Next: T6

---

## T5. Upgrade Electron off the unsupported 41.x line

The shipped runtime is Electron 41.10.7, the last 41.x release. `npm audit` (2026-11-04) reports it **high**:
8 advisories, all fixed only in 42.11.x. The high one is GHSA-jr5w-w6x2-84p9 (mitigation for compromised
eMudhra intermediate certificates, fixed in 42.11.16); the rest cover permission and origin attribution,
SameSite cookies on link-opened windows, and frame geometry. No in-range fix exists — upstream 1.7.7 pins
`^41.10.1`, and npm's `--force` answer is a jump to 45.x. Recorded in c48c28d.

- **First check upstream** (`git log origin/develop -- package.json`): if upstream has moved Electron, take
  its version and rebase onto that, rather than diverging on the runtime.
- Otherwise choose the target deliberately: the newest supported major (45.x at the time of writing), or the
  smallest jump that clears the advisories (42.11.16+). Read the Electron breaking-changes notes for every
  major crossed. The surfaces this app leans on are `setContentSize`, `BrowserWindow` options, `Tray`,
  `safeStorage`, the session permission handlers, and `setWindowOpenHandler`.

**Acceptance.**
- [ ] `npm audit` shows no electron advisory.
- [ ] `node --test "test/*.test.js"` passes.
- [ ] The headless sizing / rings / Settings / compact checks pass, as listed for 0acb706.
- [ ] The installed build logs in, fetches live usage, and keeps the existing `config.json`. This means the
  session key still decrypts under `safeStorage` after the upgrade.

---

# Guardrails — decided, do NOT undo

- **Do not re-add the Colours page or per-row colour pickers.** Deliberately dropped when porting onto v1.7.6.
  The Lighten/Darken engine was kept; the configurability around it was not.
- **Do not tokenise the CSS colours** into `--row-*` / `--status-*` custom properties. They were reverted to
  upstream's literals on purpose, to keep the rebase diff small. Nothing writes to them any more.
- **Do not change `productName`** — it sets the install directory *and* the `userData` path, so changing it
  orphans the existing `config.json` (session key, settings, usage history) rather than upgrading it.
- **Do not invent a pre-release label** (`-kt.1`, `-dev`) to mark a fork build — see §4; it causes a
  permanent, unclearable update banner. `version` is exactly upstream's base tag (currently `1.7.7`);
  mark builds in `artifactName` instead.

---

# Verification notes (how to check things here)

Upstream's `node --test "test/*.test.js"` covers `src/window-bounds.js` and the session starter only;
nothing this fork changes has a test. (`node --test test/` fails on Node 24 — it takes the directory as a
file.) What worked, and is worth reusing:

- **`node tools/cdp-drive.mjs --launch`** — drives the app over CDP (`Runtime.evaluate` +
  `Page.captureScreenshot`), screenshotting the window directly rather than hunting a full-screen grab. **It
  shows the widget on screen, always on top and focused** — ask the user before running it (2026-10-12: a
  keypress landed on "Log in" and opened the login window). It backs up
  `%APPDATA%\claude-usage-widget\config.json` before the run and restores it in a `finally` (Ctrl-C
  included), because running the app rewrites that file and it holds the session key and the usage history.
  Exit code is 1 on a failed probe or a renderer error, so it can gate a script.
- `--profile cdp` uses `main.js`'s profile isolation instead of the backup: a throwaway instance that never
  touches the real settings, at the cost of having no session key, so it shows the logged-out state. Use it
  for a pure smoke test; use the plain `--launch` when the check needs real usage data.
- `--expr '<js>'` adds a custom probe alongside the built-in one; `--help` prints the rest. It is
  dependency-free (Node's global `WebSocket`, so **Node ≥ 22**) and kept out of the packaged app by
  `build.files`.
- **Restart the app between renderer edits** — reloading the page does not reliably pick up `app.js` /
  `styles.css` changes.
- Electron swallows `--debug`; use `DEBUG_LOG=1` (or `--debug-log`). Most of upstream's own debug lines go only
  to the log file under `<userData>\logs\` (`profiles\<name>\logs\` for a profile), not to stdout.
- Heights: measure in the running app (see §1). `node --check` will not catch a temporal-dead-zone error, and
  static greps will not catch a missing HTML attribute (see §2).
