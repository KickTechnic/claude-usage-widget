// Application state
let credentials = null;
let updateInterval = null;
let countdownInterval = null;
let latestUsageData = null;
let isExpanded = false;
let isCompactMode = false;
let compactSpendOpen = false; // spend row toggled open within compact mode
let _settingsOpenedFromCompact = false;
let usageChart = null;
let graphVisible = false;
let graphWasVisible = false; // preserves graph state across compact mode toggle
let appInitializing = true;  // suppresses _saveViewState during startup restore
let isFetching = false;       // in-flight guard — prevents overlapping fetchUsageData calls
const UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes
// Collapsed window height per density — title bar, headers, the two always-
// present rows and the content padding. The Fable row and the expansion are
// added on top by resizeWidget().
//
// MEASURED in the running app, not derived. Getting these by arithmetic has
// gone wrong repeatedly on this branch, and the failure is silent: the panels
// are flex:1 children that grow past the window rather than overflowing, so
// scrollHeight === clientHeight even when the bottom row is below the edge.
// The check that works is the last element's bottom against innerHeight.
// Must match COLLAPSED_HEIGHTS in main.js.
const COLLAPSED_HEIGHTS = {
    comfortable: 117,
    compact: 106,
    tight: 94
};
const WIDGET_ROW_HEIGHT = 30;
// Height the optional Fable primary row adds: --row-height plus --row-gap, so
// it tracks density. Must match FABLE_ROW_HEIGHTS in main.js.
const FABLE_ROW_HEIGHTS = {
    comfortable: 34,
    compact: 29,
    tight: 23
};

// The density currently PAINTED, which is what the height maths has to size
// against. Written only by applyLayout(), so it cannot disagree with the body
// class that actually drives the CSS — reading it back out of the stored
// settings instead would go stale the moment the Density control is changed
// live, before anything is saved.
// Left null rather than seeded with DEFAULT_DENSITY, which is declared further
// down the file and would be in the temporal dead zone at this point.
let activeDensity = null;
function currentDensity() {
    return activeDensity ?? DEFAULT_DENSITY;
}
const GRAPH_HEIGHT = 232;

// Elapsed-time ring thresholds (session/weekly/extra-row countdown circles).
// Deliberately hardcoded and independent from the user-configurable
// warnThreshold/dangerThreshold settings below, which describe *usage volume*
// getting close to a limit. Time elapsing toward a reset is a different,
// unrelated metric — nearing 100% elapsed just means the window is about to
// refresh, which is a neutral-to-good thing, not a warning. Reusing the usage
// thresholds/colors here was accidental coupling, not a deliberate choice.
const ELAPSED_AMBER_THRESHOLD = 75;
const ELAPSED_GREEN_THRESHOLD = 90;

// Settings-panel window height. .settings-rows is a centred flex column with
// no scrollbar, so this has to cover the rows outright — re-measure it every
// time a row is added. 318 covered six rows; the Density / Show Resets At row
// makes seven and the Elapsed rings row eight.
//
// Measure it in the running app, never derive it. .settings-rows is a flex:1
// child, so it grows past the window rather than reporting an overflow —
// scrollHeight and clientHeight agree even when the bottom row sits below the
// window edge. The check that works is the last row's getBoundingClientRect()
// bottom against innerHeight.
//
// 365 -> 411 when the session-context row (toggle + window size, plus its hint
// line) was added, measured that way. The naive check was run at the same time
// and reported "fits" — scrollHeight and clientHeight both 312 — while the
// footer sat 46px below the window edge, which is the whole reason the comment
// above exists.
const SETTINGS_HEIGHT = 411;

// Width the overlays are laid out at. The widget itself narrows when the
// Resets At column is hidden, but Settings and the login view are fixed
// layouts and would be cramped at that width, so they ask for this explicitly
// and the main process only computes a width when none is given.
// Must match PANEL_WIDTH in main.js.
const PANEL_WIDTH = window.electronAPI.platform === 'darwin' ? 590 : 560;

// Layout density. Drives the font sizes and row box via body classes that
// override the metrics block in styles.css; 'comfortable' adds no class, so
// it is exactly what :root declares. Must match DEFAULT_DENSITY in main.js.
const DENSITY_MODES = ['comfortable', 'compact', 'tight'];
const DEFAULT_DENSITY = 'tight';

// Off by default: "Resets In" already gives the countdown, and hiding the
// column also narrows the window, since measuredWidth() reads the resulting
// layout. Must match DEFAULT_SHOW_RESETS_AT in main.js.
const DEFAULT_SHOW_RESETS_AT = false;

// Session-context panel — the three most recently used Claude Code sessions,
// beside the usage rows. Must match DEFAULT_SHOW_SESSION_CONTEXT /
// DEFAULT_SESSION_CONTEXT_WINDOW in main.js.
//
// The window is a setting rather than a constant because it is genuinely
// unknowable: a transcript records its model but not its context window, so a
// 1M-window session and a 200k one look identical on disk. 1M is the
// assumption; a 200k session about to compact therefore reads ~19%, not ~95%.
const DEFAULT_SHOW_SESSION_CONTEXT = true;
const DEFAULT_SESSION_CONTEXT_WINDOW = 1000000;

// Last successful scan, kept so a failed or slow refresh leaves the panel
// showing its previous numbers rather than emptying it — which would change
// the window size for a moment and make the widget jump.
let sessionContextRows = [];
let showSessionContext = DEFAULT_SHOW_SESSION_CONTEXT;
let sessionContextWindow = DEFAULT_SESSION_CONTEXT_WINDOW;

// How the elapsed rings stage through their two thresholds above.
//   original — the fixed amber/green pair, one pair for every ring. What this
//              app has always done; the literals live in styles.css.
//   lighten  — each ring stages through lighter shades of ITS OWN color
//   darken   — the same, toward black
//   off      — no staging at all; every ring keeps its base color throughout
//
// Defaults to 'lighten'. A window approaching its reset is good news — the
// limit is about to refresh — so staging it through a second, unrelated
// palette framed a routine, welcome event as an alarm. Lightening keeps the
// row's own hue, so the ring still says which row it belongs to while
// brightening as the reset nears. 'original' is one menu item away.
//
// Old stored values from the superseded branch ('custom'/'lighter'/'darker')
// simply fail this check and fall back to the default, which is what they
// would mostly have wanted anyway. No migration needed.
const ELAPSED_COLOR_MODES = ['original', 'lighten', 'darken', 'off'];
const DEFAULT_ELAPSED_MODE = 'lighten';

// How far to travel toward white/black, as a percentage of the distance
// REMAINING, for each of the two stages. Kept subtle by default: enough to
// read at a glance, not enough to shout.
const DEFAULT_ELAPSED_WARN_PERCENT = 20;
const DEFAULT_ELAPSED_SOON_PERCENT = 40;

// Base ring color per row, keyed by the identity class on the .timer-progress
// circle. Session has no class — it is what the bare .timer-progress rule
// paints — so it is the fallback rather than an entry.
//
// This table MIRRORS the .timer-progress.* rules in styles.css and has to be
// kept in step with them by hand. That coupling is the price of deriving the
// staged colors in JS: reading the computed stroke back off the element would
// return whatever the ring is painted right now, which in lighten/darken mode
// is already a derived color, so each refresh would compound the shift.
const RING_BASE_SESSION = '#8b5cf6';
const RING_BASE_COLORS = {
    weekly: '#3b82f6',
    fable: '#d946ef',
    extra: '#ea580c',
    opus: '#f59e0b',
    sonnet: '#f43f5e',
    cowork: '#06b6d4',
    design: '#92400e',
    oauth: '#f97316',
    scoped: '#64748b'
};

// Debug logging — only shows in DevTools (development mode).
// Regular users won't see verbose logs in production.
const DEBUG = (new URLSearchParams(window.location.search)).has('debug');
function debugLog(...args) {
  if (DEBUG) console.log('[Debug]', ...args);
}

// --- Elapsed ring staging -------------------------------------------------

