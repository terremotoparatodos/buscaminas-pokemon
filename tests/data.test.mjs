/* Integridad del dataset versionado (data/*.json) y, si existe la caché de fuentes
   (.cache/, se genera con npm run fetch), comprobaciones contra las fuentes reales. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../js/engine.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const rounds = read('rounds.json').rounds;
const facts = read('pokemon-facts.json');
const verification = read('verification.json');
const HAS_CACHE = fs.existsSync(path.join(ROOT, '.cache/pokeapi/bundle.json')) && fs.existsSync(path.join(ROOT, '.cache/showdown/bundle.json'));

test('verification.json: PASS y cada carta confirmada por las DOS fuentes', () => {
  assert.equal(verification.status, 'PASS');
  assert.equal(verification.summary.invalid, 0);
  assert.equal(verification.rounds.length, rounds.length);
  for (const r of verification.rounds) {
    assert.equal(r.status, 'PASS', r.id);
    assert.equal(r.cards.length, 12);
    for (const c of r.cards) {
      assert.equal(c.sourceA.confirmed, true, `${r.id}/${c.pokemon} A`);
      assert.equal(c.sourceB.confirmed, true, `${r.id}/${c.pokemon} B`);
    }
  }
  assert.ok(verification.sources.B.commit && /^[0-9a-f]{40}$/.test(verification.sources.B.commit), 'Showdown fijado a un commit');
});

test('rounds.json no guarda respuestas: se recalculan con el motor', () => {
  for (const r of rounds) {
    assert.equal(r.correct, undefined);
    assert.equal(JSON.stringify(r).includes('"correct"'), false);
    const s = E.solveRound(r, facts);
    assert.equal(s.filter(x => x.correct).length, 8, r.id);
  }
});

test('cada condición declara ruleset y los campos de su familia', () => {
  for (const r of rounds) {
    const c = r.condition;
    assert.equal(c.ruleset, 'gen9', r.id);
    if (c.type === 'ability') assert.ok(['any', 'normal', 'hidden'].includes(c.abilityMode));
    if (c.type === 'move') assert.equal(c.generation, 9);
    if (c.type === 'resistance') assert.equal(typeof c.includeImmunity, 'boolean');
    if (c.type === 'color') assert.ok(facts.names.colors[c.color], r.id);
    assert.equal(E.describeCondition(c, facts.names).question, r.question);
  }
});

test('ids de ronda únicos y banco equilibrado por familia', () => {
  assert.equal(new Set(rounds.map(r => r.id)).size, rounds.length);
  const fam = {};
  rounds.forEach(r => { fam[r.family] = (fam[r.family] || 0) + 1; });
  assert.deepEqual(Object.keys(fam).sort(), ['ability', 'color', 'evolution', 'height', 'move', 'weight']);
});

test('sin rondas de resistencia ni debilidad (retiradas del banco)', () => {
  assert.ok(rounds.every(r => r.condition.type !== 'resistance' && r.condition.type !== 'weakness'));
});

test('quedan 42 alternativas, incluidas las 10 categorías de color Pokédex', () => {
  assert.equal(rounds.filter(r => /-alt-\d+$/.test(r.id)).length, 42);
  const colors = rounds.filter(r => r.family === 'color' && !r.batch);
  assert.equal(colors.length, 10);
  assert.equal(new Set(colors.map(r => r.condition.color)).size, 10);
  for (const r of colors) assert.match(r.rule, /Color oficial/);
});

test('set grabacion-2026-10-02: 17 consignas exclusivas que no repiten ninguna de las 66 anteriores', () => {
  assert.equal(rounds.length, 123);
  const batch = rounds.filter(r => r.batch === 'grabacion-2026-10-02');
  const previous = rounds.filter(r => !r.batch);
  assert.equal(batch.length, 17);
  const key = r => `${r.condition.type}:${r.condition.ability || r.condition.move || r.condition.attackingType || r.condition.color}`;
  const oldConditions = new Set(previous.map(key));
  assert.equal(new Set(batch.map(key)).size, 17);
  assert.ok(batch.every(r => !oldConditions.has(key(r))));
  assert.equal(new Set(batch.map(r => r.question)).size, 17);
});

test('sets de video 2026-10-14: 20 rondas cada uno, sin consignas ya grabadas ni repetidas', () => {
  // Peso/altura: el mismo límite cuenta como la misma consigna aunque cambie más/menos.
  const c = r => r.condition;
  const key = r => `${c(r).type}:${c(r).ability || c(r).move || c(r).color || c(r).kg || c(r).m || `${c(r).role}:${c(r).method}`}`;
  const recorded = new Set([
    ...rounds.filter(r => r.batch === 'grabacion-2026-10-02').map(key),
    'move:x-scissor', 'ability:levitate', 'move:energy-ball', 'ability:keen-eye', 'move:waterfall',
    'ability:sand-veil', 'ability:volt-absorb', 'move:spikes', 'ability:run-away', 'ability:cursed-body',
  ]);
  const both = [];
  for (const name of ['video-1-2026-10-14', 'video-2-2026-10-14']) {
    const set = rounds.filter(r => r.batch === name);
    assert.equal(set.length, 20, name);
    const fam = {};
    set.forEach(r => { fam[r.family] = (fam[r.family] || 0) + 1; });
    assert.deepEqual(fam, { ability: 5, move: 4, color: 2, weight: 3, height: 3, evolution: 3 }, name);
    assert.ok(set.every(r => !recorded.has(key(r))), `${name} repite una consigna ya grabada`);
    both.push(...set);
  }
  assert.equal(new Set(both.map(key)).size, 40, 'ninguna consigna se repite entre los dos videos');
});

test('formas: cada carta identifica species + form + id; regionales con su propio id', () => {
  for (const [key, p] of Object.entries(facts.pokemon)) {
    assert.ok(p.species && p.form && Number.isInteger(p.id), key);
    if (p.form === 'default') assert.equal(key, p.species);
    else {
      assert.equal(key, `${p.species}-${p.form}`);
      assert.ok(p.id > 10000, `${key}: una forma regional tiene id propio en PokéAPI`);
      assert.match(p.name, / de (Alola|Galar|Hisui|Paldea)/);
    }
    assert.ok(fs.existsSync(path.join(ROOT, p.sprite)), `sprite local de ${key}`);
  }
});

test('ninguna forma ambigua en el juego (Rotom, Ogerpon, Necrozma, megas, gmax…)', () => {
  for (const key of Object.keys(facts.pokemon)) {
    assert.doesNotMatch(key, /-(mega|gmax|totem|primal)(-|$)/);
    assert.doesNotMatch(key, /^(rotom|ogerpon|necrozma|castform|oricorio|arceus|silvally|calyrex|zacian|zamazenta|hoopa)(-|$)/);
  }
});

test('forma regional con datos de SU forma (fuentes reales)', { skip: !HAS_CACHE && 'sin .cache/' }, async () => {
  const { loadBundles, buildSourceA, buildSourceB } = await import('../scripts/lib/sources.mjs');
  const { buildIdentities } = await import('../scripts/lib/dataset.mjs');
  const { RULESETS } = await import('../scripts/catalog.mjs');
  const b = loadBundles(ROOT);
  const { identities } = buildIdentities(b.A, b.B);
  const SA = buildSourceA(b.A, RULESETS.gen9);
  const SB = buildSourceB(b.B, RULESETS.gen9, identities, b.A.abilities.map(a => a.name));
  const id = Object.fromEntries(identities.map(i => [i.key, i]));
  for (const [key, types] of [['raichu', ['electric']], ['raichu-alola', ['electric', 'psychic']],
    ['ninetales', ['fire']], ['ninetales-alola', ['ice', 'fairy']], ['slowbro-galar', ['poison', 'psychic']]]) {
    assert.deepEqual(SA.pokemon[key].types, types, `A ${key}`);
    assert.deepEqual(SB.pokemon[key].types, types, `B ${key}`);
  }
  assert.equal(id['raichu-alola'].showdownId, 'raichualola');
  assert.equal(id['raichu'].showdownId, 'raichu');
  // Formas excluidas a propósito
  for (const k of ['rotom', 'rotom-wash', 'ogerpon', 'necrozma', 'charizard-mega-x', 'tauros-paldea-combat-breed']) assert.equal(id[k], undefined, k);
  // Hidden ability: Chinchou tiene Absorbe Agua como oculta en ambas fuentes
  assert.ok(SA.pokemon.chinchou.abilities.hidden.includes('water-absorb'));
  assert.ok(SB.pokemon.chinchou.abilities.hidden.includes('water-absorb'));
  // Learnset Gen 9: disponibilidad coincide entre fuentes
  assert.equal(SA.pokemon.pikachu.gen9.available, true);
  assert.equal(SB.pokemon.pikachu.gen9.available, true);
});

test('las tablas de tipos de PokéAPI y Showdown son idénticas (fuentes reales)', { skip: !HAS_CACHE && 'sin .cache/' }, async () => {
  const { loadBundles, buildSourceA, buildSourceB } = await import('../scripts/lib/sources.mjs');
  const { RULESETS } = await import('../scripts/catalog.mjs');
  const b = loadBundles(ROOT);
  const A = buildSourceA(b.A, RULESETS.gen9).typeChart, B = buildSourceB(b.B, RULESETS.gen9, [], []).typeChart;
  assert.deepEqual(A, B);
  assert.deepEqual(A, facts.typeChart);
});
