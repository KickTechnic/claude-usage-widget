// Normal view: Density x Fable x Resets At x expanded. Each case must fit the window (lesson §1: the last
// element's real bottom against the viewport, never scrollHeight) with measuredWidth() returning a number.
//   node tools/offscreen-drive.mjs tools/probes/layout.js
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString();
  const base = {
    five_hour: { utilization: 41, resets_at: iso(2) },
    seven_day: { utilization: 63, resets_at: iso(80) },
    seven_day_sonnet: { utilization: 12, resets_at: iso(80) },
    extra_usage: { is_enabled: true, utilization: 35, used_cents: 1750, limit_cents: 5000, currency: 'USD', balance_cents: 3250 },
  };
  const withFable = { ...base, seven_day_fable: { utilization: 22, resets_at: iso(80) } };
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
          cases.push({ density, fable, resetsAt, expanded });
  const name = (c) => `${c.density} ${c.fable ? 'fable' : '-'} ${c.resetsAt ? 'resetsAt' : '-'} ${c.expanded ? 'expanded' : '-'}`;
  const byName = Object.fromEntries(cases.map((c) => [name(c), c]));
  globalThis.__probe = {
    cases: Object.keys(byName),
    run: async (n) => {
      const c = byName[n];
      document.getElementById('loginContainer').style.display = 'none';
      window._cachedSettings = { ...(window._cachedSettings || {}), density: c.density, showResetsAt: c.resetsAt };
      applyLayout({ density: c.density, showResetsAt: c.resetsAt });
      setExpanded(c.expanded);
      updateUI(c.fable ? withFable : base);
      await sleep(150);
      resizeWidget(); // second pass: measuredWidth() reads the grid laid out by the first
    },
    measure: () => {
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
      return { bottom: Math.ceil(bottom), right: Math.ceil(right), innerW: innerWidth, innerH: innerHeight,
        note: `measuredWidth=${width} overflowingRows=${overflowing}`, overflowing: overflowing || !Number.isFinite(width) };
    },
  };
  return true;
})()
