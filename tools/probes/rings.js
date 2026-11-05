// Elapsed-ring staging: each mode must paint the staged Session / Weekly rings as expected, and the Monthly
// Spend fill must stay deep orange. Session is set 80% elapsed and Weekly 95%, so both are past the default
// warn (20%) and soon (40%) thresholds.
//   node tools/offscreen-drive.mjs tools/probes/rings.js
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString();
  const data = {
    five_hour: { utilization: 41, resets_at: iso(1) },        // 4h of 5h elapsed = 80%
    seven_day: { utilization: 63, resets_at: iso(168 * 0.05) }, // 95% elapsed
    seven_day_fable: { utilization: 22, resets_at: iso(80) },
    extra_usage: { is_enabled: true, utilization: 35, used_cents: 1750, limit_cents: 5000, currency: 'USD', balance_cents: 3250 },
  };
  const BASE_SESSION = 'rgb(139, 92, 246)'; // .timer-progress, #8b5cf6
  const BASE_WEEKLY = 'rgb(59, 130, 246)';  // .timer-progress.weekly, #3b82f6
  const ORANGE = 'rgb(234, 88, 12)';
  const seen = {};
  let current = null;
  globalThis.__probe = {
    cases: ['original', 'lighten', 'darken', 'off'],
    run: async (mode) => {
      current = mode;
      document.getElementById('loginContainer').style.display = 'none';
      isExpanded = true;
      elements.expandArrow.classList.add('expanded');
      elements.expandSection.style.display = 'block';
      window._cachedSettings = { ...(window._cachedSettings || {}), elapsedColorMode: mode };
      updateUI(data);
      applyElapsedRingColors({ elapsedColorMode: mode });
      await sleep(150);
      resizeWidget();
    },
    measure: () => {
      const stroke = (el) => getComputedStyle(el).stroke;
      const s = stroke(elements.sessionTimer), w = stroke(elements.weeklyTimer), f = stroke(elements.fableTimer);
      const fill = document.querySelector('.spend-card .progress-fill.extra');
      const bg = fill ? getComputedStyle(fill).backgroundImage + ' ' + getComputedStyle(fill).backgroundColor : 'none';
      seen[current] = s;
      const problems = [];
      if (current === 'off' && (s !== BASE_SESSION || w !== BASE_WEEKLY)) problems.push('off must paint the base colour');
      if (current !== 'off' && (s === BASE_SESSION || w === BASE_WEEKLY)) problems.push('staged ring kept its base colour');
      if (current === 'darken' && seen.lighten && s === seen.lighten) problems.push('darken equals lighten');
      if (!bg.includes(ORANGE)) problems.push('spend fill not orange');
      const root = document.getElementById('mainContent');
      let bottom = 0, right = 0;
      for (const el of root.querySelectorAll('*')) {
        if (!el.offsetParent) continue;
        const r = el.getBoundingClientRect();
        if (r.height === 0) continue;
        bottom = Math.max(bottom, r.bottom); right = Math.max(right, r.right);
      }
      return { bottom: Math.ceil(bottom), right: Math.ceil(right), innerW: innerWidth, innerH: innerHeight,
        overflowing: problems.length > 0,
        note: `session=${s} weekly=${w} fable=${f} spend=${fill ? 'orange:' + bg.includes(ORANGE) : 'missing'} ${problems.join('; ')}` };
    },
  };
  return true;
})()
