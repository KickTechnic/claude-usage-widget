---
paths:
  - "src/renderer/styles.css"
  - "src/renderer/app.js"
---

# Elapsed-ring colours

## §3 — `RING_BASE_COLORS` mirrors the `.timer-progress.*` rules by hand. Change both.

`src/renderer/styles.css` paints each ring's identity colour:

```css
.timer-progress          { stroke: #8b5cf6; }   /* Session — no class */
.timer-progress.weekly   { stroke: #3b82f6; }
.timer-progress.fable    { stroke: #d946ef; }
/* extra, opus, sonnet, cowork, design, oauth, scoped … */
```

`src/renderer/app.js` restates every one of those in `RING_BASE_COLORS` (plus `RING_BASE_SESSION` for the
bare rule). **Editing a stroke in the CSS without editing the table leaves the Lighten/Darken staging
deriving from the old colour** — the ring's base and its two staged shades come from different hues, which
reads as a rendering bug rather than a stale constant.

**Why the duplication is deliberate:** the staging engine cannot read the colour back off the element.
`getComputedStyle(ring).stroke` returns whatever the ring is painted *right now*, which in Lighten/Darken is
already a derived colour — so each refresh would shift it again and the colour would drift away on every
repaint. Looking the base up from a table is what makes the derivation idempotent.

**Check it mechanically** rather than by eye — extract both sides and compare:

```bash
node -e "const f=require('fs'),c=f.readFileSync('src/renderer/styles.css','utf8'),j=f.readFileSync('src/renderer/app.js','utf8');const m={};for(const x of c.matchAll(/\.timer-progress\.([a-z-]+)\s*\{[^}]*?stroke:\s*(#[0-9a-f]{6})/gi))m[x[1]]=x[2].toLowerCase();const t=/const RING_BASE_COLORS = \{([\s\S]*?)\};/.exec(j)[1];for(const x of t.matchAll(/(\w+):\s*'(#[0-9a-f]{6})'/gi))console.log((m[x[1]]===x[2].toLowerCase()?'ok  ':'MISMATCH ')+x[1]+' css='+m[x[1]]+' js='+x[2])"
```

Note `.timer-progress.extra` currently matches no element — Monthly Spend is the only user of the `extra`
class and `buildExtraRows()` gives that row a bar and a dollar figure but no countdown ring. It is kept in
step anyway so the table stays a faithful mirror.

(Incident: `.claude/memory/Lessons_Learned.md` §3.)
