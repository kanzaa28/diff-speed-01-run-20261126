// Fast drop-in for makefun-diff 1.0.0.
//
// Same answer as makefun-diff 1.0.0's diffPatch on every input { old, new }, computed
// faster: lines are hashed to integer ids once (one Map per case), the common prefix
// and suffix are trimmed on the id arrays, and the middle is searched with Myers's
// greedy search over typed arrays — no per-step object allocation — using make.fun's
// own tie-break (the deletion when a deletion and an insertion reach the same point
// into the old text, no edge-diagonal pruning, every equal run followed as far as it
// goes). The full V table is kept (level d at indices d*d .. d*d+2d) so the backtrack
// reconstructs exactly the first path the forward search reaches the ends with.
// The inner loop carries one V value across diagonals (the insertion source of one
// diagonal is the deletion source of the next) and reads only one V entry per step.
//
// This file is original code, written from the rule stated in makefun-diff's header;
// it does not copy or import makefun-diff.
const KEEP = 0;
const DELETE = 1;
const INSERT = 2;
const CONTEXT = 3;

function tokenize(text, map, idToLine, ids) {
  let start = 0;
  for (;;) {
    const nl = text.indexOf('\n', start);
    if (nl === -1) break;
    const line = text.slice(start, nl + 1);
    let id = map.get(line);
    if (id === undefined) {
      id = idToLine.length;
      map.set(line, id);
      idToLine.push(line);
    }
    ids.push(id);
    start = nl + 1;
  }
  if (start < text.length) {
    const line = text.slice(start);
    let id = map.get(line);
    if (id === undefined) {
      id = idToLine.length;
      map.set(line, id);
      idToLine.push(line);
    }
    ids.push(id);
  }
  return Int32Array.from(ids);
}

function myers(a, b) {
  const N = a.length;
  const M = b.length;
  // Start big enough for any realistic D (practice D ~ 3500-4000; worst case
  // ~6000) so the table never grows mid-search; untouched pages never fault in.
  let V = new Int32Array(8193 * 8193);
  // d = 0: the snake from (0, 0).
  let x = 0;
  while (x < N && x < M && a[x] === b[x]) x++;
  V[0] = x;
  if (x >= N && x >= M) return { D: 0, kf: 0, V };
  const maxD = N + M;
  for (let d = 1; d <= maxD; d++) {
    if ((d + 1) * (d + 1) > V.length) {
      const nv = new Int32Array(V.length * 2);
      nv.set(V);
      V = nv;
    }
    const base = d * d;
    const prev = (d - 1) * (d - 1);
    // k = -d: deletion candidate does not exist; only the insertion from (d-1, -d+1).
    // Its source is also the deletion source of k = -d+2, so carry it forward.
    let vDel;
    {
      const k = -d;
      const xi = V[prev + k + d]; // (d-1, k+1) = (d-1, -d+1)
      vDel = xi;
      const idx = base; // k + d = 0
      if (xi >= 0 && xi - (k + 1) < M) {
        let xx = xi;
        let y = xx - k;
        while (xx < N && y < M && a[xx] === b[y]) {
          xx++;
          y++;
        }
        V[idx] = xx;
        if (xx >= N && y >= M) return { D: d, kf: k, V };
      } else {
        V[idx] = -1;
      }
    }
    // Middle diagonals: the insertion source of this k is the deletion source
    // of k+2, so carry one value across steps and read only one V entry each.
    let pIns = prev + 2; // index of (d-1, k+1) for k = -d+2
    let w = base + 2; // write index for k = -d+2
    for (let k = -d + 2; k <= d - 2; k += 2) {
      const vIns = V[pIns];
      const canDel = vDel >= 0 && vDel < N;
      const canIns = vIns >= 0 && vIns - (k + 1) < M;
      if (!canDel && !canIns) {
        V[w] = -1;
      } else {
        const byDel = canDel ? vDel + 1 : -2;
        const byIns = canIns ? vIns : -2;
        let xx = byDel >= byIns ? byDel : byIns;
        let y = xx - k;
        while (xx < N && y < M && a[xx] === b[y]) {
          xx++;
          y++;
        }
        V[w] = xx;
        if (xx >= N && y >= M) return { D: d, kf: k, V };
      }
      vDel = vIns;
      pIns += 2;
      w += 2;
    }
    // k = d: insertion candidate does not exist; only the deletion from (d-1, d-1).
    {
      const k = d;
      const xd = vDel; // carried: (d-1, k-1) = (d-1, d-1)
      const idx = base + 2 * d;
      if (xd >= 0 && xd < N) {
        let xx = xd + 1;
        let y = xx - k;
        while (xx < N && y < M && a[xx] === b[y]) {
          xx++;
          y++;
        }
        V[idx] = xx;
        if (xx >= N && y >= M) return { D: d, kf: k, V };
      } else {
        V[idx] = -1;
      }
    }
  }
  throw new Error('makefun-diff: the search ended without reaching both ends');
}

function backtrack(a, b, V, D, kf) {
  const N = a.length;
  const M = b.length;
  const kinds = [];
  const counts = [];
  let k = kf;
  let x = V[D * D + kf + D];
  for (let d = D; d >= 1; d--) {
    const prev = (d - 1) * (d - 1);
    const xd = k > -d ? V[prev + k + d - 2] : -1;
    const xi = k < d ? V[prev + k + d] : -1;
    const canDel = xd >= 0 && xd < N;
    const canIns = xi >= 0 && xi - (k + 1) < M;
    const byDel = canDel ? xd + 1 : -2;
    const byIns = canIns ? xi : -2;
    let xStart;
    let isDel;
    if (byDel >= byIns) {
      xStart = byDel;
      isDel = true;
    } else {
      xStart = byIns;
      isDel = false;
    }
    const snake = x - xStart;
    if (snake > 0) {
      kinds.push(KEEP);
      counts.push(snake);
    }
    kinds.push(isDel ? DELETE : INSERT);
    counts.push(1);
    k = isDel ? k - 1 : k + 1;
    x = isDel ? xd : xi;
  }
  if (x > 0) {
    kinds.push(KEEP);
    counts.push(x);
  }
  const runs = [];
  for (let i = kinds.length - 1; i >= 0; i--) {
    const kind = kinds[i];
    const count = counts[i];
    const last = runs[runs.length - 1];
    if (last !== undefined && last.kind === kind) last.count += count;
    else runs.push({ kind, count });
  }
  return runs;
}

function pushWritten(out, op, line) {
  if (line.endsWith('\n')) {
    out.push(op, line);
  } else {
    out.push(op, line, '\n%\n');
  }
}

export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const map = new Map();
  const idToLine = [];
  const aIds = [];
  const bIds = [];
  const a = tokenize(input.old, map, idToLine, aIds);
  const b = tokenize(input.new, map, idToLine, bIds);
  const n = a.length;
  const m = b.length;
  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) suffix++;
  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  const midA = a.subarray(prefix, n - suffix);
  const midB = b.subarray(prefix, m - suffix);
  const found = myers(midA, midB);
  runs.push(...backtrack(midA, midB, found.V, found.D, found.kf));
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }
  const out = [`makefun-diff/1 old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) pushWritten(out, '=', idToLine[a[at]]);
      for (let i = 0; i < c.dels; i++) pushWritten(out, '-', idToLine[a[c.o + i]]);
      for (let i = 0; i < c.ins; i++) pushWritten(out, '+', idToLine[b[c.p + i]]);
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) pushWritten(out, '=', idToLine[a[at]]);
  }
  return out.join('');
}
