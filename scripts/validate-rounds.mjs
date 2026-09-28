/* VALIDADOR · comprueba cada ronda desde cero contra las DOS fuentes por separado.
   Si todo pasa escribe data/verification.json, marca verified en rounds.json y genera
   data/game-data.js (lo único que carga el juego). Si algo falla: VALIDATION FAILED,
   se muestra qué Pokémon produjo el conflicto y NO se genera game-data.js.

   Uso: node scripts/validate-rounds.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULESETS } from './catalog.mjs';
import { loadBundles, buildSourceA, buildSourceB, norm } from './lib/sources.mjs';
import { buildIdentities, spanishNames } from './lib/dataset.mjs';
import { validateRounds } from './lib/validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const readJson = f => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

const roundsFile = readJson('rounds.json');
const facts = readJson('pokemon-facts.json');
const bundles = loadBundles(ROOT);

// Cada fuente se reconstruye por su lado desde los datos crudos.
const { identities } = buildIdentities(bundles.A, bundles.B);
const SA = buildSourceA(bundles.A, RULESETS.gen9);
const SB = buildSourceB(bundles.B, RULESETS.gen9, identities, bundles.A.abilities.map(a => a.name));

// Pre-evoluciones según A ∪ B (para exigir negativos de movimiento "limpios").
const bySpecies = {};
identities.forEach(i => (bySpecies[i.species] ||= []).push(i.key));
const speciesByNorm = Object.fromEntries(bundles.A.species.map(s => [norm(s.name), s.name]));
for (const id of identities) {
  const a = SA.pokemon[id.key], b = SB.pokemon[id.key];
  const sp = new Set([...(a ? a.prevoSpecies : []), ...(b ? b.prevoSpecies.map(n => speciesByNorm[n] || `?${n}`) : [])]);
  id.prevoKeys = [];
  id.prevoUnknown = [];
  for (const s of sp) (bySpecies[s] ? id.prevoKeys.push(...bySpecies[s]) : id.prevoUnknown.push(s));
}

// Los nombres en español se vuelven a leer de PokéAPI (no del archivo de hechos).
const names = spanishNames(bundles.A);
for (const kind of ['abilities', 'moves']) {
  for (const [k, v] of Object.entries(facts.names[kind])) {
    if (names[kind][k] !== v) throw new Error(`Nombre en español alterado en pokemon-facts: ${kind}.${k}`);
  }
}

const report = validateRounds({
  rounds: roundsFile.rounds, facts, SA, SB, identities, names, rulesets: RULESETS,
  spriteExists: f => fs.existsSync(path.join(ROOT, f.sprite)),
});

const validatedAt = new Date().toISOString();
const sources = {
  A: { name: 'PokéAPI', detail: bundles.A.source, fetchedAt: bundles.A.fetchedAt },
  B: { name: 'Pokémon Showdown', detail: bundles.B.source, commit: bundles.B.commit, fetchedAt: bundles.B.fetchedAt },
};
fs.writeFileSync(path.join(DATA, 'verification.json'), JSON.stringify({
  validatedAt, validator: 'scripts/validate-rounds.mjs', status: report.status, sources, rulesets: RULESETS,
  summary: { total: report.total, valid: report.valid, invalid: report.invalid }, globalErrors: report.globalErrors,
  rounds: report.results.map(r => ({
    id: r.id, status: r.status, ruleset: r.ruleset, condition: r.condition, errors: r.errors,
    cards: r.cards.map(c => ({
      pokemon: c.pokemon, name: c.name, answer: c.answer,
      sourceA: c.sourceA && (c.sourceA.error ? { error: c.sourceA.error } : { value: c.sourceA.value, detail: c.sourceA.detail, confirmed: c.sourceA.value === c.facts?.value }),
      sourceB: c.sourceB && (c.sourceB.error ? { error: c.sourceB.error } : { value: c.sourceB.value, detail: c.sourceB.detail, confirmed: c.sourceB.value === c.facts?.value }),
    })),
  })),
}, null, 1));

console.log(`Rondas: ${report.total} · válidas: ${report.valid} · inválidas: ${report.invalid}`);
if (report.status !== 'PASS') {
  console.log('\nVALIDATION FAILED\n');
  report.globalErrors.forEach(e => console.log(`  ✗ ${e}`));
  for (const r of report.results.filter(x => x.status === 'FAIL')) {
    console.log(`  ✗ ${r.id}`);
    r.errors.forEach(e => console.log(`      ${e.pokemon ? `[${e.pokemon}] ` : ''}${e.error}`));
  }
  process.exit(1);
}

// PASS → marcar y construir el paquete del juego (sólo rondas validadas).
roundsFile.rounds.forEach(r => { r.verified = true; r.verifiedAt = validatedAt; });
fs.writeFileSync(path.join(DATA, 'rounds.json'), JSON.stringify(roundsFile, null, 2));

const byRound = Object.fromEntries(report.results.map(r => [r.id, r]));
const game = {
  builtAt: validatedAt,
  validation: { status: 'PASS', validatedAt, rounds: report.valid, sources },
  facts: { typeChart: facts.typeChart, checkedMoves: facts.checkedMoves, names: facts.names, pokemon: facts.pokemon },
  rounds: roundsFile.rounds,
  audit: Object.fromEntries(report.results.map(r => [r.id, r.cards.map(c => [c.pokemon, c.sourceA.detail, c.sourceB.detail])])),
};
if (Object.keys(byRound).length !== game.rounds.length) throw new Error('inconsistencia interna');
fs.writeFileSync(path.join(DATA, 'game-data.js'),
  `/* Generado por scripts/validate-rounds.mjs — NO editar a mano. */\nwindow.BUSCAMINAS_DATA = ${JSON.stringify(game)};\n`);
console.log('\nVALIDATION: PASS');
console.log(`INVALID ROUNDS IN GAME: 0 · data/game-data.js con ${game.rounds.length} rondas`);