function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// Move a color's lightness a percentage of the distance REMAINING to white or
// black, holding hue and saturation. Proportional rather than a fixed step, so
// a color already near the target barely moves and one far away moves a lot —
// which is what keeps the two stages distinguishable whatever the base is.
//
//   toward 'white': L + (100 - L) * pct/100
//   toward 'black': L - L * pct/100
//
// Deliberately unclamped beyond the 0..1 lightness range: at high percentages
// this can produce a ring with almost no contrast against the theme
// background. That is the specified behaviour, and the percentages are the
// user's dial for it.
function hslShift(hex, pct, toward = 'white') {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;
    const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }
    const target = toward === 'black' ? 0 : 1;
    const l2 = Math.min(1, Math.max(0, l + (target - l) * (pct / 100)));

    const hueToRgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    const q = l2 < 0.5 ? l2 * (1 + s) : l2 + s - l2 * s;
    const p = 2 * l2 - q;
    const toHex = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${toHex(hueToRgb(p, q, h + 1 / 3))}${toHex(hueToRgb(p, q, h))}${toHex(hueToRgb(p, q, h - 1 / 3))}`;
}

// Normalize a settings object into the staging values actually used, falling
// back to the defaults for anything missing or malformed. Single place that
// decides what the current mode is, so nothing downstream has to re-derive it.
function resolveElapsedPrefs(settings = {}) {
    const pct = (value, fallback) => {
        const n = Number(value);
        return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : fallback;
    };
    return {
        mode: ELAPSED_COLOR_MODES.includes(settings.elapsedColorMode)
            ? settings.elapsedColorMode
            : DEFAULT_ELAPSED_MODE,
        warnPercent: pct(settings.elapsedWarnPercent, DEFAULT_ELAPSED_WARN_PERCENT),
        soonPercent: pct(settings.elapsedSoonPercent, DEFAULT_ELAPSED_SOON_PERCENT)
    };
}

// The elapsed pair a given ring should use. null means "no override" — the
// literals in styles.css stand, which is exactly Original mode.
function elapsedPairFor(baseHex, prefs) {
    if (prefs.mode === 'original') return null;
    // Off: paint both stages the ring's own color, so the classes updateTimer()
    // adds have no visible effect. Cheaper and less brittle than teaching
    // updateTimer() to skip them.
    if (prefs.mode === 'off') return { warn: baseHex, soon: baseHex };
    const toward = prefs.mode === 'darken' ? 'black' : 'white';
    return {
        warn: hslShift(baseHex, prefs.warnPercent, toward),
        soon: hslShift(baseHex, prefs.soonPercent, toward)
    };
}

// A ring's own color, from the identity class it carries. Looked up rather
// than read back off the element — see the note on RING_BASE_COLORS.
function ringBaseColor(ring) {
    for (const cls of Object.keys(RING_BASE_COLORS)) {
        if (ring.classList.contains(cls)) return RING_BASE_COLORS[cls];
    }
    return RING_BASE_SESSION;
}

// Scope the elapsed pair per ring. Custom properties are set on the circle
// itself, which is also what carries the .elapsed-warn/.elapsed-soon classes,
// so the CSS rules read them straight off the same element.
//
// Must be re-run after buildExtraRows(), which replaces those rings wholesale.
function applyElapsedRingColors(settings = {}) {
    const prefs = resolveElapsedPrefs(settings);
    for (const ring of document.querySelectorAll('.timer-progress')) {
        const pair = elapsedPairFor(ringBaseColor(ring), prefs);
        if (!pair) {
            // Drop the override rather than leaving a stale one behind.
            ring.style.removeProperty('--elapsed-warn');
            ring.style.removeProperty('--elapsed-soon');
            continue;
        }
        ring.style.setProperty('--elapsed-warn', pair.warn);
        ring.style.setProperty('--elapsed-soon', pair.soon);
    }
    return prefs;
}

// DOM elements
const elements = {
    loadingContainer: document.getElementById('loadingContainer'),
    loginContainer: document.getElementById('loginContainer'),
    noUsageContainer: document.getElementById('noUsageContainer'),
    mainContent: document.getElementById('mainContent'),
    loginStep1: document.getElementById('loginStep1'),
    loginStep2: document.getElementById('loginStep2'),
    autoDetectBtn: document.getElementById('autoDetectBtn'),
    autoDetectError: document.getElementById('autoDetectError'),
    openBrowserLink: document.getElementById('openBrowserLink'),
    nextStepBtn: document.getElementById('nextStepBtn'),
    backStepBtn: document.getElementById('backStepBtn'),
    sessionKeyInput: document.getElementById('sessionKeyInput'),
    connectBtn: document.getElementById('connectBtn'),
    sessionKeyError: document.getElementById('sessionKeyError'),
    refreshBtn: document.getElementById('refreshBtn'),
    graphBtn: document.getElementById('graphBtn'),
    minimizeBtn: document.getElementById('minimizeBtn'),
    closeBtn: document.getElementById('closeBtn'),

    // The row element itself, not just its parts: measuredWidth() reads the
    // resolved grid tracks off it to work out how wide the window needs to be.
    sessionSection: document.getElementById('sessionSection'),
    sessionPercentage: document.getElementById('sessionPercentage'),
    sessionProgress: document.getElementById('sessionProgress'),
    sessionTimer: document.getElementById('sessionTimer'),
    sessionTimeText: document.getElementById('sessionTimeText'),

    weeklyPercentage: document.getElementById('weeklyPercentage'),
    weeklyProgress: document.getElementById('weeklyProgress'),
    weeklyTimer: document.getElementById('weeklyTimer'),
    weeklyTimeText: document.getElementById('weeklyTimeText'),
    weeklyResetsAt: document.getElementById('weeklyResetsAt'),

    fableSection: document.getElementById('fableSection'),
    fablePercentage: document.getElementById('fablePercentage'),
    fableProgress: document.getElementById('fableProgress'),
    fableTimer: document.getElementById('fableTimer'),
    fableTimeText: document.getElementById('fableTimeText'),
    fableResetsAt: document.getElementById('fableResetsAt'),

    sessionResetsAt: document.getElementById('sessionResetsAt'),

    expandToggle: document.getElementById('expandToggle'),
    expandArrow: document.getElementById('expandArrow'),
    expandSection: document.getElementById('expandSection'),
    extraRows: document.getElementById('extraRows'),
    contextPanel: document.getElementById('contextPanel'),
    contextRows: document.getElementById('contextRows'),
    showSessionContextToggle: document.getElementById('showSessionContextToggle'),
    sessionContextWindow: document.getElementById('sessionContextWindow'),
    graphSection: document.getElementById('graphSection'),
    usageChart: document.getElementById('usageChart'),

    settingsBtn: document.getElementById('settingsBtn'),
    settingsOverlay: document.getElementById('settingsOverlay'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    logoutBtn: document.getElementById('logoutBtn'),
    coffeeBtn: document.getElementById('coffeeBtn'),
    autoStartCol: document.getElementById('autoStartCol'),
    autoStartToggle: document.getElementById('autoStartToggle'),
    autoStartHint: document.getElementById('autoStartHint'),
    minimizeToTrayToggle: document.getElementById('minimizeToTrayToggle'),
    alwaysOnTopToggle: document.getElementById('alwaysOnTopToggle'),
    showTrayStatsToggle: document.getElementById('showTrayStatsToggle'),
    warnThreshold: document.getElementById('warnThreshold'),
    dangerThreshold: document.getElementById('dangerThreshold'),
    density: document.getElementById('density'),
    showResetsAtToggle: document.getElementById('showResetsAtToggle'),

    elapsedColorMode: document.getElementById('elapsedColorMode'),
    elapsedPercentCol: document.getElementById('elapsedPercentCol'),
    elapsedWarnPercent: document.getElementById('elapsedWarnPercent'),
    elapsedSoonPercent: document.getElementById('elapsedSoonPercent'),

    themeBtns: document.querySelectorAll('.theme-btn'),
    timeFormat: document.getElementById('timeFormat'),
    weeklyDateFormat: document.getElementById('weeklyDateFormat'),
    refreshInterval: document.getElementById('refreshInterval'),
    orgSelector: document.getElementById('orgSelector'),
    orgSelectorCol: document.getElementById('orgSelectorCol'),

    updateBanner: document.getElementById('updateBanner'),
    updateBannerText: document.getElementById('updateBannerText'),
    updateBannerDismiss: document.getElementById('updateBannerDismiss'),
    settingsVersionLabel: document.getElementById('settingsVersionLabel'),
    settingsUpdateLink: document.getElementById('settingsUpdateLink'),
    usageAlertsToggle: document.getElementById('usageAlertsToggle'),
    compactModeToggle: document.getElementById('compactModeToggle'),
    compactModeToggleCompact: document.getElementById('compactModeToggleCompact'),
    compactContent: document.getElementById('compactContent'),
    compactCollapseBtn: document.getElementById('compactCollapseBtn'),
    compactExpandBtn: document.getElementById('compactExpandBtn'),
    compactSessionFill: document.getElementById('compactSessionFill'),
    compactSessionPct: document.getElementById('compactSessionPct'),
    compactWeeklyFill: document.getElementById('compactWeeklyFill'),
    compactWeeklyPct: document.getElementById('compactWeeklyPct'),
    compactFableRow: document.getElementById('compactFableRow'),
    compactFableFill: document.getElementById('compactFableFill'),
    compactFablePct: document.getElementById('compactFablePct'),
    compactSpendToggle: document.getElementById('compactSpendToggle'),
    compactSpendArrow: document.getElementById('compactSpendArrow'),
    compactSpendRow: document.getElementById('compactSpendRow'),
    compactSpendFill: document.getElementById('compactSpendFill'),
    compactSpendPct: document.getElementById('compactSpendPct'),
    compactSettingsOverlay: document.getElementById('compactSettingsOverlay'),
    closeCompactSettingsBtn: document.getElementById('closeCompactSettingsBtn')
};

// Populate organization selector dropdown
function populateOrgSelector(organizations, selectedOrgId) {
    if (!organizations || organizations.length === 0) {
        // No orgs - hide selector column
        elements.orgSelectorCol.style.display = 'none';
        return;
    }

    // Only show selector if user has multiple chat orgs
    if (organizations.length > 1) {
        elements.orgSelectorCol.style.display = '';  // Show column (use default flex display)
        
        // Clear existing options
        elements.orgSelector.innerHTML = '';
        
        // Add each org as an option
        organizations.forEach(org => {
            const option = document.createElement('option');
            option.value = org.id;
            option.textContent = `${org.name}${org.isTeam ? ' (Team)' : ' (Personal)'}`;
            if (org.id === selectedOrgId) {
                option.selected = true;
            }
            elements.orgSelector.appendChild(option);
        });
    } else {
        // Single org - hide selector column
        elements.orgSelectorCol.style.display = 'none';
    }
}

// Handle organization change
async function handleOrgChange() {
    const newOrgId = elements.orgSelector.value;
    if (newOrgId && newOrgId !== credentials.organizationId) {
        credentials.organizationId = newOrgId;
        await window.electronAPI.saveCredentials(credentials);
        // Refresh usage data with new org
        await fetchUsageData();
    }
}

// Initialize
async function init() {
    setupEventListeners();
    credentials = await window.electronAPI.getCredentials();

    // Apply saved theme and load thresholds immediately
    const settings = await window.electronAPI.getSettings();
    window._cachedSettings = settings;
    applyTheme(settings.theme);
    // Both before the first render, so nothing flashes at the wrong size or
    // with the wrong ring staging first.
    applyLayout(settings);
    applyElapsedRingColors(settings);
    if (window.electronAPI.platform === 'darwin') {
        document.getElementById('trayLabel').textContent = 'Hide from Dock';
    }
    warnThreshold = settings.warnThreshold;
    dangerThreshold = settings.dangerThreshold;
    compactSpendOpen = !!settings.compactSpendOpen;
    applyCompactSpendRow();

    // Restore compact mode from saved settings
    if (settings.compactMode) {
        applyCompactMode(true);
    } else {
        // Ensure compact overlay is hidden in normal mode
        if (elements.compactSettingsOverlay) elements.compactSettingsOverlay.style.display = 'none';
    }

    // Restore graph visibility
    if (settings.graphVisible) {
        if (!settings.compactMode) {
            // Normal mode — show graph immediately
            graphVisible = true;
            elements.graphBtn.classList.add('active');
            elements.graphSection.style.display = 'block';
        } else {
            // Compact mode — store so it restores when exiting compact
            graphWasVisible = true;
        }
    }

    // Restore expanded state
    if (settings.expandedOpen) {
        isExpanded = true;
        elements.expandArrow.classList.add('expanded');
        elements.expandSection.style.display = 'block';
    }

    if (credentials.sessionKey && credentials.organizationId) {
        // Populate org selector if user has multiple orgs
        if (credentials.organizations && credentials.organizations.length > 0) {
            populateOrgSelector(credentials.organizations, credentials.organizationId);
        }
        showMainContent();
        await fetchUsageData();
        startAutoUpdate();
    } else {
        showLoginRequired();
    }

    // Populate version label then check for updates after a short delay
    const version = await window.electronAPI.getAppVersion();
    if (elements.settingsVersionLabel) {
        elements.settingsVersionLabel.textContent = `Application Version: v${version}`;
    }
    setTimeout(checkForUpdate, 2000);
    // Also check once every 24 hours for users who never close the app
    setInterval(checkForUpdate, 24 * 60 * 60 * 1000);

    // Startup restore complete — allow _saveViewState to persist changes
    appInitializing = false;
}

// Event Listeners
function setupEventListeners() {
    // Step 1: Login via BrowserWindow
    elements.autoDetectBtn.addEventListener('click', handleAutoDetect);

    // Step navigation
    elements.nextStepBtn.addEventListener('click', () => {
        elements.loginStep1.style.display = 'none';
        elements.loginStep2.style.display = 'block';
        elements.sessionKeyInput.focus();
    });

    elements.backStepBtn.addEventListener('click', () => {
        elements.loginStep2.style.display = 'none';
        elements.loginStep1.style.display = 'flex';
        elements.sessionKeyError.textContent = '';
    });

    // Open browser link in step 2
    elements.openBrowserLink.addEventListener('click', (e) => {
        e.preventDefault();
        window.electronAPI.openExternal('https://claude.ai');
    });

    // Step 2: Manual sessionKey connect
    elements.connectBtn.addEventListener('click', handleConnect);
    elements.sessionKeyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleConnect();
        elements.sessionKeyError.textContent = '';
    });

    elements.refreshBtn.addEventListener('click', async () => {
        debugLog('Refresh button clicked');
        elements.refreshBtn.classList.add('spinning');
        await fetchUsageData();
        elements.refreshBtn.classList.remove('spinning');
    });

    elements.graphBtn.addEventListener('click', async () => {
        graphVisible = !graphVisible;
        elements.graphBtn.classList.toggle('active', graphVisible);
        elements.graphSection.style.display = graphVisible ? 'block' : 'none';
        if (graphVisible) {
            await loadChart();
        }
        if (!isCompactMode) resizeWidget();
        _saveViewState();
    });

    elements.minimizeBtn.addEventListener('click', () => {
        window.electronAPI.minimizeWindow();
    });

    elements.closeBtn.addEventListener('click', () => {
        window.electronAPI.closeWindow();
    });

    // Expand/collapse toggle
    elements.expandToggle.addEventListener('click', async () => {
        const wasExpanded = isExpanded;
        isExpanded = !isExpanded;
        elements.expandArrow.classList.toggle('expanded', isExpanded);
        elements.expandSection.style.display = isExpanded ? 'block' : 'none';
        if (graphVisible) {
            loadChart();
        }
        resizeWidget();
        
        // CRITICAL: Update expandedOpen setting IMMEDIATELY (no debounce) to prevent race condition
        // If we wait for the debounced save, auto-refresh might fetch with stale expandedOpen=false
        const settings = window._cachedSettings || await window.electronAPI.getSettings();
        settings.expandedOpen = isExpanded;
        window._cachedSettings = settings;
        await window.electronAPI.saveSettings(settings);
        
        // Trigger immediate fetch if panel was just opened (collapsed → expanded)
        // This ensures fresh overage/prepaid data is available when user expands the panel
        // Pass forceExtended to bypass any cached setting and fetch extended data immediately
        if (!wasExpanded && isExpanded) {
            debugLog('[Conditional Polling] Panel expanded - triggering immediate fetch with extended data');
            await fetchUsageData({ forceExtended: true });
        }
    });

    // Settings close
    elements.closeSettingsBtn.addEventListener('click', async () => {
        await saveSettings();
        elements.settingsOverlay.style.display = 'none';
        if (_settingsOpenedFromCompact) {
            _settingsOpenedFromCompact = false;
            if (isCompactMode) {
                window.electronAPI.setCompactMode(true);
            } else {
                resizeWidget();
            }
        } else if (!isCompactMode) {
            resizeWidget();
        }
        startAutoUpdate();
    });

    elements.logoutBtn.addEventListener('click', async () => {
        await window.electronAPI.deleteCredentials();
        credentials = { sessionKey: null, organizationId: null };
        elements.settingsOverlay.style.display = 'none';
        showLoginRequired();
    });

    elements.coffeeBtn.addEventListener('click', () => {
        window.electronAPI.openExternal('https://paypal.me/SlavomirDurej?country.x=GB&locale.x=en_GB');
    });

    // Theme buttons
    elements.themeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            elements.themeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyTheme(btn.dataset.theme);
        });
    });

    // Density, Resets At and the ring staging all repaint live — the point of
    // these is how the rows look, so they have to be judged against the real
    // thing rather than a label. Persisted on Done, as everything else is.
    for (const el of [elements.density, elements.showResetsAtToggle,
                      elements.showSessionContextToggle, elements.sessionContextWindow]) {
        if (!el) continue;
        el.addEventListener('change', () => {
            applyLayout(readLayoutInputs());
            // applyLayout repaints the panel but does not resize: turning the
            // panel on or off changes the window width, and switching the
            // window figure changes nothing but the bar fills.
            if (!isCompactMode) resizeWidget();
        });
    }

    const repaintRings = () => syncElapsedControls(applyElapsedRingColors(readElapsedInputs()));
    if (elements.elapsedColorMode) elements.elapsedColorMode.addEventListener('change', repaintRings);
    for (const el of [elements.elapsedWarnPercent, elements.elapsedSoonPercent]) {
        if (el) el.addEventListener('input', repaintRings);
    }

    // Prevent accidental app hiding: bidirectional coupling between Hide from Taskbar and Show Tray Stats
    // If user enables "Hide from Taskbar", automatically enable "Show Tray Stats" (ensures tray icon is visible)
    elements.minimizeToTrayToggle.addEventListener('change', () => {
        if (elements.minimizeToTrayToggle.checked && !elements.showTrayStatsToggle.checked) {
            elements.showTrayStatsToggle.checked = true;
        }
    });

    // If user disables "Show Tray Stats", automatically disable "Hide from Taskbar" (prevents app from being completely hidden)
    elements.showTrayStatsToggle.addEventListener('change', () => {
        if (!elements.showTrayStatsToggle.checked && elements.minimizeToTrayToggle.checked) {
            elements.minimizeToTrayToggle.checked = false;
        }
    });

    // Listen for refresh requests from tray
    window.electronAPI.onRefreshUsage(async () => {
        if (elements.refreshBtn) elements.refreshBtn.classList.add('spinning');
        await fetchUsageData();
        if (elements.refreshBtn) elements.refreshBtn.classList.remove('spinning');
    });

    // Listen for session expiration events (403 errors)
    window.electronAPI.onSessionExpired(() => {
        debugLog('Session expired event received');
        credentials = { sessionKey: null, organizationId: null };
        showLoginRequired();
    });

    // Update banner
    elements.updateBannerDismiss.addEventListener('click', () => {
        elements.updateBanner.style.display = 'none';
        resizeWidget();
    });
    elements.updateBannerText.addEventListener('click', () => {
        window.electronAPI.openExternal(`https://github.com/SlavomirDurej/claude-usage-widget/releases/latest`);
    });
    elements.settingsUpdateLink.addEventListener('click', () => {
        window.electronAPI.openExternal(`https://github.com/SlavomirDurej/claude-usage-widget/releases/latest`);
    });

    // Compact mode — collapse chevron (normal → compact)
    elements.compactCollapseBtn.addEventListener('click', async () => {
        applyCompactMode(true);
        await _saveCompactSetting(true);
    });

    // Compact mode — expand chevron (compact → normal)
    elements.compactExpandBtn.addEventListener('click', async () => {
        applyCompactMode(false);
        await _saveCompactSetting(false);
    });

    // Compact mode — spend row chevron (show/hide the Spend bar)
    elements.compactSpendToggle.addEventListener('click', async () => {
        compactSpendOpen = !compactSpendOpen;
        applyCompactSpendRow();

        // Persist immediately (not debounced): main's getCompactHeight() reads
        // this setting when re-sizing right below, so it must be stored first.
        const settings = window._cachedSettings || await window.electronAPI.getSettings();
        settings.compactSpendOpen = compactSpendOpen;
        window._cachedSettings = settings;
        await window.electronAPI.saveSettings(settings);

        // Re-assert compact bounds so the window grows/shrinks for the row
        if (isCompactMode) window.electronAPI.setCompactMode(true);

        // Opening the row: fetch fresh spend data right away — collapsed
        // compact mode doesn't poll the spend endpoints, so whatever is in
        // latestUsageData.extra_usage may be stale or missing until this lands
        if (compactSpendOpen) {
            await fetchUsageData({ forceExtended: true });
        }
    });

    // Compact mode toggle in normal settings panel — deferred to Done click

    // Compact mode toggle in compact settings panel — just updates the checkbox, Done applies it
    elements.compactModeToggleCompact.addEventListener('change', () => {
        // No immediate action — Done button reads this value and applies
    });

    // Organization selector — change triggers immediate save and refresh
    elements.orgSelector.addEventListener('change', handleOrgChange);

    // Settings button — always open full settings; if in compact mode, temporarily expand the window first
    elements.settingsBtn.addEventListener('click', async () => {
        stopAutoUpdate();
        if (isCompactMode) {
            _settingsOpenedFromCompact = true;
            window.electronAPI.setCompactMode(false);
        }
        await loadSettings();
        elements.settingsOverlay.style.display = 'flex';
        window.electronAPI.resizeWindow(SETTINGS_HEIGHT, PANEL_WIDTH);
    });

    // Close compact settings — apply compact toggle value then close
    elements.closeCompactSettingsBtn.addEventListener('click', async () => {
        const compact = elements.compactModeToggleCompact.checked;
        if (compact !== isCompactMode) {
            applyCompactMode(compact);
            await _saveCompactSetting(compact);
        }
        elements.compactSettingsOverlay.style.display = 'none';
        startAutoUpdate();
    });
}

