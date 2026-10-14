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
  const evo = pokeapiEvolutions(A);
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
      types: p.types.slice(), color: species[p.species] && species[p.species].color,
      abilities: {
        normal: p.abilities.filter(a => !a.hidden).map(a => a.name),
        hidden: p.abilities.filter(a => a.hidden).map(a => a.name),
        special: [],
      },
      gen9: { available: p.versionGroups.some(v => vgs.has(v)), moves },
      // Otros juegos Gen 9 (Z-A, Champions…): sólo para descartar impostores discutibles.
      otherGen9Moves: Object.fromEntries(Object.entries(p.otherGen9Moves || {}).map(([m, e]) => [m, [...new Set(e.map(x => x.split(':')[0]))]])),
      prevoSpecies: prevoChain(species, p.species),
      weightKg: p.weightHg / 10, heightM: p.heightDm / 10,
      evolution: { methods: [...(evo.methods[p.name] || [])].sort(), evolvedBy: [...(evo.evolvedBy[p.name] || [])].sort() },
    };
  }
  return { name: 'A', label: A.source, typeChart, pokemon, species };
}

/* Método evolutivo según PokéAPI. Cada evolution_detail dice a qué forma se aplica
   (required_pokemon_form / evolved_pokemon_form; si falta, la forma por defecto de la especie).
   Se juntan TODOS los juegos: si un método cambió entre juegos, las fuentes no coincidirán
   y el Pokémon queda fuera de esas rondas. */
const BASE_DETAIL = ['version_group', 'is_default', 'trigger', 'required_pokemon_form', 'evolved_pokemon_form', 'region'];
function pokeapiMethod(d) {
  const extra = Object.keys(d).filter(k => !BASE_DETAIL.includes(k));
  if (d.trigger === 'use-item' && d.item && extra.every(k => k === 'item')) return `item:${d.item}`;
  if (d.trigger === 'trade') return extra.every(k => k === 'held_item') ? 'trade' : 'other';
  if (d.trigger === 'level-up' && d.min_happiness && extra.every(k => ['min_happiness', 'time_of_day'].includes(k))) return 'friendship';
  if (d.trigger === 'level-up' && d.min_level && extra.every(k => k === 'min_level')) return 'level';
  return 'other';
}
function pokeapiEvolutions(A) {
  const methods = {}, evolvedBy = {};
  const add = (map, key, m) => (map[key] ||= new Set()).add(m);
  const walk = n => {
    for (const child of n.evolvesTo) {
      for (const d of child.evolutionDetails || []) {
        const m = pokeapiMethod(d);
        add(methods, d.required_pokemon_form || n.species, m);
        add(evolvedBy, d.evolved_pokemon_form || child.species, m);
      }
      walk(child);
    }
  };
  A.chains.forEach(c => walk(c.chain));
  return { methods, evolvedBy };
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
      key, showdownId, types: e.types.map(t => t.toLowerCase()), color: e.color && e.color.toLowerCase(),
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
      weightKg: e.weightkg, heightM: e.heightm,
      evolution: {
        methods: [...new Set((e.evos || []).map(n => showdownMethod(B.pokedex[norm(n)])))].sort(),
        evolvedBy: e.prevo ? [showdownMethod(e)] : [],
      },
    };
  }
  return { name: 'B', label: B.source, typeChart, pokemon, idToKey };
}

/* Método evolutivo según Showdown: cada entrada dice cómo se llega a ella desde su prevo. */
function showdownMethod(e) {
  if (!e) return 'other';
  if (e.evoType === 'useItem' && e.evoItem && !e.evoCondition) return `item:${e.evoItem.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  if (e.evoType === 'trade') return e.evoCondition ? 'other' : 'trade';
  if (e.evoType === 'levelFriendship') return /^(during the day|at night)$/.test(e.evoCondition || 'during the day') ? 'friendship' : 'other';
  if (!e.evoType && e.evoLevel && !e.evoCondition) return 'level';
  return 'other';
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
