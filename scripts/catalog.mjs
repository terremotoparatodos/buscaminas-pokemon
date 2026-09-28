/* Candidatos de condiciones para generar rondas.
   Esto NO es un dato Pokémon: es sólo la lista de preguntas que intentamos armar.
   Si una condición no alcanza 8 positivos + 4 impostores confirmados por las dos
   fuentes, el generador la descarta y lo registra. */

/* Ruleset de movimientos. "gen9" = Pokémon Escarlata/Púrpura + DLC.
   PokéAPI: version groups exactos. Showdown: códigos de learnset que empiezan con "9". */
export const RULESETS = {
  gen9: {
    id: 'gen9',
    label: 'Gen 9 · Escarlata/Púrpura + DLC',
    pokeapiVersionGroups: ['scarlet-violet', 'the-teal-mask', 'the-indigo-disk'],
    showdownGeneration: 9,
    // L nivel · M MT · E huevo · T tutor · R restringido (p. ej. cambio de forma) · S evento
    showdownMethods: ['L', 'M', 'E', 'T', 'R', 'S'],
  },
};

export const ABILITIES = [
  'water-absorb', 'volt-absorb', 'flash-fire', 'levitate', 'intimidate', 'swift-swim',
  'chlorophyll', 'sturdy', 'thick-fat', 'blaze', 'torrent', 'overgrow', 'static',
  'lightning-rod', 'storm-drain', 'sand-veil', 'snow-cloak', 'keen-eye', 'inner-focus',
  'synchronize', 'sheer-force', 'technician', 'regenerator', 'prankster', 'rock-head',
  'guts', 'own-tempo', 'cursed-body', 'natural-cure', 'serene-grace', 'dry-skin',
  'moxie', 'justified', 'magic-guard', 'unaware', 'iron-fist', 'clear-body', 'swarm',
  'shed-skin', 'poison-point', 'sand-rush', 'pressure', 'cute-charm', 'run-away',
];

export const MOVES = [
  'thunder-punch', 'fire-punch', 'ice-punch', 'thunder-fang', 'fire-fang', 'ice-fang',
  'surf', 'fly', 'dig', 'volt-switch', 'flamethrower', 'ice-beam', 'thunderbolt',
  'shadow-ball', 'psychic', 'dragon-claw', 'draining-kiss', 'aqua-tail', 'poison-jab',
  'x-scissor', 'rock-slide', 'drain-punch', 'body-press', 'trick-room', 'will-o-wisp',
  'swords-dance', 'dragon-dance', 'leech-life', 'bullet-seed', 'spikes', 'stealth-rock',
  'play-rough', 'bug-buzz', 'hurricane', 'hydro-pump', 'outrage', 'zen-headbutt',
  'earthquake', 'waterfall', 'close-combat', 'iron-head', 'aura-sphere', 'dazzling-gleam',
  'energy-ball', 'sludge-bomb', 'crunch', 'u-turn', 'rapid-spin',
];

/* Familias de movimientos "hermanos": sirven sólo para elegir impostores creíbles
   (p. ej. aprende Puño Fuego pero no Puño Trueno). No deciden ninguna respuesta. */
export const MOVE_SIBLINGS = [
  ['thunder-punch', 'fire-punch', 'ice-punch', 'drain-punch'],
  ['thunder-fang', 'fire-fang', 'ice-fang', 'crunch'],
  ['flamethrower', 'ice-beam', 'thunderbolt'],
  ['surf', 'waterfall', 'hydro-pump', 'aqua-tail'],
  ['swords-dance', 'dragon-dance'],
  ['spikes', 'stealth-rock'],
  ['shadow-ball', 'psychic', 'energy-ball', 'sludge-bomb', 'aura-sphere', 'dazzling-gleam'],
  ['u-turn', 'volt-switch'],
];

export const TYPES = ['normal', 'fire', 'water', 'grass', 'electric', 'ice', 'fighting', 'poison',
  'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'];

export const REGIONS = ['alola', 'galar', 'hisui', 'paldea'];
