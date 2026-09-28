/* Validador y adaptadores de fuentes con datos SINTÉTICOS: comprobamos que detecta
   cada tipo de error y que nombra al Pokémon que produjo el conflicto. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateRounds } from '../scripts/lib/validate.mjs';
import { buildSourceA, buildSourceB, makeShowdownMapper } from '../scripts/lib/sources.mjs';
import { RULESETS } from '../scripts/catalog.mjs';

const realChart = JSON.parse(fs.readFileSync(new URL('../data/pokemon-facts.json', import.meta.url), 'utf8')).typeChart;
const clone = x => JSON.parse(JSON.stringify(x));
const NAMES = { types: { fire: 'Fuego', ice: 'Hielo' }, abilities: { 'water-absorb': 'Absorbe Agua' }, moves: { 'thunder-punch': 'Puño Trueno' } };

/* 8 Pokémon Agua (resisten Fuego) + 4 Normal (no resisten). */
function fixture() {
  const keys = Array.from({ length: 12 }, (_, i) => `poke${i}`);
  const src = {}, facts = { typeChart: clone(realChart), checkedMoves: { gen9: ['thunder-punch'] }, names: NAMES, pokemon: {} };
  const identities = [];
  keys.forEach((key, i) => {
    const types = i < 8 ? ['water'] : ['normal'];
    const abilities = { normal: [i < 8 ? 'water-absorb' : 'run-away'], hidden: [i === 3 ? 'water-absorb' : 'hydration'], special: [] };
    const moves = i < 8 ? { 'thunder-punch': ['machine'] } : {};
    src[key] = { key, types, abilities, gen9: { available: true, moves }, prevoSpecies: [] };
    facts.pokemon[key] = { key, id: 100 + i, species: `sp${i}`, form: 'default', dex: 100 + i, name: `Poke ${i}`, types,
      abilities: { normal: abilities.normal, hidden: abilities.hidden }, learnsets: { gen9: { available: true, moves, disputed: [] } }, sprite: `assets/sprites/${100 + i}.png` };
    identities.push({ key, id: 100 + i, species: `sp${i}`, dex: 100 + i, form: 'default', abilityAmbiguous: false, prevoKeys: [], prevoUnknown: [] });
  });
  const round = { id: 'fire-res', difficulty: 'easy', question: 'POKÉMON RESISTENTES AL TIPO FUEGO',
    condition: { type: 'resistance', attackingType: 'fire', includeImmunity: true, ruleset: 'gen9' }, pokemon: keys };
  return {
    keys, round, facts, identities,
    SA: { typeChart: clone(realChart), pokemon: clone(src) },
    SB: { typeChart: clone(realChart), pokemon: clone(src) },
  };
}
const run = (f, rounds) => validateRounds({ rounds: rounds || [f.round], facts: f.facts, SA: f.SA, SB: f.SB, identities: f.identities, names: NAMES, rulesets: RULESETS });
const errorsOf = rep => rep.results.flatMap(r => r.errors);

test('una ronda correcta pasa (8 correctos, 4 bombas, ambas fuentes de acuerdo)', () => {
  const rep = run(fixture());
  assert.equal(rep.status, 'PASS', JSON.stringify(errorsOf(rep)));
  assert.equal(rep.results[0].correct, 8);
  assert.equal(rep.results[0].bombs, 4);
  rep.results[0].cards.forEach(c => { assert.equal(c.sourceA.value, c.facts.value); assert.equal(c.sourceB.value, c.facts.value); });
});

test('exactamente 12 Pokémon', () => {
  const f = fixture(); f.round.pokemon = f.keys.slice(0, 11);
  assert.match(JSON.stringify(errorsOf(run(f))), /tiene 11 Pokémon/);
});