// Handle manual sessionKey connect
async function handleConnect() {
    const sessionKey = elements.sessionKeyInput.value.trim();
    if (!sessionKey) {
        elements.sessionKeyError.textContent = 'Please paste your session key';
        return;
    }

    elements.connectBtn.disabled = true;
    elements.connectBtn.textContent = '...';
    elements.sessionKeyError.textContent = '';

    try {
        const result = await window.electronAPI.validateSessionKey(sessionKey);
        if (result.success) {
            credentials = { 
                sessionKey, 
                organizationId: result.organizationId,
                organizations: result.organizations || []
            };
            await window.electronAPI.saveCredentials(credentials);
            populateOrgSelector(result.organizations || [], result.organizationId);
            elements.sessionKeyInput.value = '';
            showMainContent();
            await fetchUsageData();
            startAutoUpdate();
        } else {
            elements.sessionKeyError.textContent = result.error || 'Invalid session key';
        }
    } catch (error) {
        elements.sessionKeyError.textContent = 'Connection failed. Check your key.';
    } finally {
        elements.connectBtn.disabled = false;
        elements.connectBtn.textContent = 'Connect';
    }
}

// Handle auto-detect from browser cookies
async function handleAutoDetect() {
    elements.autoDetectBtn.disabled = true;
    elements.autoDetectBtn.textContent = 'Waiting...';
    elements.autoDetectError.textContent = '';

    try {
        const result = await window.electronAPI.detectSessionKey();
        if (!result.success) {
            elements.autoDetectError.textContent = result.error || 'Login failed';
            return;
        }

        // Got sessionKey from login, now validate it
        elements.autoDetectBtn.textContent = 'Validating...';
        const validation = await window.electronAPI.validateSessionKey(result.sessionKey);

        if (validation.success) {
            credentials = {
                sessionKey: result.sessionKey,
                organizationId: validation.organizationId,
                organizations: validation.organizations || []
            };
            await window.electronAPI.saveCredentials(credentials);
            populateOrgSelector(validation.organizations || [], validation.organizationId);
            showMainContent();
            await fetchUsageData();
            startAutoUpdate();
        } else {
            elements.autoDetectError.textContent =
                'Session invalid. Try again or use Manual →';
        }
    } catch (error) {
        elements.autoDetectError.textContent = error.message || 'Login failed';
    } finally {
        elements.autoDetectBtn.disabled = false;
        elements.autoDetectBtn.textContent = 'Log in';
    }
}

// Fetch usage data from Claude API
async function fetchUsageData(options = {}) {
    debugLog('fetchUsageData called');

    if (isFetching) {
        debugLog('Fetch already in flight — skipping');
        return;
    }

    if (!credentials.sessionKey || !credentials.organizationId) {
        debugLog('Missing credentials, showing login');
        showLoginRequired();
        return;
    }

    isFetching = true;
    try {
        debugLog('Calling electronAPI.fetchUsageData...');
        const data = await window.electronAPI.fetchUsageData(options);
        debugLog('Received usage data:', data);
        updateUI(data);
    } catch (error) {
        console.error('Error fetching usage data:', error);
        if (error.message.includes('SessionExpired') || error.message.includes('Unauthorized')) {
            credentials = { sessionKey: null, organizationId: null };
            showLoginRequired();
        } else {
            debugLog('Failed to fetch usage data');
        }
    } finally {
        isFetching = false;
    }
}


// Update UI with usage data
// Format a cent-based amount with the correct currency symbol.
// Known unambiguous symbols are used; everything else falls back to the
// ISO 4217 code as a suffix so the display is always correct.
function formatCurrency(amountCents, currencyCode) {
  const amount = (amountCents / 100).toFixed(2);
  const symbols = { USD: '$', EUR: '€', GBP: '£' };
  const sym = symbols[currencyCode];
  return sym ? `${sym}${amount}` : `${amount} ${currencyCode || 'USD'}`;
}

// Usage keys that have their own always-visible row in the main widget body
// rather than a row inside the expansion. These must be excluded from BOTH
// EXTRA_ROW_CONFIG below and the scoped-model registration in
// normalizeUsageData(), or the same limit renders twice — once as a primary
// row and once as a generic "scoped" row in the expansion.
const PRIMARY_ROW_KEYS = new Set(['seven_day_fable']);

// Extra row label mapping for API fields
const EXTRA_ROW_CONFIG = {
    seven_day_sonnet: { label: 'Sonnet (7d)', color: 'sonnet' },
    seven_day_opus: { label: 'Opus (7d)', color: 'opus' },
    // seven_day_fable is deliberately absent — see PRIMARY_ROW_KEYS above.
    seven_day_cowork: { label: 'Cowork (7d)', color: 'cowork' },
    seven_day_omelette: { label: 'Design (7d)', color: 'design' },
    seven_day_oauth_apps: { label: 'OAuth Apps (7d)', color: 'oauth' },
    extra_usage: { label: 'Extra Usage', color: 'extra' },
};

// Expiry warning thresholds for the credits row (days until next_expires_at)
const CREDIT_EXPIRY_WARN_DAYS = 21;
const CREDIT_EXPIRY_DANGER_DAYS = 7;

