/* Cruce de las dos fuentes: qué Pokémon son elegibles, qué hechos coinciden y
   qué discrepancias hay. Lo usan tanto el generador como el validador. */
import { TYPES, MOVES, REGIONS } from '../catalog.mjs';
import {
  buildSourceA, buildSourceB, makeShowdownMapper, showdownOtherFormes,
  REGIONAL_RE, TAUROS_RE, TRANSFORM_RE,
} from './sources.mjs';

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9 };
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
const sameAbilities = (x, y) => sameSet(x.normal, y.normal) && sameSet(x.hidden, y.hidden) && sameSet(x.special || [], y.special || []);

/* ─── Identidad: qué Pokémon pueden aparecer en una carta ───
   Sólo formas por defecto y formas regionales con nombre exacto. Se excluye la especie
   entera si tiene otras formas (no mega/gmax/totem/primigenia/regional) con tipos
   distintos (Rotom, Oricorio, Castform, Ogerpon, Necrozma…), o si su forma por
   defecto ya es una forma con nombre propio (Toxtricity-Amped, Meowstic-Male…). */
export function buildIdentities(A, B) {
  const mapper = makeShowdownMapper(B);
  const pokemon = Object.fromEntries(A.pokemon.filter(p => !p.missing).map(p => [p.name, p]));
  const forms = Object.fromEntries(A.forms.filter(f => !f.missing).map(f => [f.name, f]));
  const chains = Object.fromEntries(A.chains.map(c => [c.id, c.chain]));
  const excluded = [];
  const identities = [];

  const finalStage = {};
  const walk = n => { finalStage[n.species] = n.evolvesTo.length === 0; n.evolvesTo.forEach(walk); };
  Object.values(chains).forEach(walk);

  for (const s of A.species) {
    const def = s.varieties.find(v => v.isDefault);
    const D = def && pokemon[def.name];
    if (!D) { excluded.push({ species: s.name, reason: 'sin variedad por defecto' }); continue; }
    if (D.name !== s.name) { excluded.push({ species: s.name, reason: `forma por defecto con nombre propio (${D.name})` }); continue; }
    if (!s.names.es) { excluded.push({ species: s.name, reason: 'sin nombre en español' }); continue; }

    const regionals = [], others = [];
    for (const v of s.varieties) {
      if (v.isDefault) continue;
      const p = pokemon[v.name];
      if (!p) { others.push({ name: v.name, missing: true }); continue; }
      const r = v.name.match(REGIONAL_RE);
      if ((r && r[1] === s.name) || TAUROS_RE.test(v.name)) regionals.push(p);
      else if (!TRANSFORM_RE.test(v.name)) others.push(p);
    }
    const baseSd = mapper({ key: D.name, isDefault: true, species: s.name }, s.id);
    const sdOthers = baseSd ? showdownOtherFormes(B, baseSd) : [];
    const typeDiff = others.filter(o => o.missing || !sameSet(o.types, D.types)).map(o => o.name)
      .concat(sdOthers.filter(f => !sameSet(f.types.map(t => t.toLowerCase()), (B.pokedex[baseSd].types || []).map(t => t.toLowerCase()))).map(f => `showdown:${f.name}`));
    if (typeDiff.length) { excluded.push({ species: s.name, reason: `formas con otros tipos: ${typeDiff.join(', ')}` }); continue; }
    /* Formas que sólo cambian habilidades (gorras de Pikachu, Meowstic-F…): la especie
       sigue siendo usable, pero NO en rondas de habilidad. */
    const abilityDiff = others.some(o => {
      const a = o.abilities.map(x => x.name).sort().join(), d = D.abilities.map(x => x.name).sort().join();
      return a !== d;
    }) || sdOthers.some(f => JSON.stringify(f.abilities) !== JSON.stringify(B.pokedex[baseSd].abilities));

    const gen = ROMAN[s.generation.replace('generation-', '')] || 0;
    for (const p of [D, ...regionals]) {
      if (!p.sprite) { excluded.push({ pokemon: p.name, reason: 'sin sprite' }); continue; }
      const region = p === D ? null : (p.name.match(REGIONAL_RE) || [])[2] || 'paldea';
      const formDisplay = region ? formLabel(forms, p) : null;
      if (region && !formDisplay) { excluded.push({ pokemon: p.name, reason: 'forma sin nombre en español' }); continue; }
      identities.push({
        key: p.name, id: p.id, species: s.name, dex: s.id, form: region ? p.name.slice(s.name.length + 1) : 'default',
        region, nameEs: s.names.es, formEs: formDisplay, generation: gen,
        isLegendary: s.isLegendary || s.isMythical, isBaby: s.isBaby, finalStage: !!finalStage[s.name],
        evolutionChain: s.evolutionChain, abilityAmbiguous: p === D ? abilityDiff : false,
        isDefault: p.isDefault, showdownId: mapper({ key: p.name, isDefault: p.isDefault, species: s.name }, s.id),
      });
    }
  }
  return { identities, excluded };
}

/* "Forma de Alola" (PokéAPI, es) → "de Alola". Para Tauros de Paldea se agrega la raza. */
function formLabel(forms, p) {
  const f = forms[p.forms[0]];
  const es = f && f.formNames && f.formNames.es;
  if (!es) return null;
  return es.replace(/^Forma\s+/i, '');
}

