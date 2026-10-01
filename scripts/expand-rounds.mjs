/* Amplía el banco existente sin modificar ninguna ronda ya publicada.
   Agrega un set cerrado de 20 rondas exclusivas para la grabación del 2026-10-02. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ABILITIES, COLORS, MOVES, TYPES, RULESETS } from './catalog.mjs';
import { loadBundles } from './lib/sources.mjs';
import { buildConsensus, displayName, isCleanMoveNegative, spanishNames } from './lib/dataset.mjs';

const require = createRequire(import.meta.url);
const E = require('../js/engine.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const TARGET = 118;
const BATCH = 'grabacion-2026-10-02';
const bundles = loadBundles(ROOT);
const C = buildConsensus(bundles, RULESETS.gen9);
const NAMES = spanishNames(bundles.A);
const ctx = { typeChart: C.typeChart, checkedMoves: { gen9: MOVES } };
const file = JSON.parse(fs.readFileSync(path.join(DATA, 'rounds.json'), 'utf8'));
const rounds = file.rounds;

if (rounds.filter(r => r.batch === BATCH).length === 20) {
  console.log(`El banco ya tiene ${rounds.length} rondas; no se agregaron más.`);
  process.exit(0);
}
if (rounds.length !== 98) throw new Error(`Se esperaban las 98 rondas publicadas antes de crear el set exclusivo; hay ${rounds.length}`);

const usage = {};
rounds.flatMap(r => r.pokemon).forEach(k => { usage[k] = (usage[k] || 0) + 1; });
const usedConditions = new Set(rounds.map(r => conditionKey(r.condition)));
const rand = E.rng('grabacion-2026-10-02-v1');
const ALL = Object.values(C.pokemon);
const GEN_SCORE = { 1: 6, 2: 5, 3: 4.5, 4: 4, 5: 3.5, 6: 3, 7: 2.7, 8: 2.4, 9: 2.5 };
const familiar = p => (GEN_SCORE[p.generation] || 2) + (p.finalStage ? 1 : 0) - (p.region ? 0.5 : 0);

function conditionKey(c) {
  return `${c.type}:${c.ability || c.move || c.attackingType || c.color}`;
}
function conditionId(c) {
  return `${c.type}-${c.ability || c.move || c.attackingType || c.color}`;
}
function poolFor(family, cond) {
  if (family === 'ability') return ALL.filter(p => p.abilities);
  if (family === 'move') return ALL.filter(p => p.learnsets.gen9 && p.learnsets.gen9.available && !p.learnsets.gen9.disputed.includes(cond.move));
  if (family === 'color') return ALL.filter(p => p.color);
  return ALL;
}
function pickDistinct(candidates, count, already = []) {
  const dex = new Set(already.map(p => p.dex));
  const out = [];
  const ranked = candidates.map(p => ({ p, score: familiar(p) - 2.5 * (usage[p.key] || 0) + rand() }))
    .sort((a, b) => b.score - a.score || a.p.key.localeCompare(b.p.key));
  for (const { p } of ranked) {
    if (out.length === count) break;
    if (dex.has(p.dex)) continue;
    dex.add(p.dex); out.push(p);
  }
  return out.length === count ? out : null;
}
function buildCards(family, cond) {
  const pool = poolFor(family, cond);
  const positives = pool.filter(p => E.evaluateCondition(p, cond, ctx).value);
  let negatives = pool.filter(p => !E.evaluateCondition(p, cond, ctx).value);
  if (family === 'move') negatives = negatives.filter(p => isCleanMoveNegative(C, p.key, cond.move));
  const pos = pickDistinct(positives, 8);
  const neg = pos && pickDistinct(negatives, 4, pos);
  if (!pos || !neg) return null;
  const keys = pos.concat(neg).map(p => p.key).sort();
  if (rounds.some(r => r.pokemon.slice().sort().join() === keys.join())) return null;
  return keys;
}

const candidates = {
  color: COLORS.map(color => ({ type: 'color', color, ruleset: 'gen9' })),
  ability: ABILITIES.filter(ability => NAMES.abilities[ability]).map(ability => ({ type: 'ability', ability, abilityMode: 'any', ruleset: 'gen9' })),
  move: MOVES.filter(move => NAMES.moves[move]).map(move => ({ type: 'move', move, generation: 9, ruleset: 'gen9' })),
  resistance: TYPES.map(attackingType => ({ type: 'resistance', attackingType, includeImmunity: true, ruleset: 'gen9' })),
  weakness: TYPES.map(attackingType => ({ type: 'weakness', attackingType, ruleset: 'gen9' })),
};
for (const family of Object.keys(candidates)) {
  candidates[family] = E.shuffle(candidates[family].filter(c => !usedConditions.has(conditionKey(c))), rand);
}

const plan = [['ability', 9], ['move', 8], ['resistance', 2], ['weakness', 1]];
const added = [];
for (const [family, quota] of plan) {
  let made = 0;
  for (const cond of candidates[family]) {
    if (made === quota || rounds.length === TARGET) break;
    const pokemon = buildCards(family, cond);
    if (!pokemon) continue;
    const difficulty = ['easy', 'normal', 'hard'][added.length % 3];
    const text = E.describeCondition(cond, NAMES);
    const round = {
      id: `${conditionId(cond)}-manana-${String(added.length + 1).padStart(2, '0')}`,
      family, difficulty, batch: BATCH, question: text.question, rule: text.rule, condition: cond, pokemon,
    };
    rounds.push(round); added.push(round); usedConditions.add(conditionKey(cond));
    pokemon.forEach(k => { usage[k] = (usage[k] || 0) + 1; });
    made++;
  }
  if (made !== quota) throw new Error(`${family}: sólo se pudieron crear ${made}/${quota} rondas nuevas`);
}
if (rounds.length !== TARGET || added.length !== 20) throw new Error(`Se esperaban 20 nuevas y ${TARGET} totales; hay ${added.length} y ${rounds.length}`);

file.generatedAt = new Date().toISOString();
file.note = '48 originales + 50 alternativas + 20 exclusivas para grabacion-2026-10-02. Las respuestas se recalculan desde pokemon-facts.json.';
fs.writeFileSync(path.join(DATA, 'rounds.json'), JSON.stringify(file, null, 2));

const used = [...new Set(rounds.flatMap(r => r.pokemon))].sort();
const factsOut = {};
for (const key of used) {
  const p = C.pokemon[key];
  factsOut[key] = {
    key, id: p.id, species: p.species, form: p.form, dex: p.dex, name: displayName(p),
    types: p.types, color: p.color, abilities: p.abilities,
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

console.log(`Set ${BATCH}: ${added.length} rondas exclusivas · total del banco: ${rounds.length}`);
