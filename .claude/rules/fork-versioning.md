---
paths:
  - "package.json"
---

# Fork versioning

## §4 — `version` is load-bearing for the update banner. Keep it at the upstream base version.

`app.getVersion()` reads `package.json`'s `version`, and the `check-for-update` handler in `main.js` compares
it against upstream's latest GitHub release. `compareVersions()` ranks a **plain release above any
pre-release of the same number**:

```js
if (a.preRelease === null && b.preRelease === null) return 0;
if (a.preRelease === null) return 1;     // 1.7.6  >  1.7.6-anything
```

An upstream pre-release *base* is fine. On `1.7.7-rc.2` the banner fires only for a release newer than
local: upstream's stable `1.7.6` is older and its newest pre-release `1.7.7-rc.2` is equal, so it stays clear
until `rc.3` or stable `1.7.7` appears — exactly the signal to rebase. What breaks is a label the *fork*
invents. The two tempting ways to mark a fork build both misbehave:

- **`1.7.6-kt.1`, `1.7.6-dev`, any `1.7.6-<label>`** — upstream's released `1.7.6` compares as newer, giving a
  permanent "update available: 1.7.6" banner that can never clear. A non-`dev` pre-release label also makes
  every check fire a second GitHub request for the pre-release list.
- **Numbering above upstream (`1.7.7`, `1.8.0`)** — suppresses the banner for upstream's *actual* 1.7.7, the
  one release worth hearing about.

**Keep `version` equal to the upstream tag this fork is based on.** Mark fork builds in
`build.nsis.artifactName` / `build.portable.artifactName` instead — currently a `-kt-` infix, giving
`Claude-Usage-Widget-1.7.7-rc.2-kt-win-Setup.exe`. When rebasing onto a newer upstream tag, move `version` to
match it.

**Do not change `productName`.** It sets both the install directory and the Electron `userData` path, so
changing it orphans the existing `%APPDATA%\claude-usage-widget\config.json` — session key, settings and
usage history — instead of upgrading it.

(Incident: `.claude/memory/Lessons_Learned.md` §4.)
