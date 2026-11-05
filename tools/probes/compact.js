// Compact mode: five_hour {present, null} x Fable {present, absent}, the spend row open, and the Session row
// reappearing. Each case asserts the exact window height and the Session row's visibility.
//   node tools/offscreen-drive.mjs tools/probes/compact.js
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString();
  const mk = ({ session, fable }) => {
    const d = {
      five_hour: session ? { utilization: 41, resets_at: iso(2) } : null,
      seven_day: { utilization: 63, resets_at: iso(80) },
      extra_usage: { is_enabled: true, utilization: 35, used_cents: 1750, limit_cents: 5000, currency: 'USD', balance_cents: 3250 },
    };
    if (fable) d.seven_day_fable = { utilization: 22, resets_at: iso(80) };
    return d;
  };
  // main sizes compact mode from its own store, not from the renderer's data.
  const store = (set) => `(() => { const req = process.mainModule.constructor.createRequire(process.cwd() + '/main.js'); const s = new (req('electron-store'))(); ${set}; return true; })()`;
  const cases = {
    'session fable':              { session: true,  fable: true,  spend: false, expect: 136 },
    'session -':                  { session: true,  fable: false, spend: false, expect: 108 },
    'nosession fable':            { session: false, fable: true,  spend: false, expect: 108 },
    'nosession -':                { session: false, fable: false, spend: false, expect: 80 },
    'nosession - spendOpen':      { session: false, fable: false, spend: true,  expect: 108 },
    'nosession fable spendOpen':  { session: false, fable: true,  spend: true,  expect: 136 },
    'session - (reappears)':      { session: true,  fable: false, spend: false, expect: 108 },
  };
  const vis = (el) => el && el.offsetParent !== null && getComputedStyle(el).display !== 'none';
  let current = null;
  globalThis.__probe = {
    cases: Object.keys(cases),
    prepare: (n) => {
      const c = cases[n];
      return store(`s.set('latestUsageData', ${JSON.stringify(mk(c))}); s.set('settings.compactSpendOpen', ${c.spend})`);
    },
    run: async (n) => {
      const c = cases[n]; current = c;
      document.getElementById('loginContainer').style.display = 'none';
      compactSpendOpen = c.spend;
      applyCompactSpendRow();
      updateUI(mk(c));
      if (!isCompactMode) applyCompactMode(true); else window.electronAPI.setCompactMode(true);
      await sleep(300);
    },
    measure: () => {
      const root = elements.compactContent;
      let bottom = 0, right = 0;
      for (const el of root.querySelectorAll('*')) {
        if (!el.offsetParent) continue;
        const r = el.getBoundingClientRect();
        if (r.height === 0 || r.width === 0) continue;
        bottom = Math.max(bottom, r.bottom); right = Math.max(right, r.right);
      }
      const t = elements.compactSpendToggle.getBoundingClientRect();
      const x = elements.compactExpandBtn.getBoundingClientRect();
      const bad = innerHeight !== current.expect || vis(elements.compactSessionRow) !== current.session;
      return { bottom: Math.ceil(bottom), right: Math.ceil(right), innerW: innerWidth, innerH: innerHeight, overflowing: bad,
        note: `expect=${current.expect} clearance=${Math.floor(innerHeight - bottom)} session=${vis(elements.compactSessionRow)} fable=${vis(elements.compactFableRow)} spend=${vis(elements.compactSpendRow)} toggle=${Math.round(t.top)}-${Math.round(t.bottom)} expandBtn=${Math.round(x.top)}-${Math.round(x.bottom)}` };
    },
  };
  return true;
})()
