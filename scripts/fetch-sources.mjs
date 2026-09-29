/* Descarga y cachea las DOS fuentes de datos. Sólo se usa para construir el dataset:
   el juego nunca consulta estas URLs durante una partida.

   FUENTE A · PokéAPI (REST v2, https://pokeapi.co)
   FUENTE B · Pokémon Showdown (repo smogon/pokemon-showdown, fijado a un commit)

   Uso:  node scripts/fetch-sources.mjs [--showdown-sha <sha>]
   Resultado en .cache/ (no se versiona). Reintentar es seguro: todo queda cacheado. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { COLORS, MOVES, TYPES } from './catalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache');
const A_DIR = path.join(CACHE, 'pokeapi');
const B_DIR = path.join(CACHE, 'showdown');
const API = 'https://pokeapi.co/api/v2/';
const GEN9_VGS = new Set(['scarlet-violet', 'the-teal-mask', 'the-indigo-disk']);
/* Otros juegos de Gen 9 que PokéAPI registra: se guardan SÓLO para descartar impostores
   discutibles ("en Z-A sí lo aprende"), nunca para dar un positivo. */
const OTHER_GEN9_VGS = new Set(['legends-za', 'mega-dimension', 'champions']);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const idFromUrl = url => +url.replace(/\/$/, '').split('/').pop();
const langs = (list, key = 'name') => Object.fromEntries(
  (list || []).filter(n => ['es', 'en'].includes(n.language.name)).map(n => [n.language.name, n[key]]));

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'buscaminas-pokemon-dataset/1.0' } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 5) throw new Error(`${url}: ${err.message}`);
      await sleep(500 * attempt);
    }
  }
}

