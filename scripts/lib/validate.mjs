/* Núcleo del validador. Recibe todo por parámetro para poder testearlo con datos sintéticos.

   Una ronda es VÁLIDA sólo si:
   1. tiene 12 Pokémon distintos (clave y especie);
   2-3. el motor da exactamente 8 correctos y 4 bombas;
   4-5. cada carta (positiva Y negativa) da el mismo resultado con la Fuente A, con la
        Fuente B y con pokemon-facts.json;
   6. ninguna carta es una forma ambigua (sólo formas por defecto/regionales elegibles);
   7. la condición declara un ruleset conocido y todos sus campos;
   8. no hay discrepancias entre fuentes en ningún dato que use la condición;
   9. un impostor de movimiento no lo aprende tampoco en otro juego Gen 9 (ni su pre-evolución). */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('../../js/engine.js');

const DIFFICULTIES = ['easy', 'normal', 'hard'];
const sameSet = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && [...a].sort().join() === [...b].sort().join();

/* Adapta la entrada de una fuente a la forma que espera el motor. */
export const engineShape = s => s && ({
  key: s.key, types: s.types, color: s.color,
  abilities: { normal: s.abilities.normal, hidden: s.abilities.hidden },
  learnsets: { gen9: { available: s.gen9.available, moves: s.gen9.moves, disputed: [] } },
});

function safeEval(p, cond, ctx) {
  try { const r = E.evaluateCondition(p, cond, ctx); return { value: r.value, detail: r.detail }; }
  catch (err) { return { error: err.message }; }
}