test('Pokémon únicos (clave y especie)', () => {
  const f = fixture(); f.round.pokemon = [...f.keys.slice(0, 11), f.keys[0]];
  assert.match(JSON.stringify(errorsOf(run(f))), /repetidos/);
  const g = fixture(); g.facts.pokemon.poke1.species = 'sp0'; g.identities[1].species = 'sp0';
  assert.match(JSON.stringify(errorsOf(run(g))), /misma especie/);
});

test('exactamente 8 correctos y 4 bombas', () => {
  const f = fixture();
  for (const s of [f.SA, f.SB]) s.pokemon.poke8.types = ['water'];
  f.facts.pokemon.poke8.types = ['water'];
  const errs = JSON.stringify(errorsOf(run(f)));
  assert.match(errs, /9 correctos/);
  assert.match(errs, /3 bombas/);
});

test('discrepancia de tipos entre fuentes en un POSITIVO → falla y nombra al Pokémon', () => {
  const f = fixture(); f.SB.pokemon.poke2.types = ['grass'];
  const rep = run(f);
  assert.equal(rep.status, 'FAIL');
  assert.ok(errorsOf(rep).some(e => e.pokemon === 'poke2'));
});

test('discrepancia en un NEGATIVO (impostor) también falla', () => {
  const f = fixture(); f.SA.pokemon.poke10.types = ['fire'];
  const rep = run(f);
  assert.equal(rep.status, 'FAIL');
  assert.ok(errorsOf(rep).some(e => e.pokemon === 'poke10'));
});

test('discrepancia de learnset entre fuentes → DISCREPANCIA', () => {
  const f = fixture();
  f.round = { id: 'tp', difficulty: 'easy', question: 'POKÉMON QUE PUEDEN APRENDER PUÑO TRUENO',
    condition: { type: 'move', move: 'thunder-punch', generation: 9, ruleset: 'gen9' }, pokemon: f.keys };
  assert.equal(run(f).status, 'PASS');
  f.SB.pokemon.poke9.gen9.moves = { 'thunder-punch': ['9S0'] }; // sólo Showdown lo da (p. ej. evento)
  const rep = run(f);
  assert.equal(rep.status, 'FAIL');
  const e = errorsOf(rep).find(x => x.pokemon === 'poke9');
  assert.match(e.error, /DISCREPANCIA/);
});

test('negativo de movimiento cuya pre-evolución lo aprende → falla', () => {
  const f = fixture();
  f.round = { id: 'tp', difficulty: 'easy', question: 'POKÉMON QUE PUEDEN APRENDER PUÑO TRUENO',
    condition: { type: 'move', move: 'thunder-punch', generation: 9, ruleset: 'gen9' }, pokemon: f.keys };
  f.identities[10].prevoKeys = ['poke0'];
  assert.match(JSON.stringify(errorsOf(run(f))), /pre-evolución poke0/);
});

test('impostor de movimiento que lo aprende en otro juego Gen 9 (p. ej. Z-A) → falla', () => {
  const f = fixture();
  f.round = { id: 'tp', difficulty: 'easy', question: 'POKÉMON QUE PUEDEN APRENDER PUÑO TRUENO',
    condition: { type: 'move', move: 'thunder-punch', generation: 9, ruleset: 'gen9' }, pokemon: f.keys };
  f.SA.pokemon.poke8.otherGen9Moves = { 'thunder-punch': ['legends-za'] };
  const e = errorsOf(run(f)).find(x => x.pokemon === 'poke8');
  assert.match(e.error, /otro juego Gen 9/);
});

test('movimiento: Pokémon no disponible en el ruleset → falla', () => {
  const f = fixture();
  f.round = { id: 'tp', difficulty: 'easy', question: 'POKÉMON QUE PUEDEN APRENDER PUÑO TRUENO',
    condition: { type: 'move', move: 'thunder-punch', generation: 9, ruleset: 'gen9' }, pokemon: f.keys };
  f.SA.pokemon.poke11.gen9.available = false;
  assert.ok(errorsOf(run(f)).some(e => e.pokemon === 'poke11'));
});

