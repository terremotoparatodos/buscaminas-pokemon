/* Genera el banco de rondas a partir del CONSENSO de las dos fuentes.
   El generador sólo decide QUÉ 12 Pokémon aparecen; qué es correcto o bomba lo
   calcula siempre el motor (js/engine.js). Después hay que correr el validador,
   que vuelve a comprobar todo desde cero contra cada fuente por separado.

   Uso: node scripts/generate-rounds.mjs [--seed banco-v1] [--no-sprites] */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ABILITIES, MOVES, MOVE_SIBLINGS, TYPES, RULESETS } from './catalog.mjs';
import { loadBundles } from './lib/sources.mjs';
import { buildConsensus, isCleanMoveNegative, spanishNames } from './lib/dataset.mjs';

const require = createRequire(import.meta.url);
const E = require('../js/engine.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const SEED = arg('--seed', 'banco-v1');
const PER_FAMILY = { easy: 4, normal: 4, hard: 4 };
const ruleset = RULESETS.gen9;

const bundles = loadBundles(ROOT);
const C = buildConsensus(bundles, ruleset);
const NAMES = spanishNames(bundles.A);
const ctx = { typeChart: C.typeChart, checkedMoves: { gen9: MOVES } };
const moveType = Object.fromEntries(bundles.A.moves.filter(m => !m.missing).map(m => [m.name, m.type]));
const ALL = Object.values(C.pokemon);

/* ─── Familiaridad: sólo para dificultad (qué tan reconocible es). No decide respuestas. ─── */
const GEN_SCORE = { 1: 5, 2: 4, 3: 3.5, 4: 3, 5: 2.5, 6: 2, 7: 1.8, 8: 1.5, 9: 1.6 };
const fam = p => (GEN_SCORE[p.generation] || 1) + (p.finalStage ? 1 : 0) - (p.isBaby ? 1 : 0) - (p.region ? 1.5 : 0) + (p.isLegendary ? 0.3 : 0);
const FAM_HIGH = 5, FAM_MID = 3;

const usage = {};
const evalP = (p, cond) => E.evaluateCondition(p, cond, ctx).value;

/* ─── Rasgos por familia de condición ─── */
function features(family, cond, p, positives) {
  const posTypes = {};
  positives.forEach(q => q.types.forEach(t => { posTypes[t] = (posTypes[t] || 0) + 1; }));
  const sharesType = p.types.some(t => (posTypes[t] || 0) >= 2) ? 1 : 0;
  const posChains = new Set(positives.map(q => q.evolutionChain));
  if (family === 'resistance' || family === 'weakness') {
    const T = cond.attackingType;
    const single = p.types.map(t => C.typeChart[t][T]);
    const m = single.reduce((a, b) => a * b, 1);
    const ok = x => family === 'resistance' ? (cond.includeImmunity ? x < 1 : x < 1 && x > 0) : x > 1;
    const neutralized = p.types.length === 2 && single.some(ok) && !ok(m);
    const beatsT = p.types.some(t => C.typeChart[T][t] === 2) ? 1 : 0; // ese tipo le pega fuerte a T
    return {
      obvious: p.types.length === 1 || single.every(ok),
      credibility: 3 * neutralized + (family === 'resistance' ? 2 * beatsT : (m === 1 ? 1 : 0)) + sharesType,
      neutralized,
    };
  }
  if (family === 'ability') {
    const tokens = s => s.split('-').filter(w => w.length > 3);
    const target = tokens(cond.ability);
    const all = [...p.abilities.normal, ...p.abilities.hidden];
    const related = all.some(a => a !== cond.ability && tokens(a).some(w => target.includes(w))) ? 1 : 0;
    return {
      obvious: p.abilities.normal.includes(cond.ability),
      credibility: 3 * (posChains.has(p.evolutionChain) ? 1 : 0) + 2 * related + sharesType,
    };
  }
  if (family === 'move') {
    const mt = moveType[cond.move];
    const methods = (p.learnsets.gen9.moves[cond.move]) || [];
    const siblings = (MOVE_SIBLINGS.find(g => g.includes(cond.move)) || []).filter(m => m !== cond.move);
    const learnsSibling = siblings.some(m => p.learnsets.gen9.moves[m]) ? 1 : 0;
    return {
      obvious: p.types.includes(mt) || methods.includes('level-up'),
      credibility: 3 * learnsSibling + 2 * (p.types.includes(mt) ? 1 : 0) + 2 * (posChains.has(p.evolutionChain) ? 1 : 0) + sharesType,
    };
  }
  throw new Error(family);
}

function poolFor(family, cond) {
  if (family === 'ability') return ALL.filter(p => p.abilities);
  if (family === 'move') return ALL.filter(p => p.learnsets.gen9 && p.learnsets.gen9.available && !p.learnsets.gen9.disputed.includes(cond.move));
  if (family === 'resistance' && !cond.includeImmunity) return ALL.filter(p => E.typeMultiplier(p.types, cond.attackingType, C.typeChart) !== 0);
  return ALL;
}

/* Elección codiciosa con restricciones de diversidad. */
function pick(cands, n, score, chosen, maxSameTypes) {
  const out = [];
  const species = new Set(chosen.map(p => p.dex)), chains = {}, typeSets = {};
  chosen.forEach(p => { chains[p.evolutionChain] = (chains[p.evolutionChain] || 0) + 1; });
  const sorted = cands.map(p => ({ p, s: score(p) })).sort((a, b) => b.s - a.s || a.p.key.localeCompare(b.p.key));
  for (const { p } of sorted) {
    if (out.length === n) break;
    const ts = p.types.slice().sort().join('/');
    if (species.has(p.dex) || (chains[p.evolutionChain] || 0) >= 2 || (typeSets[ts] || 0) >= maxSameTypes) continue;
    out.push(p); species.add(p.dex);
    chains[p.evolutionChain] = (chains[p.evolutionChain] || 0) + 1;
    typeSets[ts] = (typeSets[ts] || 0) + 1;
  }
  return out.length === n ? out : null;
}

/* Recetas por dificultad, de la más estricta a la más laxa. Se usa la primera que alcance.
   fam* = familiaridad mínima · tricky = positivos "no obvios" · cred = credibilidad de impostores. */
const RECIPES = {
  easy: [
    { famPos: 5, famNeg: 5, tricky: 0, credMin: 1, credMax: 2 },
    { famPos: 4.5, famNeg: 4.5, tricky: 0, credMin: 1, credMax: 2 },
    { famPos: 4, famNeg: 4, tricky: 0, credMin: 1, credMax: 3 },
  ],
  normal: [
    { famPos: 3, famNeg: 3, tricky: 3, credMin: 2 },
    { famPos: 3, famNeg: 3, tricky: 2, credMin: 2 },
    { famPos: 2.5, famNeg: 2.5, tricky: 2, credMin: 2 },
  ],
  hard: [
    { famPos: 0, famNeg: 0, tricky: 4, credMin: 3 },
    { famPos: 0, famNeg: 0, tricky: 3, credMin: 3 },
  ],
};

function buildRound(family, cond, difficulty, rand) {
  const pool = poolFor(family, cond);
  const POS = pool.filter(p => evalP(p, cond));
  let NEG = pool.filter(p => !evalP(p, cond));
  if (family === 'move') NEG = NEG.filter(p => isCleanMoveNegative(C, p.key, cond.move));
  if (POS.length < 8 || NEG.length < 4) return { error: `pocos candidatos (${POS.length} positivos, ${NEG.length} negativos)` };
  let lastError;
  for (const recipe of RECIPES[difficulty]) {
    const r = tryRecipe(family, cond, difficulty, recipe, POS, NEG, rand);
    if (!r.error) return r;
    lastError = r.error;
  }
  return { error: lastError };
}

function tryRecipe(family, cond, difficulty, R, POS, NEG, rand) {
  const jitter = () => rand() * 0.6;
  const pen = p => 1.5 * (usage[p.key] || 0);
  const maxSame = family === 'resistance' || family === 'weakness' ? 2 : 3;
  const obvious = p => features(family, cond, p, []).obvious;
  const posScore = p => (difficulty === 'hard' ? fam(p) / 2 : fam(p)) + jitter() - pen(p);

  let positives = [];
  if (R.tricky) {
    positives = pick(POS.filter(p => !obvious(p) && fam(p) >= R.famPos), R.tricky, posScore, [], maxSame);
    if (!positives) return { error: `no hay ${R.tricky} positivos no obvios para ${difficulty}` };
  }
  const restPool = difficulty === 'hard' ? POS.filter(p => !positives.includes(p)) : POS.filter(p => obvious(p) && fam(p) >= R.famPos);
  const rest = pick(restPool, 8 - positives.length, posScore, positives, maxSame);
  if (!rest) return { error: `no hay 8 positivos adecuados para ${difficulty}` };
  positives = positives.concat(rest);

  const feat = p => features(family, cond, p, positives);
  const negOk = p => { const c = feat(p).credibility; return c >= R.credMin && (R.credMax === undefined || c <= R.credMax) && fam(p) >= R.famNeg; };
  const negScore = difficulty === 'easy' ? p => fam(p) + feat(p).credibility + jitter() - pen(p)
    : difficulty === 'normal' ? p => feat(p).credibility + fam(p) / 2 + jitter() - pen(p)
    : p => 2 * feat(p).credibility + fam(p) / 4 + jitter() - pen(p);
  const negs = pick(NEG.filter(negOk), 4, negScore, positives, maxSame);
  if (!negs) return { error: `no hay 4 impostores creíbles para ${difficulty}` };

  const quality = negs.reduce((a, p) => a + feat(p).credibility, 0) + positives.filter(p => !obvious(p)).length
    - positives.concat(negs).reduce((a, p) => a + 0.5 * (usage[p.key] || 0), 0);
  return { positives, negs, quality };
}

/* ─── Condiciones candidatas ─── */
function conditionsFor(family) {
  if (family === 'ability') return ABILITIES.filter(a => NAMES.abilities[a]).map(a => ({ type: 'ability', ability: a, abilityMode: 'any', ruleset: 'gen9' }));
  if (family === 'move') return MOVES.filter(m => NAMES.moves[m]).map(m => ({ type: 'move', move: m, generation: 9, ruleset: 'gen9' }));
  if (family === 'resistance') return TYPES.map(t => ({ type: 'resistance', attackingType: t, includeImmunity: true, ruleset: 'gen9' }));
  if (family === 'weakness') return TYPES.map(t => ({ type: 'weakness', attackingType: t, ruleset: 'gen9' }));
}
const condId = c => c.type + '-' + (c.ability || c.move || c.attackingType);

const rounds = [];
const discarded = [];
for (const family of ['ability', 'move', 'resistance', 'weakness']) {
  const remaining = conditionsFor(family);
  for (const difficulty of ['hard', 'normal', 'easy']) {
    for (let k = 0; k < PER_FAMILY[difficulty]; k++) {
      let best = null;
      for (const cond of remaining) {
        const r = buildRound(family, cond, difficulty, E.rng(`${SEED}:${condId(cond)}:${difficulty}`));
        if (r.error) { discarded.push({ condition: condId(cond), difficulty, reason: r.error }); continue; }
        if (!best || r.quality > best.r.quality) best = { cond, r };
      }
      if (!best) { discarded.push({ family, difficulty, reason: 'ninguna condición disponible' }); break; }
      remaining.splice(remaining.indexOf(best.cond), 1);
      const keys = [...best.r.positives, ...best.r.negs].map(p => p.key);
      keys.forEach(key => { usage[key] = (usage[key] || 0) + 1; });
      const text = E.describeCondition(best.cond, NAMES);
      rounds.push({
        id: `${condId(best.cond)}-${difficulty}`, family, difficulty,
        question: text.question, rule: text.rule, condition: best.cond,
        pokemon: keys.slice().sort(), // orden neutro: la posición en pantalla la baraja el juego
      });
    }
  }
}

/* ─── Salidas ─── */
const used = [...new Set(rounds.flatMap(r => r.pokemon))].sort();
const outDir = path.join(ROOT, 'data');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'rounds.json'), JSON.stringify({
  generatedAt: new Date().toISOString(), seed: SEED,
  note: 'Las respuestas NO están acá: se recalculan con js/engine.js desde pokemon-facts.json. "verified" lo escribe scripts/validate-rounds.mjs.',
  rounds,
}, null, 2));