export function validateRounds({ rounds, facts, SA, SB, identities, names, rulesets, spriteExists }) {
  const globalErrors = [];
  for (const d of E.TYPES) for (const a of E.TYPES) {
    const va = SA.typeChart[d][a], vb = SB.typeChart[d][a], vf = facts.typeChart[d] && facts.typeChart[d][a];
    if (!(va === vb && vb === vf)) globalErrors.push(`Tabla de tipos ${a}→${d}: A=${va} B=${vb} facts=${vf}`);
  }
  const idByKey = Object.fromEntries(identities.map(i => [i.key, i]));
  const seenIds = new Set();
  const results = [];

  for (const round of rounds) {
    const errors = [];
    const fail = (msg, pokemon) => errors.push(pokemon ? { pokemon, error: msg } : { error: msg });
    const cond = round.condition || {};
    if (seenIds.has(round.id)) fail(`id de ronda repetido: ${round.id}`);
    seenIds.add(round.id);
    if (!DIFFICULTIES.includes(round.difficulty)) fail(`dificultad inválida: ${round.difficulty}`);

    // 7. Condición y ruleset
    const def = E.CONDITIONS[cond.type];
    const ruleset = rulesets[cond.ruleset];
    if (!def) fail(`tipo de condición desconocido: ${cond.type}`);
    else for (const k of def.requires) if (cond[k] === undefined) fail(`la condición no define "${k}"`);
    if (!ruleset) fail(`ruleset no definido o desconocido: ${cond.ruleset}`);
    if (cond.type === 'move' && ruleset && cond.generation !== ruleset.showdownGeneration) fail(`generación ${cond.generation} no coincide con el ruleset ${cond.ruleset}`);
    if (cond.type === 'move' && !(facts.checkedMoves.gen9 || []).includes(cond.move)) fail(`movimiento fuera del catálogo verificado: ${cond.move}`);
    if (cond.type === 'ability' && !['any', 'normal', 'hidden'].includes(cond.abilityMode)) fail(`abilityMode inválido: ${cond.abilityMode}`);
    if (cond.type === 'resistance' && typeof cond.includeImmunity !== 'boolean') fail('includeImmunity debe ser true/false');
    try {
      const text = E.describeCondition(cond, names);
      if (text.question !== round.question) fail(`texto de la pregunta no coincide con la condición ("${round.question}" ≠ "${text.question}")`);
    } catch (err) { fail(`texto: ${err.message}`); }

    // 1. 12 distintos
    const keys = Array.isArray(round.pokemon) ? round.pokemon : [];
    if (keys.length !== 12) fail(`tiene ${keys.length} Pokémon (deben ser 12)`);
    if (new Set(keys).size !== keys.length) fail('hay Pokémon repetidos');
    const species = keys.map(k => facts.pokemon[k] && facts.pokemon[k].species);
    if (new Set(species).size !== species.length) fail('hay dos cartas de la misma especie');

    const cards = [];
    const ctxF = { typeChart: facts.typeChart, checkedMoves: facts.checkedMoves };
    const ctxA = { typeChart: SA.typeChart, checkedMoves: facts.checkedMoves };
    const ctxB = { typeChart: SB.typeChart, checkedMoves: facts.checkedMoves };
    for (const key of keys) {
      const f = facts.pokemon[key], a = SA.pokemon[key], b = SB.pokemon[key], id = idByKey[key];
      const card = { pokemon: key, name: f && f.name };
      cards.push(card);
      if (!f) { fail('no está en pokemon-facts.json', key); continue; }
      // 6. Identidad / forma
      if (!id) { fail('forma no elegible (ambigua o excluida)', key); continue; }
      if (f.id !== id.id || f.species !== id.species || f.form !== id.form || f.dex !== id.dex) fail(`identidad inconsistente (id/species/form) ${f.id}/${f.species}/${f.form}`, key);
      if (!a) { fail('no existe en la Fuente A (PokéAPI)', key); continue; }
      if (!b) { fail(`no existe en la Fuente B (Showdown) (${id.showdownId || 'sin mapeo'})`, key); continue; }
      if (spriteExists && !spriteExists(f)) fail(`falta el sprite local ${f.sprite}`, key);
      // 8. Datos base de cada fuente
      if (!sameSet(a.types, b.types) || !sameSet(a.types, f.types)) fail(`tipos: A=${a.types} B=${b.types} facts=${f.types}`, key);
      if (cond.type === 'color' && (!(a.color && b.color && f.color) || a.color !== b.color || b.color !== f.color)) {
        fail(`color Pokédex: A=${a.color} B=${b.color} facts=${f.color}`, key);
      }
      if (cond.type === 'ability') {
        if (b.abilities.special && b.abilities.special.length) fail(`habilidad especial en Showdown (${b.abilities.special})`, key);
        if (id.abilityAmbiguous) fail('otra forma de la especie tiene habilidades distintas', key);
        if (!sameSet(a.abilities.normal, b.abilities.normal) || !sameSet(a.abilities.hidden, b.abilities.hidden)) {
          fail(`habilidades: A=${JSON.stringify(a.abilities)} B=${JSON.stringify(b.abilities)}`, key);
        }
      }
      if (cond.type === 'move' && (!a.gen9.available || !b.gen9.available)) fail(`disponibilidad en ${cond.ruleset}: A=${a.gen9.available} B=${b.gen9.available}`, key);
      // 4-5. Evaluación por separado
      const rA = safeEval(engineShape(a), cond, ctxA), rB = safeEval(engineShape(b), cond, ctxB), rF = safeEval(f, cond, ctxF);
      Object.assign(card, { sourceA: rA, sourceB: rB, facts: rF });
      if (rA.error || rB.error || rF.error) { fail(`no se pudo evaluar: ${rA.error || rB.error || rF.error}`, key); continue; }
      if (!(rA.value === rB.value && rB.value === rF.value)) {
        fail(`DISCREPANCIA: A=${rA.value} (${rA.detail}) B=${rB.value} (${rB.detail}) facts=${rF.value}`, key);
        continue;
      }
      card.answer = rF.value ? 'correct' : 'bomb';
      if (cond.type === 'resistance' && !cond.includeImmunity && rF.detail === 'x0') fail('inmune en una ronda sin inmunidades', key);
      // Negativo de movimiento: tampoco lo aprende ninguna pre-evolución (en ninguna fuente).
      if (cond.type === 'move' && !rF.value) {
        const other = [...((a.otherGen9Moves || {})[cond.move] || []), ...((b.otherGen9Moves || {})[cond.move] || [])].join(', ');
        if (other) fail(`impostor discutible: lo aprende en otro juego Gen 9 (${other})`, key);
        for (const pk of id.prevoKeys || []) {
          const pa = SA.pokemon[pk], pb = SB.pokemon[pk];
          if (!pa || !pb) fail(`pre-evolución sin datos en ambas fuentes: ${pk}`, key);
          else if (pa.gen9.moves[cond.move] || pb.gen9.moves[cond.move]) fail(`su pre-evolución ${pk} puede aprenderlo`, key);
          else if ((pa.otherGen9Moves || {})[cond.move] || (pb.otherGen9Moves || {})[cond.move]) fail(`su pre-evolución ${pk} lo aprende en otro juego Gen 9`, key);
        }
        if ((id.prevoUnknown || []).length) fail(`pre-evoluciones sin identificar: ${id.prevoUnknown}`, key);
      }
    }
    // 2-3. 8 + 4
    const nOk = cards.filter(c => c.answer === 'correct').length, nBomb = cards.filter(c => c.answer === 'bomb').length;
    if (nOk !== 8) fail(`tiene ${nOk} correctos (deben ser 8)`);
    if (nBomb !== 4) fail(`tiene ${nBomb} bombas (deben ser 4)`);
    results.push({ id: round.id, status: errors.length ? 'FAIL' : 'PASS', ruleset: cond.ruleset, condition: cond, correct: nOk, bombs: nBomb, errors, cards });
  }
  const invalid = results.filter(r => r.status === 'FAIL').length;
  return { status: globalErrors.length || invalid ? 'FAIL' : 'PASS', globalErrors, results, total: results.length, valid: results.length - invalid, invalid };
}