// Builds the credit-balance row shown beneath Monthly Spend.
// Promo/paid split renders only when purchased credits exist (money at risk);
// the expiry chip renders only when the next expiry is within the warn window.
function buildCreditsRow(value) {
    const row = document.createElement('div');
    row.className = 'usage-section credits-row';

    const label = document.createElement('span');
    label.className = 'usage-label credits-label';
    // Invisible clone of the spend row's ON/OFF badge so "Credits" aligns
    // with "Monthly Spend" regardless of badge width
    if (value.is_enabled === true || value.is_enabled === false) {
        const spacer = document.createElement('span');
        spacer.className = 'extra-status badge-spacer';
        spacer.textContent = value.is_enabled ? 'ON' : 'OFF';
        label.appendChild(spacer);
    }
    label.appendChild(document.createTextNode(' Credits'));
    row.appendChild(label);

    const amount = document.createElement('span');
    amount.className = 'credits-amount';
    amount.textContent = formatCurrency(value.balance_cents, value.currency);
    row.appendChild(amount);

    if (typeof value.paid_cents === 'number' && value.paid_cents > 0) {
        const split = document.createElement('span');
        split.className = 'credits-split';
        split.textContent = `promo ${formatCurrency(value.promo_cents || 0, value.currency)} / paid ${formatCurrency(value.paid_cents, value.currency)}`;
        row.appendChild(split);
    }

    if (value.next_expires_at && typeof value.next_expiry_cents === 'number' && value.next_expiry_cents > 0) {
        const daysLeft = Math.ceil((new Date(value.next_expires_at).getTime() - Date.now()) / 86400000);
        if (daysLeft >= 0 && daysLeft <= CREDIT_EXPIRY_WARN_DAYS) {
            const chip = document.createElement('span');
            chip.className = 'credits-chip' + (daysLeft <= CREDIT_EXPIRY_DANGER_DAYS ? ' danger' : '');
            const when = daysLeft <= CREDIT_EXPIRY_DANGER_DAYS
                ? `in ${daysLeft}d`
                : new Date(value.next_expires_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            chip.textContent = `${formatCurrency(value.next_expiry_cents, value.currency)} expires ${when}`;
            chip.title = `Expires ${new Date(value.next_expires_at).toLocaleDateString()}`;
            row.appendChild(chip);
        }
    }

    return row;
}

function buildExtraRows(data) {

    // Don't clear existing rows if we don't have new data to replace them with
    // This preserves the last known state when expanding the panel
    const hasAnyExtendedData = Object.entries(EXTRA_ROW_CONFIG).some(([key, config]) => {
        const value = data[key];
        const hasUtilization = value && value.utilization !== undefined;
        const hasBalance = key === 'extra_usage' && value && value.balance_cents != null;
        return hasUtilization || hasBalance;
    });
    
    // Only rebuild if we have data, otherwise keep existing rows
    if (!hasAnyExtendedData && elements.extraRows.children.length > 0) {
        return; // Keep existing rows
    }
    
    elements.extraRows.innerHTML = '';
    let count = 0;

    for (const [key, config] of Object.entries(EXTRA_ROW_CONFIG)) {
        const value = data[key];
        // extra_usage is valid with utilization OR balance_cents (prepaid only)
        const hasUtilization = value && value.utilization !== undefined;
        const hasBalance = key === 'extra_usage' && value && value.balance_cents != null;
        if (!hasUtilization && !hasBalance) continue;

        const utilization = value.utilization || 0;
        const resetsAt = value.resets_at;
        const colorClass = config.color;

        const row = document.createElement('div');
        row.className = 'usage-section';

        // Build row using DOM methods (no innerHTML)
        const label = document.createElement('span');
        label.className = 'usage-label';
        
        if (key === 'extra_usage') {
            // Extra usage: ON/OFF indicator goes next to label
            if (value.is_enabled === true) {
                const statusTag = document.createElement('span');
                statusTag.className = 'extra-status on';
                statusTag.textContent = 'ON';
                label.appendChild(statusTag);
            } else if (value.is_enabled === false) {
                const statusTag = document.createElement('span');
                statusTag.className = 'extra-status off';
                statusTag.textContent = 'OFF';
                label.appendChild(statusTag);
            }
            label.appendChild(document.createTextNode(' Monthly Spend'));
        } else {
            label.textContent = config.label;
        }
        row.appendChild(label);

        if (key === 'extra_usage') {
            // Spend row uses flex (like the credits row): label | stretching bar | right-flush $ text
            row.classList.add('spend-row');
            const barGroup = document.createElement('div');
            barGroup.className = 'usage-bar-group spend-bar-group';
            const progressBar = document.createElement('div');
            progressBar.className = 'progress-bar';
            const progressFill = document.createElement('div');
            progressFill.className = `progress-fill ${colorClass}`;
            progressFill.style.width = `${Math.min(utilization, 100)}%`;

            // Apply warning/danger thresholds to extra usage bar
            if (utilization >= dangerThreshold) {
                progressFill.classList.add('danger');
            } else if (utilization >= warnThreshold) {
                progressFill.classList.add('warning');
            }
            
            progressBar.appendChild(progressFill);
            barGroup.appendChild(progressBar);
            row.appendChild(barGroup);

            // Dollar text lives in the (now empty) timer+resets columns so the
            // bar keeps the full bar-column width like the session/weekly rows
            const spendText = document.createElement('span');
            if (value.used_cents != null && value.limit_cents != null) {
                spendText.className = 'usage-percentage extra-spending spend-cap-text';
                let limitStr = formatCurrency(value.limit_cents, value.currency);
                if (value.limit_cents % 100 === 0) limitStr = limitStr.replace('.00', '');
                spendText.textContent = `${formatCurrency(value.used_cents, value.currency)}/${limitStr} cap`;
            } else {
                spendText.className = 'usage-percentage spend-cap-text';
                spendText.textContent = `${Math.round(utilization)}%`;
            }
            row.appendChild(spendText);
        } else {
            const totalMinutes = key.includes('seven_day') ? 7 * 24 * 60 : 5 * 60;

            const barGroup = document.createElement('div');
            barGroup.className = 'usage-bar-group';
            const progressBar = document.createElement('div');
            progressBar.className = 'progress-bar';
            const progressFill = document.createElement('div');
            progressFill.className = `progress-fill ${colorClass}`;
            progressFill.style.width = `${Math.min(utilization, 100)}%`;
            // Apply warning/danger thresholds — same check the spend row and
            // compact mode already use, previously missing here so every
            // model row (Sonnet, Opus, Fable, etc.) rendered flat regardless
            // of usage level.
            if (utilization >= dangerThreshold) {
                progressFill.classList.add('danger');
            } else if (utilization >= warnThreshold) {
                progressFill.classList.add('warning');
            }
            progressBar.appendChild(progressFill);
            barGroup.appendChild(progressBar);

            const percentage = document.createElement('span');
            percentage.className = 'usage-percentage';
            percentage.textContent = `${Math.round(utilization)}%`;
            barGroup.appendChild(percentage);
            row.appendChild(barGroup);

            const elapsedGroup = document.createElement('div');
            elapsedGroup.className = 'usage-elapsed-group';
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'mini-timer');
            svg.setAttribute('width', '24');
            svg.setAttribute('height', '24');
            svg.setAttribute('viewBox', '0 0 24 24');
            const circleBg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circleBg.setAttribute('class', 'timer-bg');
            circleBg.setAttribute('cx', '12');
            circleBg.setAttribute('cy', '12');
            circleBg.setAttribute('r', '10');
            svg.appendChild(circleBg);
            const circleProgress = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circleProgress.setAttribute('class', `timer-progress ${colorClass}`);
            circleProgress.setAttribute('cx', '12');
            circleProgress.setAttribute('cy', '12');
            circleProgress.setAttribute('r', '10');
            circleProgress.style.strokeDasharray = '63';
            circleProgress.style.strokeDashoffset = '63';
            svg.appendChild(circleProgress);
            elapsedGroup.appendChild(svg);
            row.appendChild(elapsedGroup);

            const timerText = document.createElement('div');
            timerText.className = 'timer-text';
            timerText.dataset.resets = resetsAt || '';
            timerText.dataset.total = totalMinutes;
            timerText.textContent = '--:--';
            row.appendChild(timerText);

            const resetsText = document.createElement('span');
            resetsText.className = 'resets-at-text';
            if (resetsAt) {
                const settings = window._cachedSettings || {};
                resetsText.textContent = formatResetsAt(resetsAt, true, settings.timeFormat || '12h', settings.weeklyDateFormat || 'date');
            }
            row.appendChild(resetsText);
        }

        elements.extraRows.appendChild(row);
        count++;

        // Credit balance gets its own row beneath Monthly Spend
        if (key === 'extra_usage' && value.balance_cents != null) {
            elements.extraRows.appendChild(buildCreditsRow(value));
            count++;
        }
    }

    // Hide toggle if no extra rows
    elements.expandToggle.style.display = count > 0 ? 'flex' : 'none';
    if (count === 0 && isExpanded) {
        isExpanded = false;
        elements.expandArrow.classList.remove('expanded');
        elements.expandSection.style.display = 'none';
    }

    // The rings above were just created, so they carry no staging override.
    // Done here rather than at the call sites so a new one can't forget it.
    applyElapsedRingColors(window._cachedSettings || {});

    return count;
}

function refreshExtraTimers() {
    // Pair each row's timer text with its own circle. Pairing the two
    // querySelectorAll lists by index breaks as soon as a row has a text but
    // no circle (the extra_usage row), which shifts every later row's circle
    // and leaves those timers stuck at --:--.
    elements.extraRows.querySelectorAll('.usage-section').forEach((row) => {
        const textEl = row.querySelector('.timer-text');
        const circleEl = row.querySelector('.timer-progress');
        if (!textEl || !circleEl) return;
        const resetsAt = textEl.dataset.resets;
        const totalMinutes = parseInt(textEl.dataset.total);
        if (resetsAt) {
            updateTimer(circleEl, textEl, resetsAt, totalMinutes);
        }
    });
}

// How long the progress bars should be. Everything else in a row is sized to
// its content, so this is the one horizontal dimension that is a choice rather
// than a measurement, and it sets the window width via measuredWidth().
const BAR_WIDTH = 167;
// Position of the flexible bar track in --grid-cols.
const BAR_TRACK_INDEX = 1;

// ── Session context panel ───────────────────────────────────────────────────
// The only part of this widget not fed by claude.ai. Rows come from
// src/session-context.js via IPC; see there for why it reads only file tails.

function formatTokens(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1000) return Math.round(n / 1000) + 'k';
    return String(n);
}

function renderSessionContext() {
    const panel = elements.contextPanel;
    const host = elements.contextRows;
    if (!panel || !host) return;

    if (!showSessionContext) {
        panel.style.display = 'none';
        return;
    }
    panel.style.display = '';
    host.innerHTML = '';

    if (!sessionContextRows.length) {
        const empty = document.createElement('div');
        empty.className = 'context-empty';
        empty.textContent = 'No sessions';
        host.appendChild(empty);
        return;
    }

    for (const session of sessionContextRows) {
        const row = document.createElement('div');
        row.className = 'context-row';
        // The label is a folder basename, so two sessions in same-named
        // directories look identical — the tooltip carries what tells them
        // apart.
        row.title = session.title ? `${session.cwd}\n${session.title}` : session.cwd;

        const top = document.createElement('div');
        top.className = 'context-row-top';

        const label = document.createElement('span');
        label.className = 'context-label';
        label.textContent = session.label;

        const count = document.createElement('span');
        count.className = 'context-count';
        count.textContent = formatTokens(session.tokens);

        top.appendChild(label);
        top.appendChild(count);

        const bar = document.createElement('div');
        bar.className = 'context-bar';
        const fill = document.createElement('div');
        fill.className = 'context-bar-fill';
        const percent = Math.max(0, Math.min(100, (session.tokens / sessionContextWindow) * 100));
        fill.style.width = percent + '%';
        bar.appendChild(fill);

        row.appendChild(top);
        row.appendChild(bar);
        host.appendChild(row);
    }
}