const factsOut = {};
for (const key of used) {
  const p = C.pokemon[key];
  factsOut[key] = {
    key, id: p.id, species: p.species, form: p.form, dex: p.dex, name: p.formEs ? `${p.nameEs} ${p.formEs}` : p.nameEs,
    types: p.types, abilities: p.abilities, learnsets: { gen9: p.learnsets.gen9 && { available: p.learnsets.gen9.available, moves: p.learnsets.gen9.moves, disputed: p.learnsets.gen9.disputed } },
    sprite: `assets/sprites/${p.id}.png`,
  };
}
const namesUsed = { abilities: {}, moves: {}, types: NAMES.types };
rounds.forEach(r => {
  if (r.condition.ability) namesUsed.abilities[r.condition.ability] = NAMES.abilities[r.condition.ability];
  if (r.condition.move) namesUsed.moves[r.condition.move] = NAMES.moves[r.condition.move];
});
fs.writeFileSync(path.join(outDir, 'pokemon-facts.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  sources: { A: bundles.A.source + ' · ' + bundles.A.fetchedAt, B: bundles.B.source + ' · ' + bundles.B.fetchedAt },
  rulesets: { gen9: ruleset },
  note: 'Hechos en los que coinciden las DOS fuentes. typeChart[defensor][atacante].',
  typeChart: C.typeChart, checkedMoves: { gen9: MOVES }, names: namesUsed, pokemon: factsOut,
}, null, 1));

