/* Amplía el banco existente con SETS DE GRABACIÓN cerrados, sin modificar ninguna ronda ya publicada.
   Cada set se juega con ?seed=<nombre del set>. Si un set ya está en el banco, no se toca.

   Reglas de consigna:
   - sólo habilidad, movimiento y color (resistencia/debilidad están retiradas);
   - ninguna consigna se repite dentro de un set ni entre sets de grabación;
   - se excluyen las consignas ya grabadas (sets anteriores + EXCLUDED_CONDITIONS);
   - las del banco general pueden reaparecer (con otras 12 cartas), pero se prefieren las nuevas.

   El set grabacion-2026-10-02 se creó con una versión anterior de este script (ya está en el banco). */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ABILITIES, COLORS, HEIGHT_THRESHOLDS, MOVES, RULESETS, WEIGHT_THRESHOLDS } from './catalog.mjs';
import { loadBundles } from './lib/sources.mjs';
import { buildConsensus, displayName, isCleanMoveNegative, spanishNames } from './lib/dataset.mjs';

const require = createRequire(import.meta.url);
const E = require('../js/engine.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');

const PLAN = [['ability', 5], ['move', 4], ['color', 2], ['weight', 3], ['height', 3], ['evolution', 3]];
const SETS = [
  { batch: 'video-1-2026-10-14', tag: 'v1-1014' },
  { batch: 'video-2-2026-10-14', tag: 'v2-1014' },
];
/* Consignas de un video ya grabado fuera de los sets del banco. */
const EXCLUDED_CONDITIONS = [
  'move:x-scissor', 'ability:levitate', 'move:energy-ball', 'ability:keen-eye', 'move:waterfall',
  'ability:sand-veil', 'ability:volt-absorb', 'move:spikes', 'ability:run-away', 'ability:cursed-body',
];

const bundles = loadBundles(ROOT);
const C = buildConsensus(bundles, RULESETS.gen9);
const NAMES = spanishNames(bundles.A);
const ctx = { typeChart: C.typeChart, checkedMoves: { gen9: MOVES } };
const file = JSON.parse(fs.readFileSync(path.join(DATA, 'rounds.json'), 'utf8'));
const rounds = file.rounds;

const pending = SETS.filter(s => !rounds.some(r => r.batch === s.batch));
if (!pending.length) {
  console.log(`El banco ya tiene los ${SETS.length} sets (${rounds.length} rondas); no se agregaron más.`);
  process.exit(0);
}

/* Clave de "misma consigna": peso/altura con el mismo límite cuentan como la misma aunque
   cambie más/menos (sería la misma pregunta dada vuelta). */
function conditionKey(c) {
  if (c.type === 'weight') return `weight:${c.kg}`;
  if (c.type === 'height') return `height:${c.m}`;
  if (c.type === 'evolution') return `evolution:${c.role}:${c.method}`;
  return `${c.type}:${c.ability || c.move || c.attackingType || c.color}`;
}
function conditionId(c) {
  if (c.type === 'weight') return `weight-${c.comparison}-${String(c.kg).replace('.', '_')}kg`;
  if (c.type === 'height') return `height-${c.comparison}-${String(c.m).replace('.', '_')}m`;
  if (c.type === 'evolution') return `evolution-${c.role}-${c.method}`;
  return `${c.type}-${c.ability || c.move || c.attackingType || c.color}`;
}

const usage = {};
rounds.flatMap(r => r.pokemon).forEach(k => { usage[k] = (usage[k] || 0) + 1; });
const bankConditions = new Set(rounds.filter(r => !r.batch).map(r => conditionKey(r.condition)));
const blocked = new Set([...rounds.filter(r => r.batch).map(r => conditionKey(r.condition)), ...EXCLUDED_CONDITIONS]);
const ALL = Object.values(C.pokemon);
const GEN_SCORE = { 1: 6, 2: 5, 3: 4.5, 4: 4, 5: 3.5, 6: 3, 7: 2.7, 8: 2.4, 9: 2.5 };
const familiar = p => (GEN_SCORE[p.generation] || 2) + (p.finalStage ? 1 : 0) - (p.region ? 0.5 : 0);

