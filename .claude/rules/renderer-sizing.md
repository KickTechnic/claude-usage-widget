---
paths:
  - "src/renderer/**"
  - "main.js"
---

# Window and panel sizing

## §1 — Measure heights in the running app. Never derive them, and never trust the overflow check.

Every window/panel height in this app is a hand-measured constant: `SETTINGS_HEIGHT` and `COLLAPSED_HEIGHTS` /
`FABLE_ROW_HEIGHTS` in `src/renderer/app.js`, mirrored by `COLLAPSED_HEIGHTS` / `FABLE_ROW_HEIGHTS` /
`COMPACT_HEIGHT` in `main.js`. Adding a row, changing a font size, or moving the title bar invalidates them.

**The naive check does not work here.** `.settings-rows` and the widget content column are `flex: 1` children,
so they **grow past the window** instead of overflowing it. `scrollHeight === clientHeight` therefore reports
"fits" while the bottom row sits below the window edge. Confirmed again on 2026-08-11: the panel measured
correct at exactly 365px *and* the naive check returned `true` — it returns `true` either way, so it can
never distinguish the two cases.

**The check that works** is the last element's real bottom edge against the viewport:

```js
el.getBoundingClientRect().bottom <= window.innerHeight
```

For the Settings panel measure the **footer**, not the last row — the footer sits below it. Aim for a few px
of clearance rather than exactly 0; the footer box legitimately ends flush at the window edge while its
buttons keep ~7px inside it.

Anything in `main.js` must stay in step with its `app.js` twin — the comments on both say so; believe them.

## §2 — A renderer id or class may belong to a feature you did not port.

`measuredWidth()` reads the resolved grid tracks off `elements.sessionSection` to size the window. That id was
introduced on `index.html` by the **per-row colour** work — dropped from this fork — while the **layout** work
took a dependency on it. Porting one without the other left `elements.sessionSection` undefined.

**It failed silently, by construction.** `measuredWidth()` returns `undefined` when the row is not laid out
yet, which is legitimate at first paint and on the login screen, and `main.js` is written to cope:
`width || getNormalWidth()` falls back, and the remember branch is guarded by `Number.isFinite`. So an
always-undefined measurement is indistinguishable from a not-ready-yet one. No error, no warning — the widget
just kept one stored width forever.

**So:** when you use a DOM id or class from JS, confirm the markup that defines it is actually present, and
check *which* change introduced it (`git log -S '<the-id>' -- src/renderer/index.html`). Three static audits —
symbol greps, a dropped-identifier sweep and `node --check` — all passed over this, because the missing thing
was an **HTML attribute**, not a JS symbol. Only running the app found it.

(Incidents: `.claude/memory/Lessons_Learned.md` §1, §2.)