async function refreshSessionContext() {
    if (showSessionContext) {
        try {
            const rows = await window.electronAPI.getSessionContext();
            // Keep the previous rows on a failure rather than emptying the
            // panel: an empty panel resizes the window, so a transient error
            // would make the widget jump.
            if (Array.isArray(rows)) sessionContextRows = rows;
        } catch (error) {
            debugLog('Session context refresh failed:', error);
        }
    }
    renderSessionContext();
    resizeWidget();
}

// The panel sits OUTSIDE the row grid, so measuredWidth()'s track sum cannot
// see it — the §2 shape exactly, and the reason it is added by hand here.
// Returns 0 when hidden, so turning the setting off narrows the window back.
function contextPanelWidth() {
    const panel = elements.contextPanel;
    if (!panel || !panel.offsetParent) return 0;
    const gap = parseFloat(getComputedStyle(panel.parentElement).columnGap) || 0;
    return panel.offsetWidth + gap;
}

// How far the panel hangs below the rows beside it. Zero while the account has
// the Fable row (three rows against three), positive without it. MEASURED per
// §1 — deriving it from row counts is what that lesson forbids.
function contextPanelOverhang() {
    const panel = elements.contextPanel;
    const rows = document.querySelector('.primary-rows');
    if (!panel || !panel.offsetParent || !rows) return 0;
    return Math.max(0, Math.ceil(panel.offsetHeight - rows.offsetHeight));
}

const BANNER_HEIGHT = 28;
const EXPAND_OVERHEAD = 28; // margin-top(12) + padding-top(6) + bottom buffer(10)

function resizeWidget(bannerVisible) {
    const hasBanner = bannerVisible !== undefined
        ? bannerVisible
        : elements.updateBanner.style.display !== 'none';
    const bannerOffset = hasBanner ? BANNER_HEIGHT : 0;
    const extraCount = elements.extraRows.children.length;
    const expandedOffset = isExpanded && extraCount > 0
        ? EXPAND_OVERHEAD + (extraCount * WIDGET_ROW_HEIGHT)
        : 0;
    const graphOffset = graphVisible ? GRAPH_HEIGHT : 0;
    // The collapsed height covers the two always-present rows; the Fable row
    // only exists on accounts that have the limit, so it is added rather than
    // baked in. Both track density. Mirrors getCompactHeight() in main.js,
    // which already does this for compact mode.
    const density = currentDensity();
    const fableOffset = latestUsageData?.seven_day_fable ? FABLE_ROW_HEIGHTS[density] : 0;
    // The context panel is beside the primary rows, not below them, so it costs
    // height only when it is the taller side — which is exactly when the Fable
    // row is absent and it has three rows against two.
    const contextOffset = contextPanelOverhang();
    const totalHeight = COLLAPSED_HEIGHTS[density] + fableOffset + contextOffset
        + expandedOffset + graphOffset + bannerOffset;
    window.electronAPI.resizeWindow(totalHeight, measuredWidth(), true);
}

// Width the window needs, read back from the layout rather than restated.
//
// The column widths live in styles.css and vary with density and with the
// Resets At setting. Copying them into JS would mean two sets of numbers with
// nothing keeping them in step — the drift this branch has already been bitten
// by more than once. getComputedStyle resolves gridTemplateColumns to actual
// pixels, so summing the fixed tracks and adding the gaps, the padding and the
// bar gives the true requirement, and it keeps working if a column is ever
// resized, added or removed.
//
// Returns undefined if the row isn't laid out yet (login screen, first paint),
// which leaves the main process to fall back to the stored width.
function measuredWidth() {
    const row = elements.sessionSection;
    if (!row || !row.offsetParent) return undefined;

    const cs = getComputedStyle(row);
    const tracks = cs.gridTemplateColumns.split(' ').map(parseFloat).filter(Number.isFinite);
    if (tracks.length < 2) return undefined;

    // Track 1 is the flexible bar; it currently holds whatever slack the
    // window happens to have, so it's replaced with the width we want rather
    // than measured.
    const fixed = tracks.reduce((sum, w, i) => (i === BAR_TRACK_INDEX ? sum : sum + w), 0);
    const gaps = parseFloat(cs.columnGap) * (tracks.length - 1);
    const rowPadding = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const contentStyle = getComputedStyle(row.parentElement);
    const contentPadding = parseFloat(contentStyle.paddingLeft) + parseFloat(contentStyle.paddingRight);

    return Math.ceil(fixed + gaps + rowPadding + contentPadding + BAR_WIDTH + contextPanelWidth());
}

function normalizeUsageData(data) {
    // The synthetic seven_day_<name> fields for scoped weekly limits (e.g.
    // Fable) are produced centrally in main.js (normalize-usage-limits.js), so
    // `data` already carries them here. This renderer step only ensures every
    // scoped model has a matching EXTRA_ROW_CONFIG entry: statically known
    // models already do; any unknown model is registered generically
    // (label "<DisplayName> (7d)", fallback color) while keeping extra_usage as
    // the last row so it stays grouped below the model rows.
    for (const limit of (data && data.limits) || []) {
        if (!limit || limit.kind !== 'weekly_scoped' || limit.percent == null) continue;
        const displayName = limit.scope && limit.scope.model && limit.scope.model.display_name;
        if (!displayName) continue;
        const key = 'seven_day_' + String(displayName).toLowerCase().replace(/[^a-z0-9]+/g, '_');
        // Fable has its own primary row; registering it here would add a
        // duplicate generic row in the expansion.
        if (PRIMARY_ROW_KEYS.has(key)) continue;
        if (EXTRA_ROW_CONFIG[key]) continue; // already known
        const extraUsage = EXTRA_ROW_CONFIG.extra_usage;
        delete EXTRA_ROW_CONFIG.extra_usage;
        EXTRA_ROW_CONFIG[key] = { label: `${displayName} (7d)`, color: 'scoped' };
        EXTRA_ROW_CONFIG.extra_usage = extraUsage;
    }
    return data;
}

function updateUI(data) {
    latestUsageData = normalizeUsageData(data);

    showMainContent();
    buildExtraRows(data);
    refreshTimers();
    if (isExpanded) refreshExtraTimers();
    if (!isCompactMode) resizeWidget();
    startCountdown();
    if (graphVisible) {
        loadChart();
    }

    // Update compact bars in parallel if compact mode is active
    if (isCompactMode) updateCompactBars(data);

    // On first load, seed alert flags so we don't fire for thresholds
    // the user can already see when the app starts
    if (isFirstDataLoad) {
        isFirstDataLoad = false;
        seedAlertFlags(data);
    }

    checkUsageAlerts(data);

    // Local disk scan, deliberately not awaited: it is fast (~20 ms) but it is
    // I/O, and nothing above depends on it. It resizes the window itself when
    // it lands. Skipped in compact mode, which has no panel.
    if (!isCompactMode) refreshSessionContext();
}

// Fire OS desktop notifications when usage crosses warn/danger thresholds.
// Only fires once per threshold crossing per session window — not on every refresh.
function checkUsageAlerts(data) {
    const settings = window._cachedSettings || {};
    if (!settings.usageAlerts) return;

    const sessionPct = data.five_hour?.utilization || 0;
    const weeklyPct = data.seven_day?.utilization || 0;

    // Reset alert flags when a session window resets (utilization drops back low)
    if (sessionPct < warnThreshold) {
        alertFired.session_warn = false;
        alertFired.session_danger = false;
    }
    if (weeklyPct < warnThreshold) {
        alertFired.weekly_warn = false;
        alertFired.weekly_danger = false;
    }

    // Current Session — danger threshold (check first, higher priority)
    // Capped below 100 so the dedicated "limit reached" notification owns that moment exclusively
    if (sessionPct >= dangerThreshold && sessionPct < 100 && !alertFired.session_danger) {
        alertFired.session_danger = true;
        alertFired.session_warn = true; // suppress warn if we jumped straight to danger
        window.electronAPI.showNotification(
            'Claude Usage Widget',
            `Current Session usage is at ${Math.round(sessionPct)}% — usage is extremely low`
        );
    // Current Session — warn threshold
    } else if (sessionPct >= warnThreshold && sessionPct < 100 && !alertFired.session_warn) {
        alertFired.session_warn = true;
        window.electronAPI.showNotification(
            'Claude Usage Widget',
            `Current Session usage is at ${Math.round(sessionPct)}% — usage is low`
        );
    }

    // Weekly Limit — danger threshold
    // Capped below 100 so the dedicated "limit reached" notification owns that moment exclusively
    if (weeklyPct >= dangerThreshold && weeklyPct < 100 && !alertFired.weekly_danger) {
        alertFired.weekly_danger = true;
        alertFired.weekly_warn = true;
        window.electronAPI.showNotification(
            'Claude Usage Widget',
            `Weekly Limit usage is at ${Math.round(weeklyPct)}% — usage is extremely low`
        );
    // Weekly Limit — warn threshold
    } else if (weeklyPct >= warnThreshold && weeklyPct < 100 && !alertFired.weekly_warn) {
        alertFired.weekly_warn = true;
        window.electronAPI.showNotification(
            'Claude Usage Widget',
            `Weekly Limit usage is at ${Math.round(weeklyPct)}% — usage is low`
        );
    }

    // Combined blocked/available — fires once when the user actually can't use
    // Claude anymore (either window at 100%), and once when it genuinely clears.
    // Single flag by design: if weekly is still at 100% when session resets, isBlocked
    // stays true, so a session-only reset never fires a false "available again".
    // Weekly checked first since it's the more restrictive limit when both are maxed.
    const isBlocked = weeklyPct >= 100 || sessionPct >= 100;
    if (isBlocked && !alertFired.blocked) {
        alertFired.blocked = true;
        if (weeklyPct >= 100) {
            window.electronAPI.showNotification(
                'Weekly limit reached.',
                // Build date and time as separate pieces and join with "at" — formatResetsAt's
                // combined date-day-time mode concatenates them with no connector, which read
                // run-on. Independent of dashboard's weeklyDateFormat setting on purpose.
                `Usage resets on ${formatResetsAt(data.seven_day?.resets_at, true, settings.timeFormat || '12h', 'date-day')} at ${formatResetsAt(data.seven_day?.resets_at, false, settings.timeFormat || '12h', 'date-day')}.`
            );
        } else {
            window.electronAPI.showNotification(
                'Session limit reached.',
                `Usage resets at ${formatResetsAt(data.five_hour?.resets_at, false, settings.timeFormat || '12h', settings.weeklyDateFormat || 'date')}.`
            );
        }
    } else if (!isBlocked && alertFired.blocked) {
        alertFired.blocked = false;
        window.electronAPI.showNotification(
            'Claude Usage Widget',
            'Usage is available again.'
        );
    }
}

// Apply or remove compact mode — switches view, resizes window, syncs all toggles
function applyCompactMode(compact) {
    isCompactMode = compact;

    // Add/remove compact-mode class from body for CSS styling
    if (compact) {
        document.body.classList.add('compact-mode');
    } else {
        document.body.classList.remove('compact-mode');
    }

    // Show/hide the correct content view
    elements.mainContent.style.display = compact ? 'none' : 'block';
    elements.compactContent.style.display = compact ? 'flex' : 'none';

    // Collapse extra rows when entering compact — prevents stale isExpanded state
    if (compact && isExpanded) {
        isExpanded = false;
        elements.expandArrow.classList.remove('expanded');
        elements.expandSection.style.display = 'none';
    }

    if (compact && graphVisible) {
        graphWasVisible = true;
        graphVisible = false;
        elements.graphBtn.classList.remove('active');
        elements.graphSection.style.display = 'none';
    } else if (!compact && graphWasVisible) {
        graphWasVisible = false;
        graphVisible = true;
        elements.graphBtn.classList.add('active');
        elements.graphSection.style.display = 'block';
        loadChart();
    }

    // Show/hide the collapse chevron (only visible in normal mode with data)
    if (elements.compactCollapseBtn) {
        elements.compactCollapseBtn.style.display = compact ? 'none' : 'flex';
    }

    // Keep refresh button visible in compact mode so users can see when data updates
    // Hide graph button in compact mode (not applicable)
    if (elements.graphBtn) {
        elements.graphBtn.style.display = compact ? 'none' : '';
    }

    // Tell main process to resize the window width
    window.electronAPI.setCompactMode(compact);

    // Sync both settings toggles
    if (elements.compactModeToggle) elements.compactModeToggle.checked = compact;
    if (elements.compactModeToggleCompact) elements.compactModeToggleCompact.checked = compact;

    // Update compact bars if we have data
    if (compact && latestUsageData) updateCompactBars(latestUsageData);
    if (!compact) resizeWidget();

    // Persist graph/expanded state changes caused by compact mode toggle
    _saveViewState();
}