fs.writeFileSync(path.join(outDir, 'generation-report.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  excludedPokemon: C.excluded, sourceDiscrepancies: C.discrepancies,
  discardedCandidates: discarded,
}, null, 1));

if (!process.argv.includes('--no-sprites')) {
  const dir = path.join(ROOT, 'assets', 'sprites');
  fs.mkdirSync(dir, { recursive: true });
  const spriteUrl = Object.fromEntries(bundles.A.pokemon.filter(p => !p.missing).map(p => [p.name, p.sprite]));
  // Sólo quedan los sprites que usa el banco actual.
  const keep = new Set(used.map(k => `${C.pokemon[k].id}.png`));
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.png') && !keep.has(f)) fs.unlinkSync(path.join(dir, f));
  for (const key of used) {
    const file = path.join(dir, `${C.pokemon[key].id}.png`);
    if (fs.existsSync(file)) continue;
    const res = await fetch(spriteUrl[key]);
    if (!res.ok) throw new Error(`Sprite ${key}: HTTP ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
}

const count = f => rounds.filter(r => r.family === f).length;
console.log(`Rondas generadas: ${rounds.length} (habilidad ${count('ability')}, movimiento ${count('move')}, resistencia ${count('resistance')}, debilidad ${count('weakness')})`);
console.log(`Pokémon distintos usados: ${used.length}`);
console.log(`Pokémon excluidos del pool: ${C.excluded.length} · discrepancias entre fuentes: ${C.discrepancies.length}`);
console.log('Siguiente paso: node scripts/validate-rounds.mjs');
