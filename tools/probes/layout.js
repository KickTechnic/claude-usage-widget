// Normal view: Density x Fable x Resets At x expanded x five_hour {present, null} — 48 cases. Each case must
// fit the window (lesson §1: the last element's real bottom against the viewport, never scrollHeight) with
// measuredWidth() returning a number. Each no-session case is also checked against its session twin, which
// runs just before it: the window is exactly one primary row shorter, the bottom clearance and the width are
// unchanged, the Session row is hidden and the bar column's header reads "Used".
//   node tools/offscreen-drive.mjs tools/probes/layout.js
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString();
  const mk = ({ fable, session }) => {
    const d = {
      five_hour: session ? { utilization: 41, resets_at: iso(2) } : null,
      seven_day: { utilization: 63, resets_at: iso(80) },
      seven_day_sonnet: { utilization: 12, resets_at: iso(80) },
      extra_usage: { is_enabled: true, utilization: 35, used_cents: 1750, limit_cents: 5000, currency: 'USD', balance_cents: 3250 },
    };
    if (fable) d.seven_day_fable = { utilization: 22, resets_at: iso(80) };
    return d;
  };
  // Mirrors the expandToggle click handler minus its save + live fetch (a logged-out fetch drops to login).
  const setExpanded = (want) => {
    isExpanded = want;
    elements.expandArrow.classList.toggle('expanded', want);
    elements.expandSection.style.display = want ? 'block' : 'none';
  };
  const cases = [];
  for (const density of ['tight', 'compact', 'comfortable'])
    for (const fable of [false, true])
      for (const resetsAt of [false, true])
        for (const expanded of [false, true])
          for (const session of [true, false])
            cases.push({ density, fable, resetsAt, expanded, session });
  const name = (c) => `${c.density} ${c.fable ? 'fable' : '-'} ${c.resetsAt ? 'resetsAt' : '-'} ${c.expanded ? 'expanded' : '-'} ${c.session ? 'S' : 'noS'}`;
  const byName = Object.fromEntries(cases.map((c) => [name(c), c]));
  const results = {};
  let current = null;
  globalThis.__probe = {
    cases: Object.keys(byName),
    run: async (n) => {
      const c = byName[n]; current = n;
      document.getElementById('loginContainer').style.display = 'none';
      window._cachedSettings = { ...(window._cachedSettings || {}), density: c.density, showResetsAt: c.resetsAt };
      applyLayout({ density: c.density, showResetsAt: c.resetsAt });
      setExpanded(c.expanded);
      updateUI(mk(c));
      await sleep(150);
      resizeWidget(); // second pass: measuredWidth() reads the grid laid out by the first
    },
    measure: () => {
      const c = byName[current];
      const root = document.getElementById('mainContent');
      let bottom = 0, right = 0;
      for (const el of root.querySelectorAll('*')) {
        if (!el.offsetParent) continue;
        const r = el.getBoundingClientRect();
        if (r.height === 0) continue;
        bottom = Math.max(bottom, r.bottom);
        right = Math.max(right, r.right);
      }
      const overflowing = [...root.querySelectorAll('.usage-section, .spend-card')].filter((el) => el.offsetParent && el.scrollWidth > el.clientWidth + 1).length;
      const width = measuredWidth();
      const clearance = Math.floor(innerHeight - bottom);
      const sessionShown = elements.sessionSection.offsetParent !== null;
      const header = elements.usedColHeader.textContent;
      results[current] = { innerH: innerHeight, clearance, width };
      const problems = [];
      if (overflowing) problems.push(`${overflowing} rows overflow`);
      if (!Number.isFinite(width)) problems.push('measuredWidth not a number');
      if (sessionShown !== c.session) problems.push(`session row shown=${sessionShown}`);
      if (header !== (c.session ? 'Session Used' : 'Used')) problems.push(`header=${JSON.stringify(header)}`);
      let twinNote = '';
      if (!c.session) {
        const t = results[name({ ...c, session: true })];
        const row = PRIMARY_ROW_HEIGHTS[c.density];
        if (!t) problems.push('twin missing');
        else {
          twinNote = `twin ${t.innerH}-${row}=${t.innerH - row}`;
          if (innerHeight !== t.innerH - row) problems.push(`height ${innerHeight} != twin-row ${t.innerH - row}`);
          if (clearance !== t.clearance) problems.push(`clearance ${clearance} != twin ${t.clearance}`);
          if (width !== t.width) problems.push(`width ${width} != twin ${t.width}`);
        }
      }
      return { bottom: Math.ceil(bottom), right: Math.ceil(right), innerW: innerWidth, innerH: innerHeight,
        overflowing: problems.length > 0,
        note: `w=${width} clear=${clearance} ${twinNote} ${problems.join('; ')}` };
    },
  };
  return true;
})()