test('habilidades: oculta cuenta en "any"; discrepancia de habilidad oculta falla', () => {
  const f = fixture();
  f.round = { id: 'wa', difficulty: 'easy', question: 'POKÉMON QUE PUEDEN TENER ABSORBE AGUA',
    condition: { type: 'ability', ability: 'water-absorb', abilityMode: 'any', ruleset: 'gen9' }, pokemon: f.keys };
  assert.equal(run(f).status, 'PASS');
  f.SB.pokemon.poke3.abilities.hidden = ['swift-swim'];
  const rep = run(f);
  assert.ok(errorsOf(rep).some(e => e.pokemon === 'poke3' && /habilidades/.test(e.error)));
});

test('habilidad especial (Showdown "S") o forma con otras habilidades → excluida', () => {
  const f = fixture();
  f.round = { id: 'wa', difficulty: 'easy', question: 'POKÉMON QUE PUEDEN TENER ABSORBE AGUA',
    condition: { type: 'ability', ability: 'water-absorb', abilityMode: 'any', ruleset: 'gen9' }, pokemon: f.keys };
  f.SB.pokemon.poke0.abilities.special = ['battle-bond'];
  f.identities[1].abilityAmbiguous = true;
  const errs = errorsOf(run(f));
  assert.ok(errs.some(e => e.pokemon === 'poke0'));
  assert.ok(errs.some(e => e.pokemon === 'poke1'));
});

test('forma ambigua / no elegible → falla', () => {
  const f = fixture(); f.identities = f.identities.filter(i => i.key !== 'poke4');
  assert.ok(errorsOf(run(f)).some(e => e.pokemon === 'poke4' && /forma no elegible/.test(e.error)));
});

test('forma regional: los datos deben ser los de ESA forma (id/forma coherentes)', () => {
  const f = fixture(); f.facts.pokemon.poke5.form = 'alola';
  assert.ok(errorsOf(run(f)).some(e => e.pokemon === 'poke5' && /identidad/.test(e.error)));
});

test('ruleset, campos de condición y texto de la pregunta', () => {
  const a = fixture(); delete a.round.condition.ruleset;
  assert.match(JSON.stringify(errorsOf(run(a))), /ruleset/);
  const b = fixture(); delete b.round.condition.includeImmunity;
  assert.match(JSON.stringify(errorsOf(run(b))), /includeImmunity/);
  const c = fixture(); c.round.question = 'POKÉMON RESISTENTES AL TIPO AGUA';
  assert.match(JSON.stringify(errorsOf(run(c))), /texto de la pregunta/);
});

test('las tablas de tipos de ambas fuentes deben coincidir', () => {
  const f = fixture(); f.SB.typeChart.steel.ice = 1;
  const rep = run(f);
  assert.equal(rep.status, 'FAIL');
  assert.match(rep.globalErrors.join(), /ice→steel/);
});

test('inmunidad (x0) en una ronda sin inmunidades → falla', () => {
  const f = fixture();
  f.keys.forEach((k, i) => { const t = i < 8 ? ['dark'] : ['normal']; f.SA.pokemon[k].types = t; f.SB.pokemon[k].types = t; f.facts.pokemon[k].types = t; });
  f.round.condition = { type: 'resistance', attackingType: 'ghost', includeImmunity: false, ruleset: 'gen9' };
  f.round.question = 'POKÉMON RESISTENTES AL TIPO FANTASMA';
  const rep = validateRounds({ rounds: [f.round], facts: f.facts, SA: f.SA, SB: f.SB, identities: f.identities,
    names: { ...NAMES, types: { ...NAMES.types, ghost: 'Fantasma' } }, rulesets: RULESETS });
  assert.ok(errorsOf(rep).some(e => /inmune/.test(e.error) && e.pokemon === 'poke8'));
});