/* ─── Consenso ─── */
export function buildConsensus(bundles, ruleset) {
  const { A: rawA, B: rawB } = bundles;
  const { identities, excluded } = buildIdentities(rawA, rawB);
  const SA = buildSourceA(rawA, ruleset);
  const SB = buildSourceB(rawB, ruleset, identities, rawA.abilities.map(a => a.name));
  const discrepancies = [];

  const chartDiff = [];
  for (const d of TYPES) for (const a of TYPES) {
    if (SA.typeChart[d][a] !== SB.typeChart[d][a]) chartDiff.push(`${a}→${d}: A=${SA.typeChart[d][a]} B=${SB.typeChart[d][a]}`);
  }
  if (chartDiff.length) throw new Error(`Las tablas de tipos no coinciden:\n${chartDiff.join('\n')}`);

  const pokemon = {};
  for (const id of identities) {
    const a = SA.pokemon[id.key], b = SB.pokemon[id.key];
    if (!a || !b) {
      excluded.push({ pokemon: id.key, reason: !a ? 'no está en PokéAPI' : `sin entrada equivalente en Showdown (${id.showdownId || 'sin mapeo'})` });
      continue;
    }
    if (!sameSet(a.types, b.types)) {
      discrepancies.push({ pokemon: id.key, field: 'types', sourceA: a.types, sourceB: b.types });
      excluded.push({ pokemon: id.key, reason: 'tipos distintos entre fuentes' });
      continue;
    }
    const facts = { ...id, types: a.types.slice() };

    // Habilidades
    if (b.abilities.special.length) facts.abilitiesExcluded = `habilidad especial en Showdown: ${b.abilities.special}`;
    else if (id.abilityAmbiguous) facts.abilitiesExcluded = 'otra forma de la especie tiene otras habilidades';
    else if (!sameAbilities(a.abilities, b.abilities)) {
      discrepancies.push({ pokemon: id.key, field: 'abilities', sourceA: a.abilities, sourceB: b.abilities });
      facts.abilitiesExcluded = 'habilidades distintas entre fuentes';
    }
    facts.abilities = facts.abilitiesExcluded ? null : { normal: a.abilities.normal.slice(), hidden: a.abilities.hidden.slice() };

    // Learnset Gen 9
    if (a.gen9.available !== b.gen9.available) {
      discrepancies.push({ pokemon: id.key, field: 'gen9.available', sourceA: a.gen9.available, sourceB: b.gen9.available, note: b.gen9.nonstandard });
      facts.learnsets = { gen9: null };
    } else if (!a.gen9.available) {
      facts.learnsets = { gen9: { available: false, moves: {}, disputed: [] } };
    } else {
      const moves = {}, disputed = [];
      for (const m of MOVES) {
        const inA = !!a.gen9.moves[m], inB = !!b.gen9.moves[m];
        if (inA !== inB) {
          disputed.push(m);
          discrepancies.push({ pokemon: id.key, field: `gen9.move:${m}`, sourceA: a.gen9.moves[m] || null, sourceB: b.gen9.moves[m] || null });
        } else if (inA) moves[m] = a.gen9.moves[m].slice();
      }
      facts.learnsets = { gen9: { available: true, moves, disputed } };
    }
    facts.prevoSpecies = [...new Set([...a.prevoSpecies, ...b.prevoSpecies])];
    pokemon[id.key] = facts;
  }
  // Pre-evoluciones en claves concretas (todas las variedades elegibles de cada especie previa).
  const bySpecies = {};
  for (const p of Object.values(pokemon)) (bySpecies[p.species] ||= []).push(p.key);
  const speciesNorm = Object.fromEntries(rawA.species.map(s => [s.name.replace(/[^a-z0-9]/g, ''), s.name]));
  for (const p of Object.values(pokemon)) {
    p.prevoKeys = [];
    p.prevoUnknown = [];
    for (const sp of p.prevoSpecies) {
      const name = rawA.species.find(s => s.name === sp) ? sp : speciesNorm[sp];
      const keys = name && bySpecies[name];
      if (keys && keys.length) p.prevoKeys.push(...keys); else p.prevoUnknown.push(sp);
    }
    delete p.prevoSpecies;
  }
  return { SA, SB, pokemon, typeChart: SA.typeChart, excluded, discrepancies, identities };
}

/* Un negativo de movimiento es "limpio" si ni el Pokémon ni NINGUNA de sus
   pre-evoluciones lo aprende según ninguna de las dos fuentes, ni tampoco en otro
   juego de Gen 9 (Legends: Z-A, Champions…). Así nadie puede discutir
   "lo aprendía de chiquito" o "en Z-A sí lo aprende". */
export function isCleanMoveNegative(consensus, key, move) {
  const p = consensus.pokemon[key];
  if (!p || !p.learnsets.gen9 || !p.learnsets.gen9.available) return false;
  if (p.learnsets.gen9.disputed.includes(move) || p.learnsets.gen9.moves[move]) return false;
  if (p.prevoUnknown.length) return false;
  const selfA = consensus.SA.pokemon[key], selfB = consensus.SB.pokemon[key];
  if (!selfA || !selfB || selfA.otherGen9Moves[move] || selfB.otherGen9Moves[move]) return false; // p. ej. Legends: Z-A
  for (const k of p.prevoKeys) {
    const a = consensus.SA.pokemon[k], b = consensus.SB.pokemon[k];
    if (!a || !b) return false;
    if (a.gen9.moves[move] || b.gen9.moves[move] || a.otherGen9Moves[move] || b.otherGen9Moves[move]) return false;
  }
  return true;
}

export function spanishNames(rawA) {
  const pick = list => Object.fromEntries(list.filter(x => !x.missing && x.names && x.names.es).map(x => [x.name, x.names.es]));
  return { abilities: pick(rawA.abilities), moves: pick(rawA.moves), types: pick(rawA.types) };
}

export const displayName = p => p.formEs ? `${p.nameEs} ${p.formEs}` : p.nameEs;
export { REGIONS };