// Update the compact mode progress bars
function updateCompactBars(data) {
    const sessionPct = Math.min(Math.max(data.five_hour?.utilization || 0, 0), 100);
    const weeklyPct = Math.min(Math.max(data.seven_day?.utilization || 0, 0), 100);

    elements.compactSessionFill.style.width = `${sessionPct}%`;
    elements.compactSessionPct.textContent = `${Math.round(sessionPct)}%`;
    elements.compactWeeklyFill.style.width = `${weeklyPct}%`;
    elements.compactWeeklyPct.textContent = `${Math.round(weeklyPct)}%`;

    // Apply warning/danger classes to compact bars
    elements.compactSessionFill.className = 'compact-bar-fill';
    if (sessionPct >= dangerThreshold) elements.compactSessionFill.classList.add('danger');
    else if (sessionPct >= warnThreshold) elements.compactSessionFill.classList.add('warning');

    elements.compactWeeklyFill.className = 'compact-bar-fill weekly';
    if (weeklyPct >= dangerThreshold) elements.compactWeeklyFill.classList.add('danger');
    else if (weeklyPct >= warnThreshold) elements.compactWeeklyFill.classList.add('warning');

    // Fable — only shown when the account has a scoped Fable weekly limit
    // (data.seven_day_fable, normalized centrally by main.js before this ever
    // reaches the renderer — see src/normalize-usage-limits.js)
    if (data.seven_day_fable) {
        const fablePct = Math.min(Math.max(data.seven_day_fable.utilization || 0, 0), 100);
        elements.compactFableRow.style.display = '';
        elements.compactFableFill.style.width = `${fablePct}%`;
        elements.compactFablePct.textContent = `${Math.round(fablePct)}%`;
        elements.compactFableFill.className = 'compact-bar-fill fable';
        if (fablePct >= dangerThreshold) elements.compactFableFill.classList.add('danger');
        else if (fablePct >= warnThreshold) elements.compactFableFill.classList.add('warning');
    } else {
        elements.compactFableRow.style.display = 'none';
    }

    // Spend — only populated while the row is toggled open (collapsed compact
    // mode doesn't poll the spend endpoints, so data.extra_usage may be
    // stale or absent until the row is opened and a fetch completes)
    if (compactSpendOpen && data.extra_usage && data.extra_usage.utilization !== undefined) {
        const spendPct = Math.min(Math.max(data.extra_usage.utilization || 0, 0), 100);
        elements.compactSpendFill.style.width = `${spendPct}%`;
        elements.compactSpendPct.textContent = `${Math.round(spendPct)}%`;
        elements.compactSpendFill.className = 'compact-bar-fill spend';
        if (spendPct >= dangerThreshold) elements.compactSpendFill.classList.add('danger');
        else if (spendPct >= warnThreshold) elements.compactSpendFill.classList.add('warning');
    }
}

// Sync the compact spend chevron + row visibility from compactSpendOpen state
function applyCompactSpendRow() {
    if (!elements.compactSpendToggle) return;
    elements.compactSpendArrow.classList.toggle('expanded', compactSpendOpen);
    elements.compactSpendToggle.title = compactSpendOpen ? 'Hide spend' : 'Show spend';
    elements.compactSpendRow.style.display = compactSpendOpen ? '' : 'none';
}
// Persist compact mode setting without touching the rest of settings — debounced
let _saveCompactTimer = null;
async function _saveCompactSetting(compact) {
    if (_saveCompactTimer) clearTimeout(_saveCompactTimer);
    _saveCompactTimer = setTimeout(async () => {
        const settings = window._cachedSettings || await window.electronAPI.getSettings();
        settings.compactMode = compact;
        window._cachedSettings = settings;
        await window.electronAPI.saveSettings(settings);
    }, 300);
}

// Persist graph/expanded visibility state — debounced to avoid hammering disk on rapid toggles
let _saveViewStateTimer = null;
async function _saveViewState() {
    if (appInitializing) return;
    if (_saveViewStateTimer) clearTimeout(_saveViewStateTimer);
    _saveViewStateTimer = setTimeout(async () => {
        const settings = window._cachedSettings || await window.electronAPI.getSettings();
        settings.graphVisible = graphVisible;
        settings.expandedOpen = isExpanded;
        window._cachedSettings = settings;
        await window.electronAPI.saveSettings(settings);
    }, 300);
}

let sessionResetTriggered = false;
let weeklyResetTriggered = false;
let isFirstDataLoad = true; // used to seed alert flags on startup

// Track which usage alert thresholds have already fired this window
// Prevents repeat notifications on every refresh cycle
// Keys: 'session_warn', 'session_danger', 'weekly_warn', 'weekly_danger', 'blocked'
// Seeded on startup so thresholds already exceeded at launch don't fire immediately
// 'blocked' is a single combined flag (not per-window) — see checkUsageAlerts for why:
// it must stay true if EITHER session or weekly is at 100%, so a session-only reset
// while weekly is still maxed never fires a false "available again" notification.
const alertFired = {
    session_warn: false,
    session_danger: false,
    weekly_warn: false,
    weekly_danger: false,
    blocked: false
};

// Seed alertFired flags based on current utilization at startup.
// Any threshold already exceeded when the app launches is treated as already fired,
// so the user doesn't get a notification for something they can already see.
function seedAlertFlags(data) {
    const sessionPct = data.five_hour?.utilization || 0;
    const weeklyPct = data.seven_day?.utilization || 0;

    if (sessionPct >= dangerThreshold) {
        alertFired.session_danger = true;
        alertFired.session_warn = true;
    } else if (sessionPct >= warnThreshold) {
        alertFired.session_warn = true;
    }

    if (weeklyPct >= dangerThreshold) {
        alertFired.weekly_danger = true;
        alertFired.weekly_warn = true;
    } else if (weeklyPct >= warnThreshold) {
        alertFired.weekly_warn = true;
    }

    // Seed the combined blocked flag the same way — if either is already at 100%
    // when the app launches, don't fire "limit reached" immediately.
    if (sessionPct >= 100 || weeklyPct >= 100) {
        alertFired.blocked = true;
    }
}

function refreshTimers() {
    if (!latestUsageData) return;

    const settings = window._cachedSettings || {};
    const timeFormat = settings.timeFormat || '12h';
    const weeklyDateFormat = settings.weeklyDateFormat || 'date';

    // Session data
    const sessionUtilization = latestUsageData.five_hour?.utilization || 0;
    const sessionResetsAt = latestUsageData.five_hour?.resets_at;

    // Check if session timer has expired and we need to refresh
    if (sessionResetsAt) {
        const sessionDiff = new Date(sessionResetsAt) - new Date();
        if (sessionDiff <= 0 && !sessionResetTriggered) {
            sessionResetTriggered = true;
            debugLog('Session timer expired, triggering refresh...');
            // Wait a few seconds for the server to update, then refresh
            setTimeout(() => {
                fetchUsageData();
                checkForUpdate();
            }, 3000);
        } else if (sessionDiff > 0) {
            sessionResetTriggered = false; // Reset flag when timer is active again
        }
    }

    updateProgressBar(
        elements.sessionProgress,
        elements.sessionPercentage,
        sessionUtilization
    );

    updateTimer(
        elements.sessionTimer,
        elements.sessionTimeText,
        sessionResetsAt,
        5 * 60 // 5 hours in minutes
    );
    elements.sessionResetsAt.textContent = formatResetsAt(sessionResetsAt, false, timeFormat, weeklyDateFormat);
    elements.sessionResetsAt.style.opacity = sessionResetsAt ? '1' : '0.4';

    // Weekly data
    const weeklyUtilization = latestUsageData.seven_day?.utilization || 0;
    const weeklyResetsAt = latestUsageData.seven_day?.resets_at;

    // Check if weekly timer has expired and we need to refresh
    if (weeklyResetsAt) {
        const weeklyDiff = new Date(weeklyResetsAt) - new Date();
        if (weeklyDiff <= 0 && !weeklyResetTriggered) {
            weeklyResetTriggered = true;
            debugLog('Weekly timer expired, triggering refresh...');
            setTimeout(() => {
                fetchUsageData();
            }, 3000);
        } else if (weeklyDiff > 0) {
            weeklyResetTriggered = false;
        }
    }

    updateProgressBar(
        elements.weeklyProgress,
        elements.weeklyPercentage,
        weeklyUtilization,
        true
    );

    updateTimer(
        elements.weeklyTimer,
        elements.weeklyTimeText,
        weeklyResetsAt,
        7 * 24 * 60 // 7 days in minutes
    );
    elements.weeklyResetsAt.textContent = formatResetsAt(weeklyResetsAt, true, timeFormat, weeklyDateFormat);
    elements.weeklyResetsAt.style.opacity = weeklyResetsAt ? '1' : '0.4';

    // Fable — a weekly-scoped limit, so it reuses the weekly formatting and
    // window length. Only accounts with the limit have data.seven_day_fable
    // (normalized in main.js by src/normalize-usage-limits.js), so the row
    // stays hidden otherwise and the window shrinks back accordingly.
    const fable = latestUsageData.seven_day_fable;
    elements.fableSection.style.display = fable ? '' : 'none';
    if (fable) {
        const fableResetsAt = fable.resets_at;
        updateProgressBar(
            elements.fableProgress,
            elements.fablePercentage,
            fable.utilization || 0,
            true
        );
        updateTimer(
            elements.fableTimer,
            elements.fableTimeText,
            fableResetsAt,
            7 * 24 * 60 // 7 days in minutes
        );
        elements.fableResetsAt.textContent = formatResetsAt(fableResetsAt, true, timeFormat, weeklyDateFormat);
        elements.fableResetsAt.style.opacity = fableResetsAt ? '1' : '0.4';
    }
}

function startCountdown() {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
        refreshTimers();
        if (isExpanded) refreshExtraTimers();
    }, 30000);
}

// Update progress bar
function updateProgressBar(progressElement, percentageElement, value, isWeekly = false) {
    const percentage = Math.min(Math.max(value, 0), 100);

    progressElement.style.width = `${percentage}%`;
    percentageElement.textContent = `${Math.round(percentage)}%`;

    progressElement.classList.remove('warning', 'danger');
    if (percentage >= dangerThreshold) {
        progressElement.classList.add('danger');
    } else if (percentage >= warnThreshold) {
        progressElement.classList.add('warning');
    }
}

// Format reset date for the "Resets At" column
// Session: shows time like "3:59 PM" or "15:59"
// Weekly: shows date like "Mar 13", "Fri Mar 13", or "Fri Mar 13 3:59 PM"
function formatResetsAt(resetsAt, isWeekly, timeFormat, weeklyDateFormat) {
    if (!resetsAt) return '—';
    const date = new Date(resetsAt);
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    const formatTime = (d) => {
        if (timeFormat === '24h') {
            return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
        } else {
            let hours = d.getHours();
            const minutes = d.getMinutes().toString().padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12 || 12;
            return `${hours}:${minutes} ${ampm}`;
        }
    };

    if (isWeekly) {
        const dayStr = days[date.getDay()];
        const monthStr = months[date.getMonth()];
        const dayNum = date.getDate();
        const fmt = weeklyDateFormat || 'date';
        if (fmt === 'date-day') return `${dayStr} ${monthStr} ${dayNum}`;
        if (fmt === 'date-day-time') return `${dayStr} ${monthStr} ${dayNum} ${formatTime(date)}`;
        return `${monthStr} ${dayNum}`; // default: 'date'
    } else {
        return formatTime(date);
    }
}