function poolFor(family, cond) {
  if (family === 'ability') return ALL.filter(p => p.abilities);
  if (family === 'move') return ALL.filter(p => p.learnsets.gen9 && p.learnsets.gen9.available && !p.learnsets.gen9.disputed.includes(cond.move));
  if (family === 'color') return ALL.filter(p => p.color);
  if (family === 'weight') return ALL.filter(p => typeof p.weightKg === 'number' && p.weightKg !== cond.kg);
  if (family === 'height') return ALL.filter(p => typeof p.heightM === 'number' && p.heightM !== cond.m);
  if (family === 'evolution') return ALL.filter(p => p.evolution);
  throw new Error(`Familia no admitida en sets de grabación: ${family}`);
}
/* Peso/altura: se prefieren valores cercanos al límite (entre la mitad y el doble) para que
   la ronda no sea obvia; sigue siendo comprobable porque nunca hay un valor igual al límite. */
function closeness(family, cond, p) {
  const v = family === 'weight' ? [p.weightKg, cond.kg] : family === 'height' ? [p.heightM, cond.m] : null;
  if (!v) return 0;
  return 3 * Math.max(0, 1 - Math.abs(Math.log(v[0] / v[1])) / Math.log(2));
}
function pickDistinct(candidates, count, rand, already = [], bonus = () => 0) {
  const dex = new Set(already.map(p => p.dex));
  const out = [];
  const ranked = candidates.map(p => ({ p, score: familiar(p) - 2.5 * (usage[p.key] || 0) + bonus(p) + rand() }))
    .sort((a, b) => b.score - a.score || a.p.key.localeCompare(b.p.key));
  for (const { p } of ranked) {
    if (out.length === count) break;
    if (dex.has(p.dex)) continue;
    dex.add(p.dex); out.push(p);
  }
  return out.length === count ? out : null;
}
function buildCards(family, cond, rand) {
  const pool = poolFor(family, cond);
  const positives = pool.filter(p => E.evaluateCondition(p, cond, ctx).value);
  let negatives = pool.filter(p => !E.evaluateCondition(p, cond, ctx).value);
  if (family === 'move') negatives = negatives.filter(p => isCleanMoveNegative(C, p.key, cond.move));
  if (family === 'evolution') negatives = negatives.filter(p => E.isCleanEvolutionNegative(p, cond));
  const bonus = p => closeness(family, cond, p);
  const pos = pickDistinct(positives, 8, rand, [], bonus);
  const neg = pos && pickDistinct(negatives, 4, rand, pos, bonus);
  if (!pos || !neg) return null;
  const keys = pos.concat(neg).map(p => p.key).sort();
  if (rounds.some(r => r.pokemon.slice().sort().join() === keys.join())) return null;
  return keys;
}

/* Comprobación de que las exclusiones apuntan a las consignas grabadas (por su nombre en español). */
const EXPECTED_NAMES = {
  'x-scissor': 'Tijera X', levitate: 'Levitación', 'energy-ball': 'Energibola', 'keen-eye': 'Vista Lince',
  waterfall: 'Cascada', 'sand-veil': 'Velo Arena', 'volt-absorb': 'Absorbe Electricidad', spikes: 'Púas',
  'run-away': 'Fuga', 'cursed-body': 'Cuerpo Maldito',
};
for (const key of EXCLUDED_CONDITIONS) {
  const [type, value] = key.split(':');
  const name = NAMES[type === 'move' ? 'moves' : 'abilities'][value];
  if (name !== EXPECTED_NAMES[value]) throw new Error(`Exclusión ${key}: PokéAPI la llama "${name}", se esperaba "${EXPECTED_NAMES[value]}"`);
}

const conditionsFor = family => ({
  ability: () => ABILITIES.filter(ability => NAMES.abilities[ability]).map(ability => ({ type: 'ability', ability, abilityMode: 'any', ruleset: 'gen9' })),
  move: () => MOVES.filter(move => NAMES.moves[move]).map(move => ({ type: 'move', move, generation: 9, ruleset: 'gen9' })),
  color: () => COLORS.map(color => ({ type: 'color', color, ruleset: 'gen9' })),
  weight: () => WEIGHT_THRESHOLDS.flatMap(kg => ['more', 'less'].map(comparison => ({ type: 'weight', comparison, kg, ruleset: 'gen9' }))),
  height: () => HEIGHT_THRESHOLDS.flatMap(m => ['more', 'less'].map(comparison => ({ type: 'height', comparison, m, ruleset: 'gen9' }))),
  // "Se obtienen al evolucionar al subir de nivel" se omite: casi todo cumple y suena raro.
  evolution: () => E.EVOLUTION_ROLES.flatMap(role => E.EVOLUTION_METHODS.map(method => ({ type: 'evolution', role, method, ruleset: 'gen9' })))
    .filter(c => !(c.role === 'obtained' && c.method === 'level')),
})[family]();

