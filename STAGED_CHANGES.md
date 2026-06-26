# Staged Changes

Changes accumulating here have already been merged into `develop`.
We keep track of these changes/fixes/features and when we have enough for a new release we decide on the next version number.

This file is tracked in the repo and visible to everyone.

---

## Branches Staged

| Branch | Description |
|--------|-------------|
| `fix/ci-actions-node20` | Bump actions/checkout and actions/setup-node to v5; Node.js matrix 18→20 |
| `feature/profile-flag` | Add `--profile=<name>` flag for isolated multi-account sessions |
| `feature/blocked-available-notifications` | Notify on full block (session or weekly at 100%) and on genuine availability; fix danger notifications firing past 100%; clarify warn/danger wording |
| `fix/offscreen-window-recovery` | Recover from a saved window position that's off-screen after a monitor configuration change; centers the window instead of leaving it unreachable |
| `fix/center-app-recovery` | Live off-screen window recovery on tray/taskbar click (no menu needed); fix app getting stuck running invisibly with no recovery path when closing/minimizing while Tray Stats is off |
| `fix/quit-flag` | Fix "Exit" tray menu item not actually quitting when Tray Stats is on (regression from `fix/center-app-recovery`'s close-to-tray handler) |

---

## Changes

- **Multi-account support (power-user flag):** Launching with `--profile=<name>` isolates the instance to its own userData subfolder, giving it a completely separate Electron session, cookies, and settings. Enables two accounts to run side-by-side without interfering. Works for both installed and portable builds.

- **Blocked/available notifications (Discussion #85):** Notifies once usage is fully blocked — session or weekly hits 100% — and again when it's genuinely available. A single combined flag spans both windows, so a session reset never falsely reports "available again" while the weekly limit is still maxed out. Also fixes the existing danger-threshold notification firing past 100% with stale wording, and clarifies tier wording to "usage is low" / "usage is extremely low".

- **Off-screen window recovery (Issue #94):** On startup, the saved window position is now checked against all currently connected displays. If it falls entirely outside every display's work area — for example after switching from an ultrawide to a laptop-only setup — the window centers itself on the primary display instead of launching invisibly with no way to recover it.

- **Live off-screen recovery, no menu needed (Issue #94 follow-up):** The same on-screen check now also runs on tray click, taskbar left-click, restore, and focus — not just at startup. If a monitor setup changes while the app is already running, the very first click on the tray icon or taskbar brings it back on-screen immediately. A valid custom position is left untouched either way.

- **Fixed: app could get stuck running invisibly with no way back:** With Tray Stats off (no tray icon), closing the window via the taskbar's native "Close window" — or the in-app close button — used to just hide the window. With no tray icon and no taskbar entry left, the app kept running in the background with no way to bring it back short of Task Manager. Close now actually quits the app in that case. Minimize got the same fix: "hide from taskbar" only hides if a tray icon exists to recover through; otherwise it falls back to a normal, taskbar-recoverable minimize.

- **Fixed: "Exit" silently did nothing with Tray Stats on:** `app.quit()` closes windows as part of its normal sequence, which fires the same `'close'` event the hide-to-tray handler above listens for — so Exit was getting caught by its own fix and just hiding instead of quitting. A flag set on `'before-quit'` (which fires before any window closes, on every quit path) now lets the close handler tell a real quit apart from a click on the close button.

*Add new entries above this line as additional branches are staged.*
