# Lessons Learned

The **incident** behind each numbered lesson — what went wrong, why, and how it was found. The **rule** lives
in `.claude/rules/`; the **trigger** in the root `CLAUDE.md`. Three different contents, not three copies.

IDs are stable and never renumbered. A retired lesson is condensed in place to a dated one-line marker.

---

## §1 — The panel "fits" check that cannot fail

**When:** carried in from the sessions that built the compact layout; re-confirmed 2026-08-11.

Window and panel heights in this app are hand-measured constants. Four separate times a height was set by
reasoning about it — from row counts, from font sizes, from the previous value — and four times it was wrong:
once by 100px, once by 11px at every density, once by 8px that a commit message declared verified, and once
by a 6px footer clearance that was too small to trust.

What made it survive so long is that the obvious check reports success. `.settings-rows` and the widget
content column are `flex: 1` children: they **grow past the window** rather than overflowing inside it, so
`scrollHeight === clientHeight` is true whether the content fits or not. On 2026-08-11 the panel was measured
genuinely correct at 365px and the naive check returned `true` — the same answer it gives when the bottom row
is off-screen. It carries no information at all.

The measurement that works is the last element's `getBoundingClientRect().bottom` against
`window.innerHeight`, taken in the running app.

---

## §2 — A dropped feature owned an id the kept feature needed

**When:** 2026-08-11, porting a subset of `feature/custom-colours` onto upstream v1.7.6.

The port kept the layout work and dropped the per-row colour configuration. `measuredWidth()` — part of the
layout work — reads the resolved grid tracks off `elements.sessionSection` to decide how wide the window
should be. But `id="sessionSection"` had been added to `index.html` by the **colour** work, so that a row
could be given its own elapsed-ring custom properties. Dropping the colour work removed the id; the layout
work's dependency on it went with it, unnoticed.

The result was silent. `measuredWidth()` legitimately returns `undefined` before the row is laid out (login
screen, first paint) and `main.js` is written to tolerate that: `width || getNormalWidth()` falls back to the
stored width and the remember branch is guarded by `Number.isFinite`. An always-undefined measurement is
therefore indistinguishable from a not-ready-yet one. No exception, no console output, plausible-looking
window — the widget simply stayed at one stored width (390px) across every density and both Resets At
settings.

**How it was found:** only by running the app and comparing `measuredWidth()` against `innerWidth`. Three
static passes had already gone over the same code and reported clean — a grep for dropped colour identifiers,
a check that every new HTML id was wired into `app.js`, and `node --check`. All three were looking for **JS
symbols**. The missing thing was an **HTML attribute**, which none of them modelled.

A second fault surfaced in the same run: `currentDensity()` read `window._cachedSettings.density` while
`applyLayout()` wrote a class onto `<body>`. Two sources for one fact, so they diverged the moment the Density
control was changed live — the rows repainted at the new density while the height maths still sized for the
old one. Normal use masked it, because the Settings panel is open at its own height while the values disagree
and the cache is refreshed on Done before the widget resizes back. Masked is not fixed.

---

## §3 — Deriving a colour from the element you are about to recolour

**When:** 2026-08-11, building the elapsed-ring staging modes.

Lighten/Darken derive each ring's staged colours from that ring's own base colour. The natural implementation
reads the base back off the element with `getComputedStyle(ring).stroke` — and it is wrong, because by the
time the second repaint happens the element is already painted a *derived* colour. Each pass would shift
from the previous result rather than from the base, so the ring would drift further from its identity colour
on every refresh.

Looking the base up from a constant table keyed by the ring's identity class makes the derivation idempotent.
The cost is a hand-maintained mirror of the `.timer-progress.*` rules in `styles.css`, which is a real
coupling and is why §3's rule exists. It is checkable by script in a few seconds, which is what makes the
trade acceptable.

---

## §4 — A fork build cannot mark itself with a pre-release version

**When:** 2026-08-11, building the first fork installer.

The obvious way to distinguish a personal build from upstream's release is a version like `1.7.6-kt.1`. It
does not work here. `compareVersions()` in `main.js` ranks a plain release above any pre-release of the same
number, so upstream's released `1.7.6` reads as *newer* than `1.7.6-kt.1` and the widget shows a permanent
"update available: 1.7.6" banner it can never clear. A non-`dev` pre-release label additionally triggers a
second GitHub API request for the pre-release list on every check.

Numbering *above* upstream instead trades one bug for a worse one: `1.7.7` suppresses the banner for
upstream's real 1.7.7 — the only release actually worth being told about.

The version has to stay equal to the upstream release the fork is based on; fork identity belongs in the
artifact filename, which nothing compares.

**Found by reading the comparison code before choosing**, not by shipping and noticing. Worth repeating: the
update logic is ~40 lines in `main.js` and reading it cost less than one bad build.

## §5 — The installed app silently blocks a dev instance

**When:** 2026-09-02, verifying the session-context panel.

`node tools/cdp-drive.mjs --launch` stopped working mid-session: exit code 1, `no CDP page target — the app
did not start`. It had worked twice half an hour earlier, and the only thing that had changed since was the
feature being built, so the obvious reading was that the new code broke startup.

It had not. Running Electron directly gave **exit code 0, empty stdout, empty stderr** — a clean quit. The
cause was `requestSingleInstanceLock()` at the bottom of `main.js`: the installed build had been started in
the meantime and held the lock, so the repo instance called `app.quit()` before doing anything.

Three things made it read as a code fault rather than an environment one. The exit code says **success**.
Nothing is printed, so there is no string to search for. And the driver still saw a live DevTools endpoint —
Electron gets far enough to open the browser-level debugger before quitting — so `/json/list` answered with a
browser target and no page, which looks exactly like a renderer that failed to load.

Cost about ten minutes, all of it spent re-reading correct code. `Get-Process -Name Claude-Usage-Widget`
would have ended it in one command.

The follow-on was smaller but worth recording: `--profile cdp` gets a dev instance running alongside the
installed app, but it cannot be made to log in. Copying the real `config.json` into the profile fails at
`safeStorage.decryptString` — the DPAPI blob belongs to the installed app — so the copy was deleted again
rather than left lying around holding a session key. Verification was restructured to inject a usage payload
into `updateUI()` instead, which covered everything except live account data; that last check waited until
the installed app was closed.
