/* ═══════════════════════════════════════════════════════════════
   BUSCAMINAS POKÉMON · MOTOR DE CONDICIONES
   Compartido por el juego (navegador), el generador, el validador y los tests.
   Nunca guarda "correcto: sí/no": la respuesta se recalcula siempre desde
   los hechos del Pokémon (pokemon-facts) + la condición de la ronda.
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BMEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TYPES = ['normal', 'fire', 'water', 'grass', 'electric', 'ice', 'fighting', 'poison',
    'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'];

  /* Multiplicador de daño de `attackingType` contra un Pokémon, SÓLO por sus tipos.
     typeChart[defensor][atacante] = 0 | 0.5 | 1 | 2. Se multiplican los dos tipos. */
  function typeMultiplier(types, attackingType, typeChart) {
    if (!Array.isArray(types) || types.length < 1 || types.length > 2) throw new Error(`Tipos inválidos: ${types}`);
    if (!TYPES.includes(attackingType)) throw new Error(`Tipo atacante desconocido: ${attackingType}`);
    return types.reduce((acc, t) => {
      const row = typeChart[t];
      if (!row || typeof row[attackingType] !== 'number') throw new Error(`Tabla de tipos incompleta: ${t} ← ${attackingType}`);
      return acc * row[attackingType];
    }, 1);
  }

  /* Cada familia de condición: evaluate() devuelve {value, detail}.
     detail explica el porqué (se muestra en debug y se guarda en verification.json). */
  const CONDITIONS = {
    ability: {
      requires: ['ability', 'abilityMode'],
      evaluate(p, c) {
        const a = p.abilities;
        if (!a || !Array.isArray(a.normal) || !Array.isArray(a.hidden)) throw new Error(`${p.key}: habilidades sin verificar`);
        const inNormal = a.normal.includes(c.ability), inHidden = a.hidden.includes(c.ability);
        const mode = c.abilityMode;
        if (!['any', 'normal', 'hidden'].includes(mode)) throw new Error(`abilityMode inválido: ${mode}`);
        const value = mode === 'any' ? inNormal || inHidden : mode === 'normal' ? inNormal : inHidden;
        return { value, detail: inNormal ? 'habilidad normal' : inHidden ? 'habilidad oculta' : 'no la tiene' };
      },
    },
    move: {
      requires: ['move', 'generation'],
      evaluate(p, c, ctx) {
        const key = `gen${c.generation}`;
        const checked = ctx && ctx.checkedMoves && ctx.checkedMoves[key];
        if (!checked || !checked.includes(c.move)) throw new Error(`Movimiento sin verificar en ${key}: ${c.move}`);
        const ls = p.learnsets && p.learnsets[key];
        if (!ls || !ls.available) throw new Error(`${p.key}: no está disponible en ${key}`);
        if (ls.disputed && ls.disputed.includes(c.move)) throw new Error(`${p.key}: ${c.move} en disputa entre fuentes`);
        const methods = ls.moves[c.move];
        return { value: !!methods, detail: methods ? methods.join('+') : 'no lo aprende' };
      },
    },
    resistance: {
      requires: ['attackingType', 'includeImmunity'],
      evaluate(p, c, ctx) {
        const m = typeMultiplier(p.types, c.attackingType, ctx.typeChart);
        const value = c.includeImmunity ? m < 1 : m < 1 && m > 0;
        return { value, detail: `x${m}`, multiplier: m };
      },
    },
    weakness: {
      requires: ['attackingType'],
      evaluate(p, c, ctx) {
        const m = typeMultiplier(p.types, c.attackingType, ctx.typeChart);
        return { value: m > 1, detail: `x${m}`, multiplier: m };
      },
    },
    /* Ejemplo de familia futura: basta con agregar una entrada acá.
       type: { requires:['pokemonType'], evaluate:(p,c)=>({value:p.types.includes(c.pokemonType)}) } */
  };

  function evaluateCondition(pokemon, condition, ctx) {
    const def = CONDITIONS[condition && condition.type];
    if (!def) throw new Error(`Condición desconocida: ${condition && condition.type}`);
    for (const k of def.requires) if (condition[k] === undefined) throw new Error(`Condición ${condition.type} sin "${k}"`);
    return def.evaluate(pokemon, condition, ctx || {});
  }

  /* ─── Textos visibles (español). Se derivan de la condición: nunca a mano. ─── */
  function describeCondition(c, names) {
    const up = s => String(s).toLocaleUpperCase('es');
    const n = (kind, id) => {
      const v = names && names[kind] && names[kind][id];
      if (!v) throw new Error(`Falta nombre en español para ${kind}:${id}`);
      return v;
    };
    switch (c.type) {
      case 'ability': return {
        question: up(`Pokémon que pueden tener ${n('abilities', c.ability)}`),
        rule: c.abilityMode === 'any' ? 'Habilidad normal u oculta' : c.abilityMode === 'hidden' ? 'Sólo habilidad oculta' : 'Sólo habilidades normales',
      };
      case 'move': return {
        question: up(`Pokémon que pueden aprender ${n('moves', c.move)}`),
        rule: `Gen ${c.generation} · Escarlata/Púrpura + DLC · cualquier método`,
      };
      case 'resistance': return {
        question: up(`Pokémon resistentes al tipo ${n('types', c.attackingType)}`),
        rule: c.includeImmunity ? 'Sólo por tipos · la inmunidad cuenta' : 'Sólo por tipos · sin inmunidades',
      };
      case 'weakness': return {
        question: up(`Pokémon débiles al tipo ${n('types', c.attackingType)}`),
        rule: 'Sólo por tipos (x2 o x4)',
      };
      default: throw new Error(`Condición desconocida: ${c.type}`);
    }
  }

  /* Evalúa una ronda entera contra los hechos. */
  function solveRound(round, facts) {
    const ctx = { typeChart: facts.typeChart, checkedMoves: facts.checkedMoves };
    return round.pokemon.map(key => {
      const p = facts.pokemon[key];
      if (!p) throw new Error(`Pokémon sin hechos: ${key}`);
      const r = evaluateCondition(p, round.condition, ctx);
      return { key, correct: r.value, detail: r.detail, multiplier: r.multiplier };
    });
  }

  /* ─── RNG reproducible (mulberry32) + hash de texto a semilla ─── */
  function hashSeed(str) {
    let h = 1779033703 ^ String(str).length;
    for (let i = 0; i < String(str).length; i++) {
      h = Math.imul(h ^ String(str).charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  }
  function rng(seed) {
    let a = (typeof seed === 'number' ? seed : hashSeed(seed)) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(list, rand) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  return { TYPES, CONDITIONS, typeMultiplier, evaluateCondition, describeCondition, solveRound, hashSeed, rng, shuffle };
});
