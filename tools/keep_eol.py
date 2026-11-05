"""Stage an edited file while keeping the base blob's exact line endings on unchanged lines.

Dev-only. Upstream commits some files with mixed CRLF/LF (src/renderer/index.html). With core.autocrlf=true,
an edited copy can come back with every line normalized, so untouched upstream lines show up as whitespace
churn. This rebuilds the file: lines equal (ignoring CR) to the base blob keep the base's bytes; new or changed
lines are written with LF (how the fork commits them). Then it stages with autocrlf off so the bytes land
verbatim. Check the result with `git diff --cached --numstat` — it should be sized like the edit.

usage: py tools/keep_eol.py <base-rev> <path>...
"""
import difflib
import subprocess
import sys

if len(sys.argv) < 3:
    sys.exit(__doc__)

base_rev = sys.argv[1]
for path in sys.argv[2:]:
    base = subprocess.run(['git', 'show', f'{base_rev}:{path}'], capture_output=True, check=True).stdout
    with open(path, 'rb') as f:
        work = f.read()
    base_lines = base.split(b'\n')
    work_lines = work.split(b'\n')
    strip = lambda ls: [l[:-1] if l.endswith(b'\r') else l for l in ls]
    b_norm, w_norm = strip(base_lines), strip(work_lines)
    out = []
    sm = difflib.SequenceMatcher(None, b_norm, w_norm, autojunk=False)
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == 'equal':
            out.extend(base_lines[i1:i2])
        else:
            out.extend(w_norm[j1:j2])
    data = b'\n'.join(out)
    with open(path, 'wb') as f:
        f.write(data)
    subprocess.run(['git', '-c', 'core.autocrlf=false', 'add', path], check=True)
    print(f'staged {path}: {len(out)} lines, {sum(1 for l in out if l.endswith(b"\r"))} kept CRLF')