/* Cache por recurso: guarda sólo los campos que usamos (el JSON crudo de /pokemon pesa mucho). */
async function cached(kind, name, url, strip) {
  const file = path.join(A_DIR, 'raw', kind, `${name}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const raw = await getJson(url);
  const data = raw === null ? { missing: true, name } : strip(raw);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
  return data;
}

async function pool(items, worker, size = 10, label = '') {
  const out = new Array(items.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) {
      const k = next++;
      out[k] = await worker(items[k], k);
      if (++done % 200 === 0) console.log(`  ${label} ${done}/${items.length}`);
    }
  }));
  return out;
}

const stripSpecies = s => ({
  id: s.id, name: s.name, names: langs(s.names), generation: s.generation.name,
  isLegendary: s.is_legendary, isMythical: s.is_mythical, isBaby: s.is_baby,
  evolvesFrom: s.evolves_from_species?.name || null,
  evolutionChain: s.evolution_chain ? idFromUrl(s.evolution_chain.url) : null,
  varieties: s.varieties.map(v => ({ name: v.pokemon.name, isDefault: v.is_default })),
});

const stripColor = c => ({
  id: c.id, name: c.name, names: langs(c.names),
  species: c.pokemon_species.map(s => s.name),
});

const stripPokemon = p => {
  const moves = {}, otherGen9Moves = {};
  const versionGroups = new Set();
  for (const m of p.moves) {
    for (const d of m.version_group_details) {
      const vg = d.version_group.name;
      versionGroups.add(vg);
      const entry = `${vg}:${d.move_learn_method.name}:${d.level_learned_at}`;
      if (GEN9_VGS.has(vg)) (moves[m.move.name] ||= []).push(entry);
      else if (OTHER_GEN9_VGS.has(vg)) (otherGen9Moves[m.move.name] ||= []).push(entry);
    }
  }
  return {
    id: p.id, name: p.name, isDefault: p.is_default, species: p.species.name,
    types: p.types.sort((a, b) => a.slot - b.slot).map(t => t.type.name),
    abilities: p.abilities.sort((a, b) => a.slot - b.slot)
      .map(a => ({ name: a.ability.name, hidden: a.is_hidden, slot: a.slot })),
    pastTypes: p.past_types || [], pastAbilities: p.past_abilities || [],
    sprite: p.sprites?.front_default || null,
    forms: p.forms.map(f => f.name),
    versionGroups: [...versionGroups].sort(),
    gen9Moves: moves,
    otherGen9Moves,
  };
};

const stripForm = f => ({
  name: f.name, formName: f.form_name, pokemon: f.pokemon.name, isDefault: f.is_default,
  isBattleOnly: f.is_battle_only, isMega: f.is_mega,
  names: langs(f.names), formNames: langs(f.form_names),
});

const stripType = t => ({
  name: t.name, names: langs(t.names),
  damageRelations: Object.fromEntries(Object.entries(t.damage_relations).map(([k, v]) => [k, v.map(x => x.name)])),
});

const stripAbility = a => ({
  name: a.name, names: langs(a.names), generation: a.generation.name, isMainSeries: a.is_main_series,
  pokemon: a.pokemon.map(x => ({ name: x.pokemon.name, hidden: x.is_hidden })),
});

const stripMove = m => ({
  name: m.name, names: langs(m.names), type: m.type.name, generation: m.generation.name,
  learnedBy: m.learned_by_pokemon.map(x => x.name),
});

const stripChain = c => {
  const walk = n => ({ species: n.species.name, evolvesTo: n.evolves_to.map(walk) });
  return { id: c.id, chain: walk(c.chain) };
};

async function fetchPokeApi() {
  console.log('FUENTE A · PokéAPI');
  const list = await getJson(`${API}pokemon-species?limit=5000`);
  const speciesIds = list.results.map(r => idFromUrl(r.url));
  const species = await pool(speciesIds, id => cached('species', id, `${API}pokemon-species/${id}/`, stripSpecies), 10, 'species');
  const colors = await pool(COLORS, n => cached('color', n, `${API}pokemon-color/${n}/`, stripColor), 5, 'colors');
  const colorBySpecies = Object.fromEntries(colors.flatMap(c => c.species.map(s => [s, c.name])));
  species.forEach(s => { s.color = colorBySpecies[s.name] || null; });
  const varietyNames = [...new Set(species.flatMap(s => s.varieties.map(v => v.name)))];
  const pokemon = await pool(varietyNames, n => cached('pokemon', n, `${API}pokemon/${n}/`, stripPokemon), 8, 'pokemon');
  const formNames = [...new Set(pokemon.filter(p => !p.missing).flatMap(p => p.forms))];
  const forms = await pool(formNames, n => cached('form', n, `${API}pokemon-form/${n}/`, stripForm), 10, 'forms');
  const chainIds = [...new Set(species.map(s => s.evolutionChain).filter(Boolean))];
  const chains = await pool(chainIds, id => cached('chain', id, `${API}evolution-chain/${id}/`, stripChain), 10, 'chains');
  const types = await pool(TYPES, n => cached('type', n, `${API}type/${n}/`, stripType), 6, 'types');
  const abilityList = await getJson(`${API}ability?limit=5000`);
  const abilities = await pool(abilityList.results.map(r => r.name), n => cached('ability', n, `${API}ability/${n}/`, stripAbility), 10, 'abilities');
  const moves = await pool(MOVES, n => cached('move', n, `${API}move/${n}/`, stripMove), 6, 'moves');

  const bundle = {
    source: 'PokéAPI v2 REST (https://pokeapi.co/api/v2/)',
    fetchedAt: new Date().toISOString(),
    species, colors, pokemon, forms, chains, types, abilities, moves,
  };
  fs.writeFileSync(path.join(A_DIR, 'bundle.json'), JSON.stringify(bundle));
  console.log(`  ok: ${species.length} especies, ${pokemon.length} pokémon, ${forms.length} formas, ${abilities.length} habilidades, ${moves.length} movimientos`);
}

/* Los .ts de Showdown son literales de objeto con una línea `export const X: Tipo = {`.
   Se transforman a CommonJS y se evalúan en un contexto aislado (sin acceso a nada). */
function evalShowdownTs(source) {
  const js = source.replace(/^export const \w+\s*:\s*[^=]+=\s*/m, 'module.exports = ');
  const sandbox = { module: { exports: null } };
  vm.runInNewContext(js, sandbox, { timeout: 20000 });
  return sandbox.module.exports;
}

async function fetchShowdown(shaArg) {
  console.log('FUENTE B · Pokémon Showdown');
  let sha = shaArg;
  if (!sha) {
    try { sha = execSync('gh api repos/smogon/pokemon-showdown/commits/master --jq .sha').toString().trim(); }
    catch { sha = (await getJson('https://api.github.com/repos/smogon/pokemon-showdown/commits/master')).sha; }
  }
  const files = { pokedex: 'pokedex.ts', learnsets: 'learnsets.ts', typechart: 'typechart.ts', formatsData: 'formats-data.ts' };
  const bundle = { source: `smogon/pokemon-showdown@${sha} (data/*.ts)`, commit: sha, fetchedAt: new Date().toISOString() };
  for (const [key, file] of Object.entries(files)) {
    const url = `https://raw.githubusercontent.com/smogon/pokemon-showdown/${sha}/data/${file}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    bundle[key] = evalShowdownTs(await res.text());
    console.log(`  ${file}: ${Object.keys(bundle[key]).length} entradas`);
  }
  /* Otros juegos de Gen 9 (Legends: Z-A y Champions): sólo para DESCARTAR impostores. */
  bundle.otherGen9Learnsets = {};
  for (const mod of ['gen9legends', 'champions']) {
    const url = `https://raw.githubusercontent.com/smogon/pokemon-showdown/${sha}/data/mods/${mod}/learnsets.ts`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    bundle.otherGen9Learnsets[mod] = evalShowdownTs(await res.text());
    console.log(`  mods/${mod}/learnsets.ts: ${Object.keys(bundle.otherGen9Learnsets[mod]).length} entradas`);
  }
  fs.writeFileSync(path.join(B_DIR, 'bundle.json'), JSON.stringify(bundle));
  console.log(`  ok: commit ${sha}`);
}

const shaIdx = process.argv.indexOf('--showdown-sha');
fs.mkdirSync(A_DIR, { recursive: true });
fs.mkdirSync(B_DIR, { recursive: true });
await fetchShowdown(shaIdx > -1 ? process.argv[shaIdx + 1] : null);
await fetchPokeApi();
