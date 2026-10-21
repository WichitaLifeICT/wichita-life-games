#!/usr/bin/env node
/* Guard against literal escape sequences leaking into visible markup.
 *
 * Escapes like — are correct INSIDE a <script> string, but if one ends
 * up in the HTML body the reader sees the raw characters on the page. This
 * has bitten the site three times (—, then \U0001F6C1 in the Troll
 * Patrol block), so it is checked on every build.
 */
const fs = require('fs');

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: check-escapes.js <html...>'); process.exit(2); }

// 4-digit \uXXXX, 8-digit \UXXXXXXXX, and 2-digit \xXX
const PATTERN = /\\u[0-9a-fA-F]{4}|\\U[0-9a-fA-F]{8}|\\x[0-9a-fA-F]{2}/g;

let bad = 0;
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  // strip script and style blocks: escapes are legitimate in there
  const markup = src
    .replace(/<script[\s\S]*?<\/script>/gi, m => '\n'.repeat((m.match(/\n/g) || []).length))
    .replace(/<style[\s\S]*?<\/style>/gi, m => '\n'.repeat((m.match(/\n/g) || []).length));

  const lines = markup.split('\n');
  let hits = 0;
  lines.forEach((line, i) => {
    const found = line.match(PATTERN);
    if (found) {
      hits++; bad++;
      console.log(`  ${file}:${i + 1}  ${found.join(' ')}`);
      console.log(`      ${line.trim().slice(0, 120)}`);
    }
  });
  console.log(`${hits ? 'FAIL' : 'ok  '} ${file}`);
}

console.log(bad ? `\n${bad} escape(s) in visible markup` : '\nNo stray escapes in markup.');
process.exit(bad ? 1 : 0);