// Update circular timer
function updateTimer(timerElement, textElement, resetsAt, totalMinutes) {
    if (!resetsAt) {
        textElement.textContent = 'Not started';
        textElement.style.opacity = '0.4';
        textElement.style.fontSize = '10px';
        textElement.title = 'Starts when a message is sent';
        timerElement.style.strokeDashoffset = 63;
        return;
    }

    // Clear the greyed out styling when timer is active
    textElement.style.opacity = '1';
    textElement.style.fontSize = '';
    textElement.title = '';

    const resetDate = new Date(resetsAt);
    const now = new Date();
    const diff = resetDate - now;

    if (diff <= 0) {
        textElement.textContent = 'Resetting...';
        timerElement.style.strokeDashoffset = 0;
        return;
    }

    // Calculate remaining time
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    // const seconds = Math.floor((diff % (1000 * 60)) / 1000); // Optional seconds

    // Format time display
    if (hours >= 24) {
        const days = Math.floor(hours / 24);
        const remainingHours = hours % 24;
        textElement.textContent = `${days}d ${remainingHours}h`;
    } else if (hours > 0) {
        textElement.textContent = `${hours}h ${minutes}m`;
    } else {
        textElement.textContent = `${minutes}m`;
    }

    // Calculate progress (elapsed percentage)
    const totalMs = totalMinutes * 60 * 1000;
    const elapsedMs = totalMs - diff;
    const elapsedPercentage = (elapsedMs / totalMs) * 100;

    // Update circle (63 is ~2*pi*10)
    const circumference = 63;
    const offset = circumference - (elapsedPercentage / 100) * circumference;
    timerElement.style.strokeDashoffset = offset;

    // Update color based on time remaining until reset — hardcoded thresholds,
    // intentionally independent of the usage warnThreshold/dangerThreshold
    // settings (see ELAPSED_AMBER_THRESHOLD/ELAPSED_GREEN_THRESHOLD above).
    timerElement.classList.remove('elapsed-warn', 'elapsed-soon');
    if (elapsedPercentage >= ELAPSED_GREEN_THRESHOLD) {
        timerElement.classList.add('elapsed-soon');
    } else if (elapsedPercentage >= ELAPSED_AMBER_THRESHOLD) {
        timerElement.classList.add('elapsed-warn');
    }
}

// UI State Management
function showLoginRequired() {
    elements.loadingContainer.style.display = 'none';
    elements.loginContainer.style.display = 'flex';
    elements.noUsageContainer.style.display = 'none';
    elements.mainContent.style.display = 'none';
    // Reset to step 1
    elements.loginStep1.style.display = 'flex';
    elements.loginStep2.style.display = 'none';
    elements.sessionKeyError.textContent = '';
    elements.sessionKeyInput.value = '';
    // Close any open overlays
    elements.settingsOverlay.style.display = 'none';
    elements.compactSettingsOverlay.style.display = 'none';
    // Hide header buttons during login
    elements.settingsBtn.style.display = 'none';
    elements.refreshBtn.style.display = 'none';
    elements.graphBtn.style.display = 'none';
    stopAutoUpdate();
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    // Reset fetch guard so it can't get permanently stuck across login/logout
    isFetching = false;
    // Reset alert state so a new session doesn't inherit suppressed alerts
    isFirstDataLoad = true;
    alertFired.session_warn = false;
    alertFired.session_danger = false;
    alertFired.weekly_warn = false;
    alertFired.weekly_danger = false;
    // Resize window to fit login content — without this the window stays at
    // the default 155px widget height and the "Log in"/"Manual" buttons are
    // clipped off-screen and unreachable on a frameless, non-resizable window.
    window.electronAPI.resizeWindow(360, PANEL_WIDTH);
}

function showMainContent() {
    elements.loadingContainer.style.display = 'none';
    elements.loginContainer.style.display = 'none';
    elements.noUsageContainer.style.display = 'none';
    // Respect compact mode — don't force mainContent visible if we're in compact
    if (!isCompactMode) {
        elements.mainContent.style.display = 'block';
    }
    elements.compactContent.style.display = isCompactMode ? 'flex' : 'none';
    // Always show collapse chevron here — applyCompactMode hides it when needed
    if (elements.compactCollapseBtn) {
        elements.compactCollapseBtn.style.display = isCompactMode ? 'none' : 'flex';
    }
    // Restore header buttons after login - but respect compact mode for graph button
    elements.settingsBtn.style.display = 'flex';
    elements.refreshBtn.style.display = 'flex';
    elements.graphBtn.style.display = isCompactMode ? 'none' : 'flex';
}

// Auto-update management
function startAutoUpdate() {
    stopAutoUpdate();
    const settings = window._cachedSettings || {};
    const intervalSecs = parseInt(settings.refreshInterval) || 300;
    updateInterval = setInterval(async () => {
        if (elements.refreshBtn) elements.refreshBtn.classList.add('spinning');
        await fetchUsageData();
        if (elements.refreshBtn) elements.refreshBtn.classList.remove('spinning');
    }, intervalSecs * 1000);
}

function stopAutoUpdate() {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
}

async function loadChart() {
    const history = await window.electronAPI.getUsageHistory();
    if (!history.length) return;
    renderChart(history);
}

function renderChart(history) {
    if (usageChart) usageChart.destroy();

    const showSonnet = isExpanded && !!latestUsageData?.seven_day_sonnet;
    const showOpus = isExpanded && !!latestUsageData?.seven_day_opus;
    // Not gated on isExpanded, unlike the rows around it: Fable is a primary
    // row now, always on screen, so its line belongs in the graph whenever the
    // account has the limit — same rule as Session and Weekly below.
    const showFable = !!latestUsageData?.seven_day_fable;
    const showCowork = isExpanded && !!latestUsageData?.seven_day_cowork;
    const showDesign = isExpanded && !!latestUsageData?.seven_day_omelette;
    const showOAuthApps = isExpanded && !!latestUsageData?.seven_day_oauth_apps;
    const showExtraUsage = isExpanded && !!latestUsageData?.extra_usage;
    const allValues = history.flatMap((entry) => {
        const values = [entry.session, entry.weekly];
        if (showSonnet) values.push(entry.sonnet || 0);
        if (showOpus) values.push(entry.opus || 0);
        if (showFable) values.push(entry.fable || 0);
        if (showCowork) values.push(entry.cowork || 0);
        if (showDesign) values.push(entry.design || 0);
        if (showOAuthApps) values.push(entry.oauthApps || 0);
        if (showExtraUsage) values.push(entry.extraUsage || 0);
        return values;
    });
    const yMax = Math.max(10, Math.ceil(Math.max(...allValues) / 10) * 10);

    const datasets = [
        {
            label: 'Session',
            data: history.map((entry) => ({ x: entry.timestamp, y: entry.session })),
            borderColor: '#8b5cf6',
            backgroundColor: 'transparent',
            borderWidth: 2,
            stepped: true,
            pointRadius: 0,
            pointHoverRadius: 3,
            pointHitRadius: 10
        },
        {
            label: 'Weekly',
            data: history.map((entry) => ({ x: entry.timestamp, y: entry.weekly })),
            borderColor: '#3b82f6',
            backgroundColor: 'transparent',
            borderWidth: 2,
            stepped: true,
            pointRadius: 0,
            pointHoverRadius: 3,
            pointHitRadius: 10
        }
    ];

    if (showSonnet) {
        const sonnetData = history.map((entry) => entry.sonnet || 0);
        if (sonnetData.some((value) => value > 0)) {
            datasets.push({
                label: 'Sonnet',
                data: history.map((entry) => ({ x: entry.timestamp, y: entry.sonnet || 0 })),
                borderColor: '#f43f5e',
                backgroundColor: 'transparent',
                borderWidth: 2,
                stepped: true,
                pointRadius: 0,
                pointHoverRadius: 3,
                pointHitRadius: 10
            });
        }
    }

    if (showOpus) {
        const opusData = history.map((entry) => entry.opus || 0);
        if (opusData.some((value) => value > 0)) {
            datasets.push({
                label: 'Opus',
                data: history.map((entry) => ({ x: entry.timestamp, y: entry.opus || 0 })),
                borderColor: '#f59e0b',
                backgroundColor: 'transparent',
                borderWidth: 2,
                stepped: true,
                pointRadius: 0,
                pointHoverRadius: 3,
                pointHitRadius: 10
            });
        }
    }

    if (showFable) {
        const fableData = history.map((entry) => entry.fable || 0);
        if (fableData.some((value) => value > 0)) {
            datasets.push({
                label: 'Fable',
                data: history.map((entry) => ({ x: entry.timestamp, y: entry.fable || 0 })),
                borderColor: '#d946ef',
                backgroundColor: 'transparent',
                borderWidth: 2,
                stepped: true,
                pointRadius: 0,
                pointHoverRadius: 3,
                pointHitRadius: 10
            });
        }
    }

    if (showCowork) {
        const coworkData = history.map((entry) => entry.cowork || 0);
        if (coworkData.some((value) => value > 0)) {
            datasets.push({
                label: 'Cowork',
                data: history.map((entry) => ({ x: entry.timestamp, y: entry.cowork || 0 })),
                borderColor: '#06b6d4',
                backgroundColor: 'transparent',
                borderWidth: 2,
                stepped: true,
                pointRadius: 0,
                pointHoverRadius: 3,
                pointHitRadius: 10
            });
        }
    }

    if (showDesign) {
        const designData = history.map((entry) => entry.design || 0);
        if (designData.some((value) => value > 0)) {
            datasets.push({
                label: 'Design',
                data: history.map((entry) => ({ x: entry.timestamp, y: entry.design || 0 })),
                borderColor: '#92400e',
                backgroundColor: 'transparent',
                borderWidth: 2,
                stepped: true,
                pointRadius: 0,
                pointHoverRadius: 3,
                pointHitRadius: 10
            });
        }
    }

    if (showOAuthApps) {
        const oauthAppsData = history.map((entry) => entry.oauthApps || 0);
        if (oauthAppsData.some((value) => value > 0)) {
            datasets.push({
                label: 'OAuth Apps',
                data: history.map((entry) => ({ x: entry.timestamp, y: entry.oauthApps || 0 })),
                borderColor: '#f97316',
                backgroundColor: 'transparent',
                borderWidth: 2,
                stepped: true,
                pointRadius: 0,
                pointHoverRadius: 3,
                pointHitRadius: 10
            });
        }
    }

    if (showExtraUsage) {
        const extraUsageData = history.map((entry) => entry.extraUsage || 0);
        if (extraUsageData.some((value) => value > 0)) {
            datasets.push({
            label: 'Extra Usage',
            data: history.map((entry) => ({ x: entry.timestamp, y: entry.extraUsage || 0 })),
            borderColor: '#f59e0b',
            backgroundColor: 'transparent',
            borderWidth: 2,
            stepped: true,
            pointRadius: 0,
            pointHoverRadius: 3,
            pointHitRadius: 10
            });
        }
    }

    const firstDayMidnight = new Date(history[0].timestamp);
    firstDayMidnight.setHours(0, 0, 0, 0);

    usageChart = new Chart(elements.usageChart.getContext('2d'), {
        type: 'line',
        data: { datasets },
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'nearest'
            },
            scales: {
                x: {
                    type: 'linear',
                    min: firstDayMidnight.getTime(),
                    max: history[history.length - 1].timestamp,
                    afterBuildTicks(axis) {
                        const end = history[history.length - 1].timestamp;
                        const d = new Date(firstDayMidnight.getTime());
                        const ticks = [];
                        while (d.getTime() <= end) {
                            ticks.push({ value: d.getTime() });
                            d.setDate(d.getDate() + 1);
                        }
                        axis.ticks = ticks;
                    },
                    ticks: {
                        maxRotation: 0,
                        minRotation: 0,
                        font: {
                            size: 10
                        },
                        callback(value) {
                            const tf = (window._cachedSettings || {}).timeFormat || '12h';
                            const spanMs = history.length > 1
                                ? history[history.length - 1].timestamp - history[0].timestamp
                                : 0;
                            return formatTimestampTick(value, spanMs, tf);
                        }
                    },
                    grid: {
                        display: false
                    }
                },
                y: {
                    min: 0,
                    max: yMax,
                    ticks: {
                        font: {
                            size: 10
                        },
                        callback: (value) => `${value}%`
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        title(items) {
                            return new Date(items[0].parsed.x).toLocaleString([], {
                                month: 'short',
                                day: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit'
                            });
                        },
                        label(item) {
                            return `${item.dataset.label}: ${Math.round(item.parsed.y)}%`;
                        }
                    }
                }
            }
        }
    });
}

