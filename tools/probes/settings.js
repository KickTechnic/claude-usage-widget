// Settings panel opened from the widget and from compact mode, live Density / Resets At changes, and the
// window returning to the right view and size after Save.
//   node tools/offscreen-drive.mjs tools/probes/settings.js
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
  // main sizes compact mode (and first paint) from its own store, not from the renderer's data.
  const store = (set) => `(() => { const req = process.mainModule.constructor.createRequire(process.cwd() + '/main.js'); const s = new (req('electron-store'))(); ${set}; return true; })()`;
  const seed = (data) => store(`s.set('latestUsageData', ${JSON.stringify(data)})`);
  const vis = (el) => el && el.offsetParent !== null && getComputedStyle(el).display !== 'none';
  const extent = (root) => {
    let bottom = 0, right = 0;
    for (const el of root.querySelectorAll('*')) {
      if (!el.offsetParent) continue;
      const r = el.getBoundingClientRect();
      if (r.height === 0 || r.width === 0) continue;
      bottom = Math.max(bottom, r.bottom);
      right = Math.max(right, r.right);
    }
    return { bottom: Math.ceil(bottom), right: Math.ceil(right) };
  };
  const steps = {
    'widget tight fable': async () => {
      document.getElementById('loginContainer').style.display = 'none';
      const s = await window.electronAPI.getSettings();
      window._cachedSettings = { ...s, density: 'tight', showResetsAt: false };
      applyLayout({ density: 'tight', showResetsAt: false });
      updateUI(withFable); await sleep(150); resizeWidget();
    },
    'settings open from widget': async () => { elements.settingsBtn.click(); await sleep(400); },
    'settings live comfortable+resetsAt': async () => {
      elements.density.value = 'comfortable'; elements.density.dispatchEvent(new Event('change'));
      elements.showResetsAtToggle.checked = true; elements.showResetsAtToggle.dispatchEvent(new Event('change'));
      await sleep(200);
    },
    'settings saved -> widget': async () => { elements.closeSettingsBtn.click(); await sleep(800); updateUI(withFable); await sleep(150); resizeWidget(); },
    'compact fable': async () => { elements.compactCollapseBtn.click(); await sleep(500); updateUI(withFable); await sleep(200); },
    'compact no fable': async () => { updateUI(base); window.electronAPI.setCompactMode(true); await sleep(300); },
    'settings open from compact': async () => { elements.settingsBtn.click(); await sleep(600); },
    'settings saved -> compact': async () => { elements.closeSettingsBtn.click(); await sleep(900); },
  };
  globalThis.__probe = {
    cases: Object.keys(steps),
    // SessionStarter.save() refuses without an organization, so Save can't close Settings logged out.
    prepare: (n) => (n === 'widget tight fable' ? store(`s.set('organizationId', 'cdp-test-org')`)
      : n === 'compact fable' ? seed(withFable) : n === 'compact no fable' ? seed(base) : null),
    run: (n) => steps[n](),
    measure: async () => {
      const s = await window.electronAPI.getSettings();
      const settingsOpen = elements.settingsOverlay.style.display === 'flex';
      let view, ext, note = '';
      if (settingsOpen) {
        view = 'settings';
        const fb = elements.settingsOverlay.querySelector('.settings-footer').getBoundingClientRect().bottom;
        ext = extent(elements.settingsOverlay);
        const st = document.getElementById('sessionStartStatus');
        note = `footerBottom=${Math.ceil(fb)} clearance=${Math.floor(innerHeight - fb)} starterStatus=${st.hidden ? '-' : JSON.stringify(st.textContent)}`;
      } else if (vis(elements.compactContent)) {
        view = 'compact'; ext = extent(elements.compactContent);
        note = `fableRow=${elements.compactFableRow.style.display !== 'none'}`;
      } else {
        view = 'widget'; ext = extent(elements.mainContent);
        note = `measuredWidth=${measuredWidth()}`;
      }
      return { ...ext, innerW: innerWidth, innerH: innerHeight,
        note: `[${view}] ${note} stored: density=${s.density} resetsAt=${s.showResetsAt} compact=${s.compactMode}` };
    },
  };
  return true;
})()
