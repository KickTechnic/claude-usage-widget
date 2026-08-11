# Memory index

Agent process-state for this fork. Load-on-demand — nothing here auto-loads except by explicit read. Human
documentation is a separate tier; see below.

## Agent memory (`.claude/memory/`)

| File | Holds |
|---|---|
| `00_Index.md` | This map. |
| `Lessons_Learned.md` | The **incident** behind each numbered lesson — what went wrong and how it was found. |
| `ToDo.md` | The open-work queue, plus guardrails and the verification playbook. Open work only. |

One queue file is right at this size. Split it by role (`Features.md`, `Tests_Agent.md`, `Tests_Screen.md`,
`Tests_Owner.md`, `Deferred.md`) once it passes ~250 lines or any one category passes ~10 items. `T`-numbers
are one global space and move with the item.

## Lessons — three homes, three contents

| Home | Holds | Loads |
|---|---|---|
| root `CLAUDE.md` | the **trigger** — when to look | always |
| `.claude/rules/<topic>.md` | the **rule** — what to do, and why it is true | only when a `paths:` glob matches |
| the lessons file above | the **incident** — the story behind it | on explicit read |

| § | Subject | Rule file |
|---|---|---|
| 1 | Window/panel heights must be measured in the running app | `rules/renderer-sizing.md` |
| 2 | A dropped feature can own a DOM id the kept feature needs | `rules/renderer-sizing.md` |
| 3 | `RING_BASE_COLORS` mirrors the `.timer-progress.*` CSS by hand | `rules/ring-colors.md` |
| 4 | `version` drives the update banner — keep it at the upstream base | `rules/fork-versioning.md` |

## The work log is git

There is no hand-kept work-log file, and one should not be started — git cannot go stale, and a log written
in a separate step from the work always develops holes. Commit message bodies carry what changed, why, what
was rejected, and the evidence. Useful lookups:

```bash
git log --grep='\bT1\b'          # every slice of a queue task
git log --follow -- <path>       # a file's history across renames
git diff --stat v1.7.6 HEAD      # everything this fork changes vs upstream
```

## Human documentation

All the top-level `.md` files (`README.md`, `INSTALL.md`, `QUICKSTART.md`, `CONTRIBUTING.md`,
`RELEASE_PROCESS.md`, `MACOS_CODE_SIGNING.md`, `RELEASE_NOTES_1.7.X.md`, `STAGED_CHANGES.md`) are
**upstream's**, describing the upstream project. They are not maintained by this fork and none of them
describe the fork's changes — treat them as inherited reference, and do not file agent memory in them.
