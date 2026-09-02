'use strict';

// Reads context-window occupancy for the most recently used Claude Code
// sessions, from Claude Code's own transcripts on disk.
//
// The claude.ai usage API this widget is otherwise built on has nothing of the
// kind — it reports rate limits (five_hour, seven_day_*), and "session" there
// means the 5-hour limit window, not a conversation. This is a second,
// local-only data source, deliberately kept in its own module so main.js takes
// only the IPC handler and the fork's rebase diff stays small.
//
// Two things about the on-disk layout are load-bearing, both measured rather
// than assumed:
//
// 1. ONLY depth-2 files are sessions. projects/<encoded-cwd>/<uuid>.jsonl is a
//    session; everything deeper is an agent transcript
//    (<uuid>/subagents/agent-*.jsonl, and .../workflows/<id>/agent-*.jsonl).
//    On the machine this was written against that is 326 sessions against 1112
//    agent transcripts, and agent files are very often the newest thing on
//    disk — so recursing would fill "most recent" with subagents.
//
// 2. Transcripts CANNOT be read whole. That same tree is 2.3 GB with a 68.6 MB
//    largest file. Only the tail of the few files actually being reported is
//    read, which makes the cost independent of transcript size: ~20 ms for a
//    stat of every session plus a tail read of three.

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_LIMIT = 3;

// Enough to hold the last assistant message plus a title record in every
// transcript sampled while developing this. On a miss the window grows rather
// than giving up, because a single line can be arbitrarily large (one big tool
// result), but it is capped so a pathological file cannot pull in 68 MB.
const TAIL_WINDOW = 256 * 1024;
const TAIL_CAP = 8 * 1024 * 1024;

/**
 * Claude Code's config directory. CLAUDE_CONFIG_DIR wins when set — it is a
 * supported override and is not necessarily under the home directory.
 */
function configRoot() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

/**
 * Every session transcript, with its mtime. Depth 2 only — see note 1 above.
 * Returns [] when Claude Code is not installed, which is the signal callers use
 * to hide the panel entirely.
 */
function listSessionFiles() {
  const root = path.join(configRoot(), 'projects');
  let projectDirs;
  try {
    projectDirs = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return []; // no Claude Code on this machine
  }

  const files = [];
  for (const dir of projectDirs) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(root, dir.name);
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      continue; // unreadable project dir — skip, don't fail the whole scan
    }
    for (const entry of entries) {
      // isFile() is what excludes the <uuid>/ directories holding agent
      // transcripts; nothing below this level is descended into.
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const filePath = path.join(dirPath, entry.name);
      try {
        files.push({ path: filePath, mtime: fs.statSync(filePath).mtimeMs });
      } catch {
        // vanished between readdir and stat
      }
    }
  }
  return files;
}

/**
 * Pull the fields we need out of the end of one transcript, without reading the
 * whole file. Parses complete JSONL lines from a tail window, keeping the last
 * of each record type — which, the window being the end of the file, is the
 * last in the file too.
 */
function tailScan(filePath) {
  let size;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    return null;
  }

  const found = { usage: null, model: null, cwd: null, customTitle: null, aiTitle: null };

  for (let window = TAIL_WINDOW; ; window *= 4) {
    const start = Math.max(0, size - window);
    let text;
    try {
      const fd = fs.openSync(filePath, 'r');
      try {
        const buf = Buffer.alloc(size - start);
        fs.readSync(fd, buf, 0, buf.length, start);
        text = buf.toString('utf8');
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return null;
    }

    const lines = text.split('\n');
    if (start > 0) lines.shift(); // first line is cut mid-record

    for (const line of lines) {
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue; // a partial or malformed line is not a reason to fail
      }
      if (record.cwd) found.cwd = record.cwd;
      if (record.type === 'custom-title' && record.customTitle) found.customTitle = record.customTitle;
      if (record.type === 'ai-title' && record.aiTitle) found.aiTitle = record.aiTitle;
      if (record.type === 'assistant' && record.message && record.message.usage) {
        found.usage = record.message.usage;
        found.model = record.message.model || null;
      }
    }

    // cwd is required — without it the row cannot be labelled.
    if ((found.usage && found.cwd) || start === 0 || window >= TAIL_CAP) return found;
  }
}

/**
 * Context occupancy for one turn: everything that was fed to the model.
 * Cached tokens count — they occupy the window exactly as fresh ones do.
 */
function contextTokens(usage) {
  if (!usage) return 0;
  return (usage.input_tokens || 0)
    + (usage.cache_creation_input_tokens || 0)
    + (usage.cache_read_input_tokens || 0);
}

/**
 * The most recently used sessions, newest first.
 *
 * @param {number} limit how many to return
 * @returns {Array<{cwd: string, label: string, title: string|null, tokens: number,
 *                  model: string|null, mtime: number}>}
 */
function readRecentSessions(limit = DEFAULT_LIMIT) {
  const files = listSessionFiles();
  if (!files.length) return [];

  files.sort((a, b) => b.mtime - a.mtime);

  const sessions = [];
  // Walk past candidates that turn out to be unreadable or to carry no
  // assistant turn yet (a session opened but never used), so a dud does not
  // cost a row. Bounded so a tree full of empty transcripts cannot turn this
  // into a full scan.
  const maxCandidates = Math.min(files.length, limit * 10);
  for (let i = 0; i < maxCandidates && sessions.length < limit; i++) {
    const file = files[i];
    const found = tailScan(file.path);
    if (!found || !found.cwd || !found.usage) continue;

    sessions.push({
      cwd: found.cwd,
      label: path.basename(found.cwd) || found.cwd,
      title: found.customTitle || found.aiTitle || null,
      tokens: contextTokens(found.usage),
      model: found.model,
      mtime: file.mtime,
    });
  }
  return sessions;
}

module.exports = { readRecentSessions, contextTokens, configRoot };
