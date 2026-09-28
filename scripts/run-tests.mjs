/* Ejecuta cada tests/*.test.mjs en su propio proceso y resume.
   (Se evita `node --test <dir>`: en Node 18.14 su parser TAP falla con tildes y ñ.) */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests');
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.test.mjs')).sort();
let pass = 0, fail = 0, skip = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(DIR, f)], { encoding: 'utf8' });
  const out = r.stdout + r.stderr;
  const n = k => +((out.match(new RegExp(`^# ${k} ([0-9]+)`, 'm')) || [])[1] || 0);
  pass += n('pass'); fail += n('fail'); skip += n('skipped');
  const bad = r.status !== 0 || n('fail') > 0;
  console.log(`${bad ? '✗' : '✓'} ${f}  (${n('pass')} ok, ${n('fail')} fallidos, ${n('skipped')} omitidos)`);
  if (bad) console.log(out.split('\n').filter(l => /^not ok|error:|expected|actual|message/.test(l.trim())).join('\n'));
  if (r.status !== 0 && !n('fail')) fail++;
}
console.log(`\nTESTS: ${fail ? 'FAIL' : 'PASS'} · ${pass} ok · ${fail} fallidos · ${skip} omitidos`);
process.exit(fail ? 1 : 0);
