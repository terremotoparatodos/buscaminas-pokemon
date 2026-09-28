/* AUDITORÍA OPCIONAL con una TERCERA fuente (Serebii, Pokédex de Escarlata/Púrpura).
   No forma parte del build y nunca agrega datos: sólo avisa si Serebii contradice
   una ronda de movimiento. Distingue las secciones de Escarlata/Púrpura de las de
   Legends: Z-A que Serebii muestra en la misma página.

   Uso: node scripts/audit-serebii.mjs   (requiere .cache/ de npm run fetch) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const rounds = read('data/rounds.json').rounds.filter(r => r.family === 'move');
const facts = read('data/pokemon-facts.json');
const moveEn = Object.fromEntries(read('.cache/pokeapi/bundle.json').moves.map(m => [m.name, m.names.en]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cache = {};

async function sections(species, move) {
  const html = cache[species] ||= await (await fetch(`https://www.serebii.net/pokedex-sv/${species.replace(/-/g, '')}/`, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
  await sleep(250);
  const hdr = [...html.matchAll(/<td[^>]*class="fooevo"[^>]*>(.*?)<\/td>/gs)].map(m => [m.index, m[1].replace(/<[^>]+>/g, '').slice(0, 40)]);
  return [...html.matchAll(new RegExp(`>${move}<`, 'g'))].map(m => (hdr.filter(h => h[0] < m.index).pop() || [0, '?'])[1]);
}

let checked = 0, conflicts = 0;
for (const r of rounds) {
  for (const k of r.pokemon) {
    const p = facts.pokemon[k];
    if (p.form !== 'default') continue; // Serebii agrupa formas en la misma página: sólo forma base
    const ours = !!p.learnsets.gen9.moves[r.condition.move];
    const hits = await sections(p.species, moveEn[r.condition.move]);
    const inSV = hits.some(h => !/Z-A|Mega/.test(h)), inZA = hits.some(h => /Z-A/.test(h));
    const bad = ours !== inSV || (!ours && inZA);
    checked++;
    if (bad) { conflicts++; console.log(`✗ ${r.id} · ${k}: nosotros=${ours} · Serebii: ${[...new Set(hits)].join(' | ') || 'no lo lista'}`); }
  }
}
console.log(`\nSerebii: ${checked} cartas revisadas · ${conflicts} conflictos`);
process.exit(conflicts ? 1 : 0);
