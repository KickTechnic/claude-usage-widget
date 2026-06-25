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

---

## Changes

- **Multi-account support (power-user flag):** Launching with `--profile=<name>` isolates the instance to its own userData subfolder, giving it a completely separate Electron session, cookies, and settings. Enables two accounts to run side-by-side without interfering. Works for both installed and portable builds.

- **Blocked/available notifications (Discussion #85):** Notifies once usage is fully blocked — session or weekly hits 100% — and again when it's genuinely available. A single combined flag spans both windows, so a session reset never falsely reports "available again" while the weekly limit is still maxed out. Also fixes the existing danger-threshold notification firing past 100% with stale wording, and clarifies tier wording to "usage is low" / "usage is extremely low".

- **Off-screen window recovery (Issue #94):** On startup, the saved window position is now checked against all currently connected displays. If it falls entirely outside every display's work area — for example after switching from an ultrawide to a laptop-only setup — the window centers itself on the primary display instead of launching invisibly with no way to recover it.

*Add new entries above this line as additional branches are staged.*
