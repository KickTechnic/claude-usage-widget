// main.js getNormalHeight() against the renderer's resizeWidget(): Density x Fable x five_hour {present, null}.
// Per case: the renderer sizes the normal view and its height is recorded; then the window goes to compact
// size and back through set-compact-mode alone, so main sizes it from its own store with no renderer resize.
// The two heights must agree (§1: main.js and app.js are twins).
//   node tools/offscreen-drive.mjs tools/probes/normal-main.js
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString();
  const mk = ({ fable, session }) => {
    const d = {
      five_hour: session ? { utilization: 41, resets_at: iso(2) } : null,
      seven_day: { utilization: 63, resets_at: iso(80) },
    };
    if (fable) d.seven_day_fable = { utilization: 22, resets_at: iso(80) };
    return d;
  };
  const store = (set) => `(() => { const req = process.mainModule.constructor.createRequire(process.cwd() + '/main.js'); const s = new (req('electron-store'))(); ${set}; return true; })()`;
  const cases = [];
  for (const density of ['tight', 'compact', 'comfortable'])
    for (const fable of [false, true])
      for (const session of [true, false])
        cases.push({ density, fable, session });
  const name = (c) => `${c.density} ${c.fable ? 'fable' : '-'} ${c.session ? 'S' : 'noS'}`;
  const byName = Object.fromEntries(cases.map((c) => [name(c), c]));
  let current = null, rendererH = null, compactH = null;
  globalThis.__probe = {
    cases: Object.keys(byName),
    prepare: (n) => {
      const c = byName[n];
      return store(`s.set('latestUsageData', ${JSON.stringify(mk(c))}); s.set('settings.density', ${JSON.stringify(c.density)})`);
    },
    run: async (n) => {
      const c = byName[n]; current = c;
      document.getElementById('loginContainer').style.display = 'none';
      window._cachedSettings = { ...(window._cachedSettings || {}), density: c.density, showResetsAt: false };
      applyLayout({ density: c.density, showResetsAt: false });
      isExpanded = false;
      elements.expandSection.style.display = 'none';
      updateUI(mk(c));
      await sleep(150);
      resizeWidget();
      await sleep(400);
      rendererH = innerHeight;
      window.electronAPI.setCompactMode(true);   // main only — the renderer stays in normal mode
      await sleep(400);
      compactH = innerHeight;
      window.electronAPI.setCompactMode(false);  // main sizes from getNormalHeight()
      await sleep(400);
    },
    measure: () => {
      const problems = [];
      if (compactH === rendererH) problems.push('window never left normal size — the round trip proved nothing');
      if (innerHeight !== rendererH) problems.push(`main ${innerHeight} != renderer ${rendererH}`);
      return { bottom: 0, right: 0, innerW: innerWidth, innerH: innerHeight, overflowing: problems.length > 0,
        note: `renderer=${rendererH} viaCompact=${compactH} main=${innerHeight} ${problems.join('; ')}` };
    },
  };
  return true;
})()
