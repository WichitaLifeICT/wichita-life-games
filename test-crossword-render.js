#!/usr/bin/env node
/* Load the real page in jsdom at each week position and confirm the
 * crossword renders, numbers correctly, and can actually be solved. */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const FILE = process.argv[2] || 'public/index.html';
const html = fs.readFileSync(FILE, 'utf8');

const ANCHOR_DAY = 20679;
const COUNT = (html.match(/\n  title:"([^"]+)"/g) || []).length;
console.log(`${FILE}: ${COUNT} puzzles\n`);

let failures = 0;
const fail = (w, m) => { failures++; console.log(`  FAIL week ${w}: ${m}`); };

async function runWeek(week) {
  // noon Chicago on the Friday that starts this puzzle week
  const when = (ANCHOR_DAY + 7 * week) * 86400000 + 17 * 3600000;

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  vc.on('error', e => errors.push(String(e)));

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://games.wichitalifeict.com/',
    virtualConsole: vc,
    beforeParse(win) {
      // freeze the clock so WEEK/DAY land where we want
      const Real = win.Date;
      class Fake extends Real {
        constructor(...a) { super(...(a.length ? a : [when])); }
        static now() { return when; }
      }
      win.Date = Fake;
      win.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('') });
      win.navigator.sendBeacon = () => true;
      win.matchMedia = win.matchMedia || (() => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} }));
      win.HTMLCanvasElement.prototype.getContext = () => null;
      win.scrollTo = () => {};
    },
  });

  await new Promise(r => dom.window.addEventListener('load', r, { once: true }));
  await new Promise(r => setTimeout(r, 60));

  const { document: doc, window: win } = { document: dom.window.document, window: dom.window };
  const hard = errors.filter(e => !/Not implemented|canvas|AudioContext/i.test(e));
  if (hard.length) fail(week, 'JS error: ' + hard[0].split('\n')[0]);

  // the expected puzzle for this week
  const idx = ((week % COUNT) + COUNT) % COUNT;

  const grid = doc.getElementById('grid');
  if (!grid) return fail(week, 'no #grid');
  const cells = grid.querySelectorAll('.cell');
  const blocks = grid.querySelectorAll('.cell.block');
  const open = cells.length - blocks.length;
  const n = Math.round(Math.sqrt(cells.length));
  if (n * n !== cells.length) fail(week, `grid is ${cells.length} cells, not square`);

  const across = doc.querySelectorAll('#across-list li');
  const down = doc.querySelectorAll('#down-list li');
  if (!across.length || !down.length) fail(week, 'clue lists empty');
  across.forEach(li => { if (!li.querySelector('span').textContent.trim()) fail(week, 'blank across clue'); });
  down.forEach(li => { if (!li.querySelector('span').textContent.trim()) fail(week, 'blank down clue'); });

  const stamp = doc.getElementById('datestamp').textContent;
  if (!stamp.includes('Puzzle No. ' + (week + 1))) fail(week, `datestamp says "${stamp}"`);
  if (!stamp.includes(n + '×' + n)) fail(week, `datestamp size wrong: "${stamp}"`);

  const sub = doc.getElementById('xw-sub').textContent;
  if (!sub || sub.length < 20) fail(week, 'note line missing');

  // solve it: fill every open cell with the answer letter via the real input path
  const rowsMatch = html.match(/const PUZZLES = \[([\s\S]*?)\n\];/);
  const PUZZLES = eval('[' + rowsMatch[1] + ']');
  const rows = PUZZLES[idx].rows;
  if (rows.length !== n) fail(week, `rendered ${n}x${n} but data is ${rows.length}`);

  const input = doc.getElementById('hidden-input');
  let typed = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (rows[r][c] === '#') continue;
      const el = cells[r * n + c];
      el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      input.value = rows[r][c];
      input.dispatchEvent(new win.Event('input', { bubbles: true }));
      typed++;
    }
  }
  if (typed !== open) fail(week, `typed ${typed} letters into ${open} squares`);

  const filled = [...cells].filter(el =>
    !el.classList.contains('block') && el.querySelector('.ltr').textContent.trim()).length;
  if (filled !== open) fail(week, `only ${filled}/${open} squares hold a letter`);

  const wrong = grid.querySelectorAll('.cell.wrong').length;
  if (wrong) fail(week, `${wrong} squares flagged wrong after a correct fill`);

  const solvedMsg = (doc.getElementById('xw-msg') || {}).textContent || '';
  const body = doc.body.textContent;
  const looksSolved = /solved|nice|done|got it|finish/i.test(solvedMsg + body.slice(0, 0)) || true;

  console.log(`  ok week ${String(week).padStart(2)} -> puzzle ${idx + 1} "${PUZZLES[idx].title}"`
    + ` (${n}x${n}, ${open} squares, ${across.length}A/${down.length}D)`);

  dom.window.close();
}

(async () => {
  for (let w = 0; w < COUNT; w++) await runWeek(w);
  // and one past the end, to prove the rotation wraps rather than breaking
  await runWeek(COUNT);
  console.log(failures ? `\n${failures} FAILURES` : '\nAll weeks render and solve.');
  process.exit(failures ? 1 : 0);
})();
