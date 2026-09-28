/* Adaptadores: convierten cada fuente cruda al MISMO esquema de hechos, de forma
   independiente. Ninguno lee datos del otro salvo la tabla de claves (qué entrada de
   Showdown corresponde a cada Pokémon de PokéAPI), que sólo identifica, no decide.

   Esquema común por Pokémon (clave canónica = nombre de /pokemon en PokéAPI):
   { key, types:[...], abilities:{normal:[], hidden:[], special:[]},
     gen9:{ available:bool, moves:{ 'thunder-punch':[métodos] } }, prevoSpecies:[...] } */
import fs from 'node:fs';
import path from 'node:path';
import { TYPES, MOVES } from '../catalog.mjs';

export const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

export function loadBundles(root) {
  const read = p => JSON.parse(fs.readFileSync(path.join(root, '.cache', p), 'utf8'));
  return { A: read('pokeapi/bundle.json'), B: read('showdown/bundle.json') };
}

export const REGIONAL_RE = /^(.+)-(alola|galar|hisui|paldea)$/;
export const TAUROS_RE = /^tauros-paldea-(combat|blaze|aqua)-breed$/;
export const TRANSFORM_RE = /-(mega|gmax|totem|primal)(-|$)/;

/* ─────────────── FUENTE A · PokéAPI ─────────────── */
export function buildSourceA(A, ruleset) {
  const vgs = new Set(ruleset.pokeapiVersionGroups);
  const types = Object.fromEntries(A.types.map(t => [t.name, t]));
  const typeChart = {};
  for (const def of TYPES) {
    const r = types[def].damageRelations;
    typeChart[def] = {};
    for (const atk of TYPES) {
      typeChart[def][atk] = r.no_damage_from.includes(atk) ? 0
        : r.double_damage_from.includes(atk) ? 2 : r.half_damage_from.includes(atk) ? 0.5 : 1;
    }
  }
  const species = Object.fromEntries(A.species.map(s => [s.name, s]));
  const pokemon = {};
  for (const p of A.pokemon) {
    if (p.missing) continue;
    const moves = {};
    for (const [move, entries] of Object.entries(p.gen9Moves)) {
      const methods = [...new Set(entries.filter(e => vgs.has(e.split(':')[0])).map(e => e.split(':')[1]))].sort();
      if (methods.length) moves[move] = methods;
    }
    pokemon[p.name] = {
      key: p.name, id: p.id, species: p.species, isDefault: p.isDefault, sprite: p.sprite,
      types: p.types.slice(),
      abilities: {
        normal: p.abilities.filter(a => !a.hidden).map(a => a.name),
        hidden: p.abilities.filter(a => a.hidden).map(a => a.name),
        special: [],
      },
      gen9: { available: p.versionGroups.some(v => vgs.has(v)), moves },
      // Otros juegos Gen 9 (Z-A, Champions…): sólo para descartar impostores discutibles.
      otherGen9Moves: Object.fromEntries(Object.entries(p.otherGen9Moves || {}).map(([m, e]) => [m, [...new Set(e.map(x => x.split(':')[0]))]])),
      prevoSpecies: prevoChain(species, p.species),
    };
  }
  return { name: 'A', label: A.source, typeChart, pokemon, species };
}

function prevoChain(species, name) {
  const out = [];
  for (let s = species[name]; s && s.evolvesFrom; s = species[s.evolvesFrom]) out.push(s.evolvesFrom);
  return out;
}

/* ─────────────── FUENTE B · Pokémon Showdown ─────────────── */

/* Qué entrada de Showdown representa cada Pokémon de PokéAPI. Sólo tres casos;
   todo lo demás queda SIN mapear y, por lo tanto, excluido. */
export function makeShowdownMapper(B) {
  const byNum = {};
  for (const [id, e] of Object.entries(B.pokedex)) {
    if (e.num > 0 && !e.baseSpecies && !e.forme) (byNum[e.num] ||= []).push(id);
  }
  return function showdownIdFor(p, speciesNum) {
    if (p.isDefault) {
      const ids = byNum[speciesNum] || [];
      return ids.length === 1 ? ids[0] : null;
    }
    const r = p.key.match(REGIONAL_RE);
    if (r && r[1] === p.species) {
      const id = norm(p.species) + r[2], e = B.pokedex[id];
      return e && e.num === speciesNum && e.forme === cap(r[2]) ? id : null;
    }
    const t = p.key.match(TAUROS_RE);
    if (t) {
      const id = 'taurospaldea' + t[1], e = B.pokedex[id];
      return e && e.num === 128 && e.forme === `Paldea-${cap(t[1])}` ? id : null;
    }
    return null;
  };
}

