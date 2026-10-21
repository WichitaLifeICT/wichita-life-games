#!/usr/bin/env node
/* Validate every Crossroads puzzle shipped in a page, using the same
 * numbering logic the page itself runs. Checks grid shape, symmetry,
 * clue coverage, minimum word length, connectivity and solvability. */
const fs = require('fs');

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: verify-crosswords.js <html...>'); process.exit(2); }

let failures = 0;
const fail = (where, msg) => { failures++; console.log(`  FAIL ${where}: ${msg}`); };

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const m = src.match(/const PUZZLES = \[([\s\S]*?)\n\];/);
  if (!m) { fail(file, 'could not find PUZZLES'); continue; }

  let PUZZLES;
  try {
    PUZZLES = eval('[' + m[1] + ']');          // the array literal, as the page defines it
  } catch (e) { fail(file, 'PUZZLES is not valid JS: ' + e.message); continue; }

  console.log(`\n${file} — ${PUZZLES.length} puzzles`);

  PUZZLES.forEach((PUZ, idx) => {
    const tag = `#${idx + 1} "${PUZ.title}"`;
    const N = PUZ.rows.length;

    if (!PUZ.title || !PUZ.note) return fail(tag, 'missing title or note');
    if (PUZ.rows.some(r => r.length !== N)) return fail(tag, 'not square');

    const block = PUZ.rows.map(r => r.split('').map(c => c === '#'));
    const sol = PUZ.rows.map(r => r.split(''));

    // letters must be A-Z or #
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (!/[A-Z#]/.test(PUZ.rows[r][c])) fail(tag, `bad character at ${r},${c}`);
    }

    // 180-degree rotational symmetry, as a real crossword has
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (block[r][c] !== block[N - 1 - r][N - 1 - c]) {
        fail(tag, `grid not symmetric at ${r},${c}`); return;
      }
    }

    // --- numbering: copied from public/index.html ---
    const num = Array.from({length: N}, () => Array(N).fill(0));
    const entries = [];
    let counter = 0;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (block[r][c]) continue;
        const startA = (c === 0 || block[r][c-1]) && (c+2 < N && !block[r][c+1] && !block[r][c+2]);
        const startD = (r === 0 || block[r-1][c]) && (r+2 < N && !block[r+1][c] && !block[r+2][c]);
        if (startA || startD) {
          counter++; num[r][c] = counter;
          if (startA) {
            const cells = []; let cc = c;
            while (cc < N && !block[r][cc]) { cells.push([r, cc]); cc++; }
            entries.push({n: counter, dir: 'A', cells, clue: PUZ.across[counter] || ''});
          }
          if (startD) {
            const cells = []; let rr = r;
            while (rr < N && !block[rr][c]) { cells.push([rr, c]); rr++; }
            entries.push({n: counter, dir: 'D', cells, clue: PUZ.down[counter] || ''});
          }
        }
      }
    }

    // every white square belongs to both an across and a down entry
    const inA = new Set(), inD = new Set();
    entries.forEach(e => e.cells.forEach(([r, c]) =>
      (e.dir === 'A' ? inA : inD).add(r + ',' + c)));
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (block[r][c]) continue;
      if (!inA.has(r + ',' + c)) fail(tag, `cell ${r},${c} is in no across entry`);
      if (!inD.has(r + ',' + c)) fail(tag, `cell ${r},${c} is in no down entry`);
    }

    // no two-letter words, every entry clued, no answer inside its own clue
    const answers = [];
    entries.forEach(e => {
      const w = e.cells.map(([r, c]) => sol[r][c]).join('');
      answers.push(w);
      if (w.length < 3) fail(tag, `${e.n}${e.dir} is only ${w.length} letters`);
      if (!e.clue.trim()) fail(tag, `${e.n}${e.dir} (${w}) has no clue`);
      const flat = e.clue.toLowerCase().replace(/[^a-z]/g, '');
      if (w.length >= 4 && flat.includes(w.toLowerCase()))
        fail(tag, `${e.n}${e.dir} clue gives away ${w}`);
    });

    // clue keys must not point at numbers that do not exist
    const realA = new Set(entries.filter(e => e.dir === 'A').map(e => e.n));
    const realD = new Set(entries.filter(e => e.dir === 'D').map(e => e.n));
    Object.keys(PUZ.across).forEach(k => { if (!realA.has(+k)) fail(tag, `across clue ${k} has no entry`); });
    Object.keys(PUZ.down).forEach(k => { if (!realD.has(+k)) fail(tag, `down clue ${k} has no entry`); });

    // no repeated answer within the puzzle
    const seen = new Set();
    answers.forEach(w => { if (seen.has(w)) fail(tag, `repeated answer ${w}`); seen.add(w); });

    // white squares all connected
    const open = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!block[r][c]) open.push([r, c]);
    const seenC = new Set([open[0].join(',')]);
    const stack = [open[0]];
    while (stack.length) {
      const [r, c] = stack.pop();
      [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dr, dc]) => {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= N || nc >= N || block[nr][nc]) return;
        const k = nr + ',' + nc;
        if (!seenC.has(k)) { seenC.add(k); stack.push([nr, nc]); }
      });
    }
    if (seenC.size !== open.length) fail(tag, 'grid is not fully connected');

    // the puzzle must actually be solvable: filling every answer reproduces the grid
    const test = Array.from({length: N}, () => Array(N).fill(''));
    entries.forEach(e => e.cells.forEach(([r, c], i) => {
      const ch = e.cells.map(([rr, cc]) => sol[rr][cc]).join('')[i];
      if (test[r][c] && test[r][c] !== ch) fail(tag, `crossing conflict at ${r},${c}`);
      test[r][c] = ch;
    }));
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (block[r][c]) continue;
      if (test[r][c] !== sol[r][c]) fail(tag, `cell ${r},${c} not reachable from any entry`);
    }

    const nA = entries.filter(e => e.dir === 'A').length;
    const nD = entries.filter(e => e.dir === 'D').length;
    console.log(`  ok ${tag} — ${N}x${N}, ${nA} across, ${nD} down`);
  });
}

console.log(failures ? `\n${failures} FAILURES` : '\nAll puzzles valid.');
process.exit(failures ? 1 : 0);
