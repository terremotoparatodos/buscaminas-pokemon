/* Motor de condiciones: tabla de tipos, doble tipo, inmunidades, habilidades,
   learnsets Gen 9, textos, RNG y barajado. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const E = require('../js/engine.js');
const facts = JSON.parse(fs.readFileSync(new URL('../data/pokemon-facts.json', import.meta.url), 'utf8'));
const chart = facts.typeChart; // validado: PokéAPI == Showdown
const ctx = { typeChart: chart, checkedMoves: { gen9: ['thunder-punch', 'fire-punch'] } };
const mult = (types, atk) => E.typeMultiplier(types, atk, chart);
const res = (types, atk, includeImmunity = true) => E.evaluateCondition({ types }, { type: 'resistance', attackingType: atk, includeImmunity }, ctx).value;
const weak = (types, atk) => E.evaluateCondition({ types }, { type: 'weakness', attackingType: atk }, ctx).value;

test('tabla de tipos completa 18×18 con valores 0 / 0.5 / 1 / 2', () => {
  for (const d of E.TYPES) for (const a of E.TYPES) assert.ok([0, 0.5, 1, 2].includes(chart[d][a]), `${a}→${d}`);
});

test('multiplicadores de Pokémon conocidos (monotipo)', () => {
  assert.equal(mult(['electric'], 'ground'), 2);   // Pikachu
  assert.equal(mult(['water'], 'fire'), 0.5);      // Vaporeon
  assert.equal(mult(['normal'], 'ghost'), 0);      // Snorlax
  assert.equal(mult(['normal'], 'fighting'), 2);
  assert.equal(mult(['dragon'], 'fairy'), 2);
});

test('doble tipo: se multiplican LOS DOS tipos', () => {
  assert.equal(mult(['fire', 'flying'], 'rock'), 4);       // Charizard
  assert.equal(mult(['fire', 'flying'], 'ground'), 0);     // Charizard: inmune por Volador
  assert.equal(mult(['fire', 'flying'], 'grass'), 0.25);   // Charizard
  assert.equal(mult(['water', 'flying'], 'electric'), 4);  // Gyarados
  assert.equal(mult(['water', 'ground'], 'grass'), 4);     // Swampert
  assert.equal(mult(['water', 'ground'], 'electric'), 0);  // Swampert
  assert.equal(mult(['grass', 'steel'], 'fire'), 4);       // Ferrothorn
  assert.equal(mult(['ghost', 'poison'], 'psychic'), 2);   // Gengar
});

test('el segundo tipo puede neutralizar una debilidad o una resistencia', () => {
  assert.equal(mult(['steel', 'flying'], 'ice'), 1);     // Skarmory: Volador débil, Acero resiste
  assert.equal(weak(['steel', 'flying'], 'ice'), false);
  assert.equal(mult(['grass', 'steel'], 'ice'), 1);      // Ferrothorn
  assert.equal(mult(['water', 'grass'], 'fire'), 1);     // Ludicolo: Agua resiste, Planta débil
  assert.equal(res(['water', 'grass'], 'fire'), false);
  assert.equal(mult(['dragon', 'steel'], 'ice'), 1);     // Dialga
  assert.equal(mult(['ground', 'fire'], 'ice'), 1);      // Camerupt
});

test('el orden de los tipos no cambia el resultado', () => {
  for (const a of E.TYPES) assert.equal(mult(['water', 'ground'], a), mult(['ground', 'water'], a));
});

test('resistencia: < 1; la inmunidad cuenta sólo si includeImmunity', () => {
  assert.equal(res(['water'], 'fire'), true);
  assert.equal(res(['fire', 'flying'], 'grass'), true);       // x0.25
  assert.equal(res(['normal'], 'ghost', true), true);         // x0
  assert.equal(res(['normal'], 'ghost', false), false);
  assert.equal(res(['fire'], 'water'), false);
  assert.equal(res(['normal'], 'fire'), false);               // x1 no es resistencia
});

test('debilidad: > 1 (x2 y x4), nunca x1 ni menos', () => {
  assert.equal(weak(['grass'], 'fire'), true);
  assert.equal(weak(['grass', 'steel'], 'fire'), true);       // x4
  assert.equal(weak(['normal'], 'fire'), false);
  assert.equal(weak(['water'], 'fire'), false);
  assert.equal(weak(['flying'], 'ground'), false);            // x0
});

test('tipos inválidos o tabla incompleta lanzan error', () => {
  assert.throws(() => mult([], 'fire'));
  assert.throws(() => mult(['fire', 'water', 'grass'], 'fire'));
  assert.throws(() => mult(['fire'], 'shadow'));
  assert.throws(() => E.typeMultiplier(['fire'], 'water', { fire: {} }));
});

test('habilidades: normal, oculta y cualquiera', () => {
  const vaporeon = { key: 'vaporeon', abilities: { normal: ['water-absorb'], hidden: ['hydration'] } };
  const chinchou = { key: 'chinchou', abilities: { normal: ['volt-absorb', 'illuminate'], hidden: ['water-absorb'] } };
  const c = mode => ({ type: 'ability', ability: 'water-absorb', abilityMode: mode });
  assert.equal(E.evaluateCondition(vaporeon, c('any')).value, true);
  assert.equal(E.evaluateCondition(chinchou, c('any')).value, true);
  assert.equal(E.evaluateCondition(chinchou, c('any')).detail, 'habilidad oculta');
  assert.equal(E.evaluateCondition(vaporeon, c('normal')).value, true);
  assert.equal(E.evaluateCondition(chinchou, c('normal')).value, false);
  assert.equal(E.evaluateCondition(chinchou, c('hidden')).value, true);
  assert.equal(E.evaluateCondition(vaporeon, c('hidden')).value, false);
  assert.throws(() => E.evaluateCondition(vaporeon, c('rara')));
  assert.throws(() => E.evaluateCondition({ key: 'x', abilities: null }, c('any')), /sin verificar/);
});

test('movimientos Gen 9: sólo con ruleset y datos verificados', () => {
  const p = moves => ({ key: 'x', learnsets: { gen9: { available: true, moves, disputed: ['fire-punch'] } } });
  const cond = m => ({ type: 'move', move: m, generation: 9 });
  assert.equal(E.evaluateCondition(p({ 'thunder-punch': ['machine'] }), cond('thunder-punch'), ctx).value, true);
  assert.equal(E.evaluateCondition(p({}), cond('thunder-punch'), ctx).value, false);
  assert.throws(() => E.evaluateCondition(p({}), cond('fire-punch'), ctx), /disputa/);           // discrepancia entre fuentes
  assert.throws(() => E.evaluateCondition(p({}), cond('ice-punch'), ctx), /sin verificar/);      // fuera del catálogo verificado
  assert.throws(() => E.evaluateCondition(p({}), { type: 'move', move: 'thunder-punch', generation: 8 }, ctx), /sin verificar/);
  assert.throws(() => E.evaluateCondition({ key: 'y', learnsets: { gen9: { available: false, moves: {} } } }, cond('thunder-punch'), ctx), /disponible/);
});

test('condiciones mal formadas o desconocidas lanzan error', () => {
  assert.throws(() => E.evaluateCondition({ types: ['fire'] }, { type: 'stats' }), /desconocida/);
  assert.throws(() => E.evaluateCondition({ weightKg: 5 }, { type: 'weight', kg: 10 }), /comparison/);
  assert.throws(() => E.evaluateCondition({ types: ['fire'] }, { type: 'resistance', attackingType: 'water' }, ctx), /includeImmunity/);
  assert.throws(() => E.evaluateCondition({}, { type: 'move', move: 'surf' }, ctx), /generation/);
});

test('textos visibles derivados de la condición', () => {
  const names = { abilities: { 'water-absorb': 'Absorbe Agua' }, moves: { 'thunder-punch': 'Puño Trueno' }, types: { fire: 'Fuego', ice: 'Hielo' } };
  assert.equal(E.describeCondition({ type: 'ability', ability: 'water-absorb', abilityMode: 'any' }, names).question, 'POKÉMON QUE PUEDEN TENER ABSORBE AGUA');
  assert.equal(E.describeCondition({ type: 'move', move: 'thunder-punch', generation: 9 }, names).question, 'POKÉMON QUE PUEDEN APRENDER PUÑO TRUENO');
  assert.equal(E.describeCondition({ type: 'resistance', attackingType: 'fire', includeImmunity: true }, names).question, 'POKÉMON RESISTENTES AL TIPO FUEGO');
  assert.equal(E.describeCondition({ type: 'weakness', attackingType: 'ice' }, names).question, 'POKÉMON DÉBILES AL TIPO HIELO');
  assert.throws(() => E.describeCondition({ type: 'ability', ability: 'levitate', abilityMode: 'any' }, names), /español/);
  assert.equal(E.describeCondition({ type: 'weight', comparison: 'more', kg: 45.5 }, names).question, 'POKÉMON QUE PESAN MÁS DE 45,5 KG');
  assert.equal(E.describeCondition({ type: 'height', comparison: 'less', m: 1.2 }, names).question, 'POKÉMON QUE MIDEN MENOS DE 1,2 M');
  assert.equal(E.describeCondition({ type: 'evolution', role: 'evolves', method: 'stone' }, names).question, 'POKÉMON QUE EVOLUCIONAN CON UNA PIEDRA EVOLUTIVA');
  assert.equal(E.describeCondition({ type: 'evolution', role: 'obtained', method: 'trade' }, names).question, 'POKÉMON QUE SE OBTIENEN AL EVOLUCIONAR POR INTERCAMBIO');
});

test('peso y altura: más / menos estricto; el valor exacto del límite no se puede evaluar', () => {
  const w = (kg, comparison, limit) => E.evaluateCondition({ key: 'x', weightKg: kg }, { type: 'weight', comparison, kg: limit }).value;
  assert.equal(w(105, 'more', 100), true);
  assert.equal(w(99.9, 'more', 100), false);
  assert.equal(w(6.5, 'less', 10), true);
  assert.throws(() => w(100, 'more', 100), /exactamente el límite/);
  const h = (m, comparison, limit) => E.evaluateCondition({ key: 'x', heightM: m }, { type: 'height', comparison, m: limit }).value;
  assert.equal(h(1.1, 'less', 1.2), true);
  assert.equal(h(2.5, 'more', 2), true);
  assert.throws(() => h(1.2, 'less', 1.2), /exactamente el límite/);
  assert.throws(() => E.evaluateCondition({ key: 'x', weightKg: null }, { type: 'weight', comparison: 'more', kg: 10 }), /sin verificar/);
});

test('evolución: cómo evoluciona (evolves) y cómo se obtuvo (obtained)', () => {
  const pikachu = { key: 'pikachu', evolution: { methods: ['item:thunder-stone'], evolvedBy: ['friendship'] } };
  const arcanine = { key: 'arcanine', evolution: { methods: [], evolvedBy: ['item:fire-stone'] } };
  const slowpoke = { key: 'slowpoke', evolution: { methods: ['level', 'item:galarica-cuff'], evolvedBy: [] } };
  const ev = (p, role, method) => E.evaluateCondition(p, { type: 'evolution', role, method }).value;
  assert.equal(ev(pikachu, 'evolves', 'stone'), true);
  assert.equal(ev(pikachu, 'obtained', 'friendship'), true);
  assert.equal(ev(arcanine, 'evolves', 'stone'), false);
  assert.equal(ev(arcanine, 'obtained', 'stone'), true);
  assert.equal(ev(slowpoke, 'evolves', 'stone'), false, 'un objeto que no es piedra no cuenta como piedra');
  // Bombas indiscutibles
  assert.equal(E.isCleanEvolutionNegative(arcanine, { role: 'evolves', method: 'stone' }), false, 'se obtiene con piedra: se presta a confusión');
  assert.equal(E.isCleanEvolutionNegative(slowpoke, { role: 'evolves', method: 'stone' }), false, 'objeto evolutivo raro: discutible');
  assert.equal(E.isCleanEvolutionNegative({ key: 'x', evolution: { methods: ['level'], evolvedBy: [] } }, { role: 'evolves', method: 'trade' }), true);
  assert.equal(E.isCleanEvolutionNegative({ key: 'x', evolution: { methods: ['other'], evolvedBy: [] } }, { role: 'evolves', method: 'trade' }), false);
  assert.throws(() => ev({ key: 'x', evolution: null }, 'evolves', 'trade'), /sin verificar/);
  assert.throws(() => ev(pikachu, 'evolves', 'stone-fire'), /desconocido/);
});

test('RNG con semilla: reproducible y distinto entre semillas', () => {
  const a = E.rng('12345'), b = E.rng('12345'), c = E.rng('54321');
  const sa = Array.from({ length: 20 }, a), sb = Array.from({ length: 20 }, b), sc = Array.from({ length: 20 }, c);
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  sa.forEach(x => assert.ok(x >= 0 && x < 1));
});

test('shuffle: es una permutación, reproducible y no deja siempre el mismo orden', () => {
  const list = Array.from({ length: 12 }, (_, i) => `p${i}`);
  const s1 = E.shuffle(list, E.rng('x')), s2 = E.shuffle(list, E.rng('x'));
  assert.deepEqual(s1, s2);
  assert.deepEqual([...s1].sort(), [...list].sort());
  assert.deepEqual(list, Array.from({ length: 12 }, (_, i) => `p${i}`), 'no muta la lista original');
  // Cada posición recibe elementos distintos a lo largo de muchas semillas (no hay sesgo fijo).
  const firstSlot = new Set(Array.from({ length: 200 }, (_, i) => E.shuffle(list, E.rng(`s${i}`))[0]));
  assert.equal(firstSlot.size, 12);
});
