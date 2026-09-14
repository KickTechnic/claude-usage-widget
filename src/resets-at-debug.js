'use strict';

// Temporary diagnostic for T4 (.claude/memory/ToDo.md) — the weekly reset time
// reads wrong specifically 9-10am Sundays BST, correct the rest of the week.
// updateTimer() in app.js is a pure `resetDate - now` epoch-ms diff with no
// day/hour branch, so it cannot structurally explain a fault confined to one
// hour a week — which points at the fetched `resets_at` value itself being
// wrong at that moment, not this codebase's display math. This logs the raw
// value so the next Sunday occurrence leaves evidence.
//
// DELETE THIS FILE, its call site in main.js, and the `resetsAtDebugLog` store
// key once T4 is diagnosed — this is instrumentation, not a feature.
//
// Pure functions, no Electron import: testable with plain `node -e`, the same
// way normalize-usage-limits.js and session-context.js are.

// Sunday 08:30-10:30 local, not just "9-10" — margin either side of the
// reported fault so the transition into and out of it is visible too. Local
// getDay()/getHours(), the same getters formatResetsAt() already uses in
// app.js, so this window tracks BST/GMT exactly as the display does.
const CAPTURE_DAY = 0; // Sunday
const CAPTURE_START_MINUTES = 8 * 60 + 30; // 08:30
const CAPTURE_END_MINUTES = 10 * 60 + 30; // 10:30, exclusive

/**
 * Whether `date` falls inside the capture window. Exported as a pure function
 * so the boundary can be swept with constructed Date objects rather than
 * waiting for a real Sunday.
 */
function shouldCapture(date) {
  if (date.getDay() !== CAPTURE_DAY) return false;
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes >= CAPTURE_START_MINUTES && minutes < CAPTURE_END_MINUTES;
}

/**
 * Minutes from `fromDate` until `isoString`, or null if either is missing —
 * the number formatResetsAt()/updateTimer() derive the countdown from,
 * captured directly so a jump is visible without recomputing it later.
 */
function diffMinutes(isoString, fromDate) {
  if (!isoString) return null;
  const target = new Date(isoString);
  if (Number.isNaN(target.getTime())) return null;
  return (target.getTime() - fromDate.getTime()) / 60000;
}

/**
 * One log entry from a fetch's normalized `data` and the capture instant.
 * `resets_at` values are stored RAW and unmodified — the point is seeing
 * exactly what the API sent, not a reinterpretation of it.
 */
function buildEntry(data, date) {
  const fiveHourResetsAt = data?.five_hour?.resets_at ?? null;
  const sevenDayResetsAt = data?.seven_day?.resets_at ?? null;
  return {
    epochMs: date.getTime(),
    // Includes the resolved zone abbreviation and offset directly, e.g.
    // "Sun Sep 20 2026 09:15:00 GMT+0100 (British Summer Time)" — the same
    // rendering used to manually confirm the pipeline earlier in this
    // investigation.
    localString: date.toString(),
    isoUtc: date.toISOString(),
    resolvedTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    // Catches a V8/ICU-side anomaly in the process's own idea of the offset,
    // not just a bad API value.
    tzOffsetMinutes: date.getTimezoneOffset(),
    fiveHourResetsAt,
    fiveHourDiffMinutes: diffMinutes(fiveHourResetsAt, date),
    sevenDayResetsAt,
    sevenDayDiffMinutes: diffMinutes(sevenDayResetsAt, date),
  };
}

/**
 * Keep the newest `maxEntries`, mirroring storeUsageHistory()'s cap in
 * main.js. The 2-hour window already bounds growth under a typical refresh
 * interval; this is the backstop against the fastest one (15s).
 */
function pruneLog(log, maxEntries) {
  if (!Array.isArray(log)) return [];
  if (log.length <= maxEntries) return log;
  return log.slice(log.length - maxEntries);
}

module.exports = { shouldCapture, buildEntry, pruneLog, diffMinutes };
