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

  const EVOLUTION_METHODS = ['stone', 'trade', 'friendship', 'level'];
  const EVOLUTION_ROLES = ['evolves', 'obtained'];
  const EVOLUTION_STONES = ['fire-stone', 'water-stone', 'thunder-stone', 'leaf-stone', 'moon-stone',
    'sun-stone', 'shiny-stone', 'dusk-stone', 'dawn-stone', 'ice-stone'];
  /* Métodos en los hechos: 'level' | 'friendship' | 'trade' | 'item:<objeto>' | 'other'. */
  const matchesMethod = (m, method) => (method === 'stone' ? m.startsWith('item:') && EVOLUTION_STONES.includes(m.slice(5)) : m === method);
  function evolutionList(p, c) {
    if (!EVOLUTION_METHODS.includes(c.method)) throw new Error(`Método evolutivo desconocido: ${c.method}`);
    if (!EVOLUTION_ROLES.includes(c.role)) throw new Error(`role inválido: ${c.role}`);
    if (!p.evolution || !Array.isArray(p.evolution.methods) || !Array.isArray(p.evolution.evolvedBy)) throw new Error(`${p.key}: método evolutivo sin verificar`);
    return c.role === 'evolves' ? p.evolution.methods : p.evolution.evolvedBy;
  }
  /* Bomba indiscutible: no cumple, no tiene métodos raros ('other', objetos que no son piedras)
     que alguien pueda discutir, y tampoco cumple en el sentido contrario (Arcanine no puede ser
     bomba de "evolucionan con piedra": se obtiene con una). */
  function isCleanEvolutionNegative(p, c) {
    const own = evolutionList(p, c);
    const other = c.role === 'evolves' ? p.evolution.evolvedBy : p.evolution.methods;
    if (own.some(x => matchesMethod(x, c.method)) || other.some(x => matchesMethod(x, c.method))) return false;
    const odd = x => x === 'other' || (x.startsWith('item:') && !EVOLUTION_STONES.includes(x.slice(5)));
    return !own.some(odd);
  }

  function compareMeasure(p, c, field, limit, unit) {
    if (!['more', 'less'].includes(c.comparison)) throw new Error(`comparison inválido: ${c.comparison}`);
    if (typeof limit !== 'number' || !(limit > 0)) throw new Error(`Límite inválido: ${limit}`);
    const v = p[field];
    if (typeof v !== 'number') throw new Error(`${p.key}: ${field} sin verificar`);
    if (v === limit) throw new Error(`${p.key}: ${v} ${unit} es exactamente el límite`);
    return { value: c.comparison === 'more' ? v > limit : v < limit, detail: `${v} ${unit}` };
  }
  const decimal = x => String(x).replace('.', ',');

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
    color: {
      requires: ['color'],
      evaluate(p, c) {
        if (!p.color) throw new Error(`${p.key}: color de Pokédex sin verificar`);
        return { value: p.color === c.color, detail: `color Pokédex: ${p.color}` };
      },
    },
    /* Peso / altura oficiales de la Pokédex (de la forma de la carta). Un Pokémon que mide o pesa
       EXACTAMENTE el límite no puede aparecer (no es ni "más" ni "menos"). */
    weight: {
      requires: ['comparison', 'kg'],
      evaluate: (p, c) => compareMeasure(p, c, 'weightKg', c.kg, 'kg'),
    },
    height: {
      requires: ['comparison', 'm'],
      evaluate: (p, c) => compareMeasure(p, c, 'heightM', c.m, 'm'),
    },
    /* Método evolutivo. role 'evolves': cómo evoluciona el Pokémon DE LA CARTA;
       role 'obtained': cómo se obtuvo (cómo evolucionó su pre-evolución en él).
       method: 'stone' (cualquier piedra evolutiva) | 'trade' (con o sin objeto) | 'friendship' | 'level' (sólo nivel). */
    evolution: {
      requires: ['role', 'method'],
      evaluate(p, c) {
        const m = evolutionList(p, c);
        return { value: m.some(x => matchesMethod(x, c.method)), detail: m.length ? m.join(' + ') : c.role === 'evolves' ? 'no evoluciona' : 'no es una evolución' };
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
      case 'color': return {
        question: up(`Pokémon de color ${n('colors', c.color)} en la Pokédex`),
        rule: 'Color oficial de la especie en la Pokédex',
      };
      case 'weight': return {
        question: up(`Pokémon que pesan ${c.comparison === 'more' ? 'más' : 'menos'} de ${decimal(c.kg)} kg`),
        rule: 'Peso oficial de la Pokédex',
      };
      case 'height': return {
        question: up(`Pokémon que miden ${c.comparison === 'more' ? 'más' : 'menos'} de ${decimal(c.m)} m`),
        rule: 'Altura oficial de la Pokédex',
      };
      case 'evolution': {
        const how = {
          stone: ['con una piedra evolutiva', 'Cualquier piedra (Fuego, Agua, Trueno, Hoja, Lunar…)'],
          trade: ['por intercambio', 'Intercambio, con o sin objeto equipado'],
          friendship: ['por amistad', 'Subir de nivel con mucha amistad'],
          level: ['al subir de nivel', 'Sólo por nivel, sin otra condición'],
        }[c.method];
        if (!how) throw new Error(`Método evolutivo desconocido: ${c.method}`);
        if (c.role === 'evolves') return { question: up(`Pokémon que evolucionan ${how[0]}`), rule: `El Pokémon de la carta evoluciona · ${how[1]}` };
        if (c.role === 'obtained') return { question: up(`Pokémon que se obtienen al evolucionar ${how[0]}`), rule: `Así evolucionó su pre-evolución · ${how[1]}` };
        throw new Error(`role inválido: ${c.role}`);
      }
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

  return { TYPES, CONDITIONS, EVOLUTION_METHODS, EVOLUTION_ROLES, EVOLUTION_STONES, isCleanEvolutionNegative, typeMultiplier, evaluateCondition, describeCondition, solveRound, hashSeed, rng, shuffle };
});