for (const set of pending) {
  const rand = E.rng(`${set.batch}-v1`);
  const added = [];
  for (const [family, quota] of PLAN) {
    // Primero las consignas que nunca salieron en el banco; después las del banco general.
    const free = E.shuffle(conditionsFor(family).filter(c => !blocked.has(conditionKey(c))), rand);
    const candidates = free.filter(c => !bankConditions.has(conditionKey(c))).concat(free.filter(c => bankConditions.has(conditionKey(c))));
    let made = 0;
    for (const cond of candidates) {
      if (made === quota) break;
      const pokemon = buildCards(family, cond, rand);
      if (!pokemon) continue;
      const difficulty = ['easy', 'normal', 'hard'][added.length % 3];
      const text = E.describeCondition(cond, NAMES);
      const round = {
        id: `${conditionId(cond)}-${set.tag}-${String(added.length + 1).padStart(2, '0')}`,
        family, difficulty, batch: set.batch, question: text.question, rule: text.rule, condition: cond, pokemon,
      };
      rounds.push(round); added.push(round); blocked.add(conditionKey(cond));
      pokemon.forEach(k => { usage[k] = (usage[k] || 0) + 1; });
      made++;
    }
    if (made !== quota) throw new Error(`${set.batch} · ${family}: sólo se pudieron crear ${made}/${quota} rondas`);
  }
  console.log(`Set ${set.batch}: ${added.length} rondas`);
  added.forEach(r => console.log(`  ${r.question}${bankConditions.has(conditionKey(r.condition)) ? '  (también en el banco general)' : ''}`));
}

file.generatedAt = new Date().toISOString();
file.note = `Banco sin resistencia/debilidad + sets de grabación: ${[...new Set(rounds.filter(r => r.batch).map(r => r.batch))].join(', ')}. Las respuestas se recalculan desde pokemon-facts.json.`;
fs.writeFileSync(path.join(DATA, 'rounds.json'), JSON.stringify(file, null, 2));

const used = [...new Set(rounds.flatMap(r => r.pokemon))].sort();
const factsOut = {};
for (const key of used) {
  const p = C.pokemon[key];
  factsOut[key] = {
    key, id: p.id, species: p.species, form: p.form, dex: p.dex, name: displayName(p),
    types: p.types, color: p.color, abilities: p.abilities,
    weightKg: p.weightKg, heightM: p.heightM, evolution: p.evolution,
    learnsets: { gen9: p.learnsets.gen9 && { available: p.learnsets.gen9.available, moves: p.learnsets.gen9.moves, disputed: p.learnsets.gen9.disputed } },
    sprite: `assets/sprites/${p.id}.png`,
  };
}
const namesUsed = { abilities: {}, moves: {}, types: NAMES.types, colors: NAMES.colors };
rounds.forEach(r => {
  if (r.condition.ability) namesUsed.abilities[r.condition.ability] = NAMES.abilities[r.condition.ability];
  if (r.condition.move) namesUsed.moves[r.condition.move] = NAMES.moves[r.condition.move];
});
fs.writeFileSync(path.join(DATA, 'pokemon-facts.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  sources: { A: bundles.A.source + ' · ' + bundles.A.fetchedAt, B: bundles.B.source + ' · ' + bundles.B.fetchedAt },
  rulesets: { gen9: RULESETS.gen9 },
  note: 'Hechos coincidentes entre PokéAPI y Pokémon Showdown. El color es la categoría oficial de Pokédex.',
  typeChart: C.typeChart, checkedMoves: { gen9: MOVES }, names: namesUsed, pokemon: factsOut,
}, null, 1));

const spriteUrl = Object.fromEntries(bundles.A.pokemon.filter(p => !p.missing).map(p => [p.name, p.sprite]));
const spriteDir = path.join(ROOT, 'assets', 'sprites');
fs.mkdirSync(spriteDir, { recursive: true });
for (const key of used) {
  const dest = path.join(spriteDir, `${C.pokemon[key].id}.png`);
  if (fs.existsSync(dest)) continue;
  const response = await fetch(spriteUrl[key]);
  if (!response.ok) throw new Error(`Sprite ${key}: HTTP ${response.status}`);
  fs.writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
}

console.log(`Total del banco: ${rounds.length}`);