export function buildSourceB(B, ruleset, identities, pokeapiAbilitySlugs) {
  const gen = String(ruleset.showdownGeneration);
  const methods = new Set(ruleset.showdownMethods);
  const abilitySlug = Object.fromEntries(pokeapiAbilitySlugs.map(s => [norm(s), s]));
  const toAbility = name => abilitySlug[norm(name)] || `showdown:${norm(name)}`;

  const typeChart = {};
  for (const def of TYPES) {
    const taken = B.typechart[def].damageTaken;
    typeChart[def] = {};
    for (const atk of TYPES) {
      const code = taken[cap(atk)];
      typeChart[def][atk] = code === 0 ? 1 : code === 1 ? 2 : code === 2 ? 0.5 : code === 3 ? 0 : NaN;
    }
  }

  const pokemon = {};
  const idToKey = {};
  for (const { key, showdownId } of identities) if (showdownId) idToKey[showdownId] = key;
  for (const { key, showdownId } of identities) {
    const e = showdownId && B.pokedex[showdownId];
    if (!e) continue;
    const ls = B.learnsets[showdownId] && B.learnsets[showdownId].learnset;
    const moves = {};
    let anyGen = false;
    if (ls) {
      for (const [move, codes] of Object.entries(ls)) if (codes.some(c => c.startsWith(gen))) { anyGen = true; break; }
      for (const slug of MOVES) {
        const codes = (ls[norm(slug)] || []).filter(c => c.startsWith(gen) && methods.has(c.charAt(gen.length)));
        if (codes.length) moves[slug] = codes;
      }
    }
    const nonstandard = B.formatsData[showdownId] && B.formatsData[showdownId].isNonstandard;
    const ab = e.abilities || {};
    pokemon[key] = {
      key, showdownId, types: e.types.map(t => t.toLowerCase()),
      abilities: {
        normal: ['0', '1'].filter(k => ab[k]).map(k => toAbility(ab[k])),
        hidden: ab.H ? [toAbility(ab.H)] : [],
        special: ab.S ? [toAbility(ab.S)] : [],
      },
      gen9: { available: anyGen && nonstandard !== 'Past', moves, nonstandard: nonstandard || null },
      // Legends: Z-A / Champions (mods de Showdown): sólo para descartar impostores discutibles.
      otherGen9Moves: otherGen9(B, showdownId),
      prevoSpecies: showdownPrevos(B.pokedex, e),
      prevoIds: showdownPrevoIds(B.pokedex, e),
    };
  }
  return { name: 'B', label: B.source, typeChart, pokemon, idToKey };
}

function otherGen9(B, id) {
  const out = {};
  for (const [mod, table] of Object.entries(B.otherGen9Learnsets || {})) {
    const ls = table[id] && table[id].learnset;
    if (!ls) continue;
    for (const slug of MOVES) if ((ls[norm(slug)] || []).some(c => c.startsWith('9'))) (out[slug] ||= []).push(mod);
  }
  return out;
}

function showdownPrevoIds(dex, e) {
  const out = [];
  for (let cur = e; cur && cur.prevo; cur = dex[norm(cur.prevo)]) out.push(norm(cur.prevo));
  return out;
}
function showdownPrevos(dex, e) {
  return showdownPrevoIds(dex, e).map(id => norm(dex[id] ? (dex[id].baseSpecies || dex[id].name) : id));
}

/* Formas "de verdad distintas" de una especie según Showdown (sin megas/gmax/regionales). */
export function showdownOtherFormes(B, baseId) {
  const base = B.pokedex[baseId];
  if (!base) return [];
  return (base.otherFormes || []).map(n => B.pokedex[norm(n)]).filter(Boolean)
    .filter(f => !/(^|-)(Mega|Gmax|Totem|Primal)(-|$)/.test(f.forme || '')
      && !/^(Alola|Galar|Hisui|Paldea)(-(Combat|Blaze|Aqua))?$/.test(f.forme || ''));
}