/* ─── Adaptadores ─── */
test('Fuente A: sólo cuentan los version groups del ruleset Gen 9', () => {
  const typeRel = { double_damage_from: [], half_damage_from: [], no_damage_from: [] };
  const A = {
    types: ['normal', 'fire', 'water', 'grass', 'electric', 'ice', 'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'].map(name => ({ name, damageRelations: typeRel })),
    species: [{ name: 'foo', evolvesFrom: null }],
    pokemon: [{ name: 'foo', id: 1, species: 'foo', isDefault: true, types: ['water'], sprite: 'x',
      abilities: [{ name: 'torrent', hidden: false, slot: 1 }, { name: 'rain-dish', hidden: true, slot: 3 }],
      versionGroups: ['sword-shield', 'scarlet-violet'],
      gen9Moves: { surf: ['scarlet-violet:machine:0'], 'ice-beam': ['legends-za:machine:0'] } }],
  };
  const SA = buildSourceA(A, RULESETS.gen9);
  assert.deepEqual(SA.pokemon.foo.gen9.moves, { surf: ['machine'] });
  assert.deepEqual(SA.pokemon.foo.abilities, { normal: ['torrent'], hidden: ['rain-dish'], special: [] });
  assert.equal(SA.pokemon.foo.gen9.available, true);
});

test('Fuente B: interpreta los códigos de learnset de Showdown (9L/9M/9E/9S sí; 8M no)', () => {
  const tc = {};
  ['Normal', 'Fire', 'Water', 'Grass', 'Electric', 'Ice', 'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy'].forEach(t => { tc[t] = 0; });
  const typechart = Object.fromEntries(Object.keys(tc).map(t => [t.toLowerCase(), { damageTaken: tc }]));
  const B = {
    pokedex: {
      raichu: { num: 26, name: 'Raichu', types: ['Electric'], abilities: { 0: 'Static', H: 'Lightning Rod' } },
      raichualola: { num: 26, name: 'Raichu-Alola', baseSpecies: 'Raichu', forme: 'Alola', types: ['Electric', 'Psychic'], abilities: { 0: 'Surge Surfer' } },
    },
    learnsets: {
      raichu: { learnset: { thunderpunch: ['9L0', '9M'], surf: ['8M'], dig: ['9E'], flamethrower: ['9S1'] } },
      raichualola: { learnset: { thunderpunch: ['9M'], psychic: ['9L1'] } },
    },
    typechart, formatsData: {},
  };
  const mapper = makeShowdownMapper(B);
  const ids = [
    { key: 'raichu', showdownId: mapper({ key: 'raichu', isDefault: true, species: 'raichu' }, 26) },
    { key: 'raichu-alola', showdownId: mapper({ key: 'raichu-alola', isDefault: false, species: 'raichu' }, 26) },
    { key: 'raichu-mega-x', showdownId: mapper({ key: 'raichu-mega-x', isDefault: false, species: 'raichu' }, 26) },
  ];
  assert.deepEqual(ids.map(i => i.showdownId), ['raichu', 'raichualola', null]);
  const SB = buildSourceB(B, RULESETS.gen9, ids, ['static', 'lightning-rod', 'surge-surfer']);
  assert.deepEqual(Object.keys(SB.pokemon.raichu.gen9.moves).sort(), ['dig', 'flamethrower', 'thunder-punch']);
  assert.equal(SB.pokemon.raichu.gen9.moves.surf, undefined, '8M no es Gen 9');
  assert.deepEqual(SB.pokemon['raichu-alola'].types, ['electric', 'psychic'], 'la forma regional usa SUS tipos');
  assert.deepEqual(SB.pokemon.raichu.types, ['electric']);
  assert.deepEqual(SB.pokemon.raichu.abilities, { normal: ['static'], hidden: ['lightning-rod'], special: [] });
  assert.equal(SB.pokemon['raichu-mega-x'], undefined, 'las megas no se mapean');
});