function formatTimestampTick(timestamp, spanMs, timeFormat) {
    const date = new Date(timestamp);
    const hour12 = (timeFormat || '12h') !== '24h';

    if (spanMs < 12 * 60 * 60 * 1000) {
        return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12 });
    }
    if (spanMs < 48 * 60 * 60 * 1000) {
        return date.toLocaleString([], { weekday: 'short', hour: 'numeric', hour12 });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Add spinning animation for refresh button
const style = document.createElement('style');
style.textContent = `
    @keyframes spin-refresh {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
    
    .refresh-btn.spinning svg {
        animation: spin-refresh 1s linear infinite;
    }
`;
document.head.appendChild(style);

// Settings management
let warnThreshold = 75;
let dangerThreshold = 90;

async function loadSettings() {
    const settings = await window.electronAPI.getSettings();
    const isLinux = window.electronAPI.platform === 'linux';
    const isPortable = window.electronAPI.isPortable;
    const autoStartUnsupported = isLinux || isPortable;

    elements.autoStartToggle.checked = autoStartUnsupported ? false : settings.autoStart;
    elements.autoStartToggle.disabled = autoStartUnsupported;
    if (elements.autoStartCol) {
        elements.autoStartCol.classList.toggle('settings-col-disabled', autoStartUnsupported);
    }
    if (elements.autoStartHint) {
        elements.autoStartHint.style.display = autoStartUnsupported ? 'inline' : 'none';
        elements.autoStartHint.textContent = isPortable
            ? 'Not supported in portable mode!'
            : 'Not supported on Linux';
    }
    elements.minimizeToTrayToggle.checked = settings.minimizeToTray;
    elements.alwaysOnTopToggle.checked = settings.alwaysOnTop;
    elements.showTrayStatsToggle.checked = settings.showTrayStats || false;
    elements.warnThreshold.value = settings.warnThreshold;
    elements.dangerThreshold.value = settings.dangerThreshold;
    elements.timeFormat.value = settings.timeFormat || '12h';
    elements.weeklyDateFormat.value = settings.weeklyDateFormat || 'date';
    if (elements.refreshInterval) elements.refreshInterval.value = settings.refreshInterval || '300';
    elements.usageAlertsToggle.checked = settings.usageAlerts !== false;
    if (elements.compactModeToggle) elements.compactModeToggle.checked = !!settings.compactMode;

    // Populate org selector if user has organizations
    if (credentials.organizations && credentials.organizations.length > 0) {
        populateOrgSelector(credentials.organizations, credentials.organizationId);
    }

    warnThreshold = settings.warnThreshold;
    dangerThreshold = settings.dangerThreshold;

    // Re-apply, then seed the controls from the values that actually took
    // effect — both resolvers fall back to the defaults for anything missing or
    // malformed, so the controls can't show a setting the app isn't using.
    const layout = applyLayout(settings);
    if (elements.density) elements.density.value = layout.density;
    if (elements.showResetsAtToggle) elements.showResetsAtToggle.checked = layout.showResetsAt;
    if (elements.showSessionContextToggle) elements.showSessionContextToggle.checked = layout.showSessionContext;
    if (elements.sessionContextWindow) elements.sessionContextWindow.value = String(layout.sessionContextWindow);

    syncElapsedControls(applyElapsedRingColors(settings));

    elements.themeBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === settings.theme);
    });

    applyTheme(settings.theme);
    if (window.electronAPI.platform === 'darwin') {
        document.getElementById('trayLabel').textContent = 'Hide from Dock';
    }
}

async function saveSettings() {
    const activeThemeBtn = document.querySelector('.theme-btn.active');
    const warn = parseInt(elements.warnThreshold.value) || 75;
    const danger = parseInt(elements.dangerThreshold.value) || 90;

    warnThreshold = warn;
    dangerThreshold = danger;

    // Apply compact mode change first, then include in saved settings
    const compactToggleValue = elements.compactModeToggle.checked;
    if (compactToggleValue !== isCompactMode) {
        applyCompactMode(compactToggleValue);
    }

    const settings = {
        autoStart: (window.electronAPI.platform === 'linux' || window.electronAPI.isPortable) ? false : elements.autoStartToggle.checked,
        minimizeToTray: elements.minimizeToTrayToggle.checked,
        alwaysOnTop: elements.alwaysOnTopToggle.checked,
        showTrayStats: elements.showTrayStatsToggle.checked,
        theme: activeThemeBtn ? activeThemeBtn.dataset.theme : 'dark',
        warnThreshold: warn,
        dangerThreshold: danger,
        timeFormat: elements.timeFormat.value || '12h',
        weeklyDateFormat: elements.weeklyDateFormat.value || 'date',
        refreshInterval: elements.refreshInterval ? (elements.refreshInterval.value || '300') : '300',
        usageAlerts: elements.usageAlertsToggle.checked,
        compactMode: isCompactMode,
        graphVisible: graphVisible,
        expandedOpen: isExpanded,
        ...readLayoutInputs(),
        ...readElapsedInputs()
    };
    await window.electronAPI.saveSettings(settings);
    window._cachedSettings = settings;
    applyTheme(settings.theme);
    applyLayout(settings);
    applyElapsedRingColors(settings);
    if (window.electronAPI.platform === 'darwin') {
        document.getElementById('trayLabel').textContent = 'Hide from Dock';
    }

    // Re-render resets-at values immediately with new format
    if (latestUsageData) {
        refreshTimers();
        // Rebuild extra rows to apply new threshold colors
        if (isExpanded) {
            buildExtraRows(latestUsageData);
            refreshExtraTimers();
        }
    }
    // Restart auto-update with new interval if it changed
    startAutoUpdate();
}

function applyTheme(theme) {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const useDark = theme === 'dark' || (theme === 'system' && prefersDark);
    document.body.classList.toggle('theme-light', !useDark);
}

// Layout settings, applied the same way as the theme: a class on <body> that
// swaps the metrics in styles.css. Returns the values that actually took
// effect, so callers can seed the controls without re-deriving the fallbacks.
function applyLayout(settings = {}) {
    const density = DENSITY_MODES.includes(settings.density) ? settings.density : DEFAULT_DENSITY;
    const showResetsAt = typeof settings.showResetsAt === "boolean" ? settings.showResetsAt : DEFAULT_SHOW_RESETS_AT;

    for (const mode of DENSITY_MODES) {
        // 'comfortable' has no class — it is what :root already declares.
        document.body.classList.toggle(`density-${mode}`, mode !== 'comfortable' && mode === density);
    }
    document.body.classList.toggle('hide-resets-at', !showResetsAt);
    activeDensity = density;

    // The panel is shown/hidden directly rather than by a body class, because
    // its width also has to be added to measuredWidth() and read back from the
    // laid-out element — see contextPanelWidth().
    showSessionContext = typeof settings.showSessionContext === 'boolean'
        ? settings.showSessionContext
        : DEFAULT_SHOW_SESSION_CONTEXT;
    const storedWindow = Number(settings.sessionContextWindow);
    sessionContextWindow = Number.isFinite(storedWindow) && storedWindow > 0
        ? storedWindow
        : DEFAULT_SESSION_CONTEXT_WINDOW;
    renderSessionContext();

    return { density, showResetsAt, showSessionContext, sessionContextWindow };
}

// Current layout control values, in the shape applyLayout() expects. Falls back
// to the defaults for any control that is missing, so the Settings overlay not
// being built yet cannot blank a stored setting.
function readLayoutInputs() {
    return {
        density: elements.density ? elements.density.value : DEFAULT_DENSITY,
        showResetsAt: elements.showResetsAtToggle
            ? elements.showResetsAtToggle.checked
            : DEFAULT_SHOW_RESETS_AT,
        showSessionContext: elements.showSessionContextToggle
            ? elements.showSessionContextToggle.checked
            : DEFAULT_SHOW_SESSION_CONTEXT,
        sessionContextWindow: elements.sessionContextWindow
            ? Number(elements.sessionContextWindow.value)
            : DEFAULT_SESSION_CONTEXT_WINDOW
    };
}

// Current ring-staging control values, in the shape resolveElapsedPrefs()
// expects. Falls back to the defaults for any control that is missing or
// holding something unparseable.
function readElapsedInputs() {
    return {
        elapsedColorMode: elements.elapsedColorMode ? elements.elapsedColorMode.value : DEFAULT_ELAPSED_MODE,
        elapsedWarnPercent: elements.elapsedWarnPercent ? elements.elapsedWarnPercent.value : DEFAULT_ELAPSED_WARN_PERCENT,
        elapsedSoonPercent: elements.elapsedSoonPercent ? elements.elapsedSoonPercent.value : DEFAULT_ELAPSED_SOON_PERCENT
    };
}

// Seed the ring-staging controls from the values that actually took effect, so
// they can't show a setting the app isn't using. "Shift by" is hidden for
// Original and Off, which don't shift anything — with visibility rather than
// display, so the row keeps its height and the panel doesn't jump (and
// SETTINGS_HEIGHT stays one number) as the mode changes.
function syncElapsedControls(prefs) {
    if (elements.elapsedColorMode) elements.elapsedColorMode.value = prefs.mode;
    if (elements.elapsedWarnPercent) elements.elapsedWarnPercent.value = prefs.warnPercent;
    if (elements.elapsedSoonPercent) elements.elapsedSoonPercent.value = prefs.soonPercent;
    if (elements.elapsedPercentCol) {
        const shifts = prefs.mode === 'lighten' || prefs.mode === 'darken';
        elements.elapsedPercentCol.style.visibility = shifts ? '' : 'hidden';
    }
    return prefs;
}

// Update check
async function checkForUpdate() {
    try {
        const result = await window.electronAPI.checkForUpdate();
        if (!result.hasUpdate) return;

        const version = result.version;

        // Show banner and resize to compensate. resizeWidget() is normal-mode
        // only (it hardcodes WIDGET_WIDTH via the resize-window IPC channel),
        // so in compact mode re-assert compact bounds instead — main.js's
        // getCompactHeight() already accounts for the banner via
        // updateBannerVisible, set in the same check-for-update call above.
        elements.updateBannerText.textContent = `▲  Version ${version} available — click to download`;
        elements.updateBanner.style.display = 'flex';
        if (isCompactMode) {
            window.electronAPI.setCompactMode(true);
        } else {
            resizeWidget(true);
        }

        // Populate settings panel link if already visible
        if (elements.settingsUpdateLink) {
            elements.settingsUpdateLink.textContent = `→ v${version} available`;
            elements.settingsUpdateLink.style.display = 'inline';
        }

        debugLog(`Update available: v${version}`);
    } catch (e) {
        debugLog('Update check failed silently', e);
    }
}

// Start the application
init();
window.addEventListener('beforeunload', () => {
    stopAutoUpdate();
    if (countdownInterval) clearInterval(countdownInterval);
});
