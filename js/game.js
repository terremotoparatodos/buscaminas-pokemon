/* ═══════════════════════════════════════════════════════════════
   BUSCAMINAS POKÉMON · LÓGICA DE PARTIDA (sin DOM)
   Estado serializable en JSON: se guarda en localStorage y se sincroniza entre pestañas.
   Las respuestas nunca se guardan: se piden al motor (BMEngine.solveRound).

   Dos modos de turno (config.turnMode):
   · 'click' (por defecto): los dos juegan el MISMO tablero y se alternan clic a clic.
       Acierto = +1 para quien hizo clic y pasa el turno. Bomba = termina la ronda.
       Quién empieza se alterna ronda a ronda.
   · 'round': cada jugador juega una ronda entera y se alternan por ronda.
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.BMGame = factory(root.BMEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  const DEFAULTS = {
    players: ['SKY', 'GUTI'], startingPlayer: 0, totalRounds: 20, turnMode: 'click', allowRetry: true,
    perfectBonus: 0, bombPenalty: 0, keepPointsOnBomb: true, difficultyCurve: true,
  };
  const DIFFS = ['easy', 'normal', 'hard'];
  const byClick = state => state.config.turnMode !== 'round';

  const roundById = (data, id) => {
    const r = data.rounds.find(x => x.id === id);
    if (!r) throw new Error(`Ronda desconocida: ${id}`);
    return r;
  };
  function solution(data, id) {
    const out = {};
    E.solveRound(roundById(data, id), data.facts).forEach(c => { out[c.key] = c.correct; });
    return out;
  }

  /* Orden de rondas: sin repetir, curva de dificultad, alternando familias y evitando
     repetir Pokémon entre rondas cercanas. En modo 'round' la curva va por PARES para que
     A y B jueguen la misma dificultad; en modo 'click' los dos juegan cada ronda. */
  function buildOrder(data, seed, cfg) {
    const rand = E.rng(`${seed}:order`);
    const pool = E.shuffle(data.rounds, rand);
    const n = Math.min(cfg.totalRounds, pool.length);
    const perRound = cfg.turnMode !== 'round';
    const steps = perRound ? n : Math.ceil(n / 2);
    const order = [];
    for (let i = 0; i < n; i++) {
      const step = perRound ? i : Math.floor(i / 2);
      const target = !cfg.difficultyCurve ? null : DIFFS[Math.min(2, Math.floor(3 * step / steps))];
      const recent = new Set(order.slice(-4).flatMap(id => roundById(data, id).pokemon));
      const prev = order.length ? roundById(data, order[order.length - 1]) : null;
      let best = null, bestScore = -Infinity;
      for (const r of pool) {
        if (order.includes(r.id)) continue;
        const overlap = r.pokemon.filter(k => recent.has(k)).length;
        const score = (target && r.difficulty === target ? 20 : 0) - 2 * overlap
          - (prev && prev.family === r.family ? 4 : 0) + rand();
        if (score > bestScore) { best = r; bestScore = score; }
      }
      order.push(best.id);
    }
    return order;
  }

  /* Baraja las 12 cartas. Evita que las 4 bombas queden todas en la misma fila o
     columna, o en casillas parecidas a las de la ronda anterior. */
  function dealCards(data, roundId, seed, index, attempt, prevBombSlots) {
    const round = roundById(data, roundId), sol = solution(data, roundId);
    const rand = E.rng(`${seed}:deal:${index}:${attempt}`);
    let cards, slots;
    for (let tries = 0; tries < 60; tries++) {
      cards = E.shuffle(round.pokemon, rand);
      slots = cards.map((k, i) => sol[k] ? -1 : i).filter(i => i >= 0);
      const rows = new Set(slots.map(i => i >> 2)), cols = new Set(slots.map(i => i % 4));
      const shared = prevBombSlots ? slots.filter(i => prevBombSlots.includes(i)).length : 0;
      if (rows.size > 1 && cols.size > 1 && shared < 2) break;
    }
    return { cards, bombSlots: slots };
  }

  /* Quién abre la ronda: en modo 'click' se alterna por ronda; en 'round' es el dueño. */
  const starterFor = (state, index) => (state.config.startingPlayer + index) % 2;

  function freshRound(state, data, attempt) {
    const id = state.order[state.index];
    const prevBombs = state.round && state.round.id !== id ? state.round.bombSlots : null;
    const { cards, bombSlots } = dealCards(data, id, state.seed, state.index, attempt, prevBombs);
    const starter = byClick(state) ? starterFor(state, state.index) : state.active;
    state.active = starter;
    return {
      id, cards, bombSlots, picked: [], by: {}, status: 'playing', bomb: null, bomber: null,
      starter, attempt, points: 0, pointsBy: [0, 0], scoresBefore: state.scores.slice(),
    };
  }

  function createMatch(data, opts) {
    const cfg = Object.assign({}, DEFAULTS, opts && opts.config);
    const seed = String(opts && opts.seed != null ? opts.seed : Math.floor(Math.random() * 1e9));
    const state = {
      version: 2, dataBuiltAt: data.builtAt, seed, config: cfg,
      order: buildOrder(data, seed, cfg), index: 0, scores: [0, 0],
      active: cfg.startingPlayer, history: [], finished: false, round: null,
    };
    state.round = freshRound(state, data, 0);
    return state;
  }

  const hits = (state, data) => {
    const sol = solution(data, state.round.id);
    return state.round.picked.filter(k => sol[k]).length;
  };

  function addPoints(state, player, n) {
    const r = state.round;
    state.scores[player] += n;
    r.pointsBy[player] += n;
    r.points += n;
  }

  function pick(state, data, key) {
    const r = state.round;
    if (state.finished || r.status !== 'playing' || !r.cards.includes(key) || r.picked.includes(key)) return { type: 'ignored' };
    const sol = solution(data, r.id);
    const player = state.active;
    r.picked.push(key);
    r.by[key] = player;
    if (sol[key]) {
      addPoints(state, player, 1);
      if (r.picked.filter(k => sol[k]).length === 8) {
        r.status = 'perfect';
        addPoints(state, player, state.config.perfectBonus);
        record(state);
        return { type: 'perfect', key, player };
      }
      if (byClick(state)) state.active = 1 - player;
      return { type: 'correct', key, player };
    }
    r.status = 'bomb';
    r.bomb = key;
    r.bomber = player;
    if (!state.config.keepPointsOnBomb) addPoints(state, player, -r.pointsBy[player]);
    if (state.config.bombPenalty) addPoints(state, player, -state.config.bombPenalty);
    record(state);
    return { type: 'bomb', key, player };
  }

  function record(state) {
    const r = state.round;
    state.history = state.history.filter(h => h.index !== state.index);
    state.history.push({
      index: state.index, roundId: r.id, player: byClick(state) ? r.bomber : state.active, starter: r.starter,
      points: r.points, pointsBy: r.pointsBy.slice(), result: r.status, bomber: r.bomber, scoresBefore: r.scoresBefore.slice(),
    });
  }

  /* Deshacer el último clic (correcciones durante una grabación): se vuelve a jugar la
     ronda desde cero sin ese clic, con el mismo reparto de cartas. */
  function undo(state, data) {
    const r = state.round;
    if (state.finished || !r.picked.length) return false;
    const picks = r.picked.slice(0, -1).map(k => [k, r.by[k]]);
    const undoneBy = r.by[r.picked[r.picked.length - 1]];
    state.scores = r.scoresBefore.slice();
    state.history = state.history.filter(h => h.index !== state.index);
    Object.assign(r, { picked: [], by: {}, status: 'playing', bomb: null, bomber: null, points: 0, pointsBy: [0, 0] });
    for (const [k, player] of picks) { state.active = player; pick(state, data, k); }
    state.active = undoneBy; // el turno vuelve a quien hizo el clic deshecho
    return true;
  }

  function retry(state, data) {
    const r = state.round;
    if (!state.config.allowRetry || r.status === 'playing' || state.finished) return false;
    state.scores = r.scoresBefore.slice();
    state.history = state.history.filter(h => h.index !== state.index);
    if (!byClick(state)) state.active = r.starter;
    state.round = freshRound(state, data, r.attempt + 1);
    return true;
  }

  /* Cambia por completo la ronda actual sin avanzar el contador. La elección queda
     guardada en el estado compartido, así que ambas PCs ven exactamente el mismo reroll. */
  function reroll(state, data) {
    if (state.finished) return false;
    const current = roundById(data, state.round.id);

    // Si había clics a medio jugar, quita sólo los puntos producidos por esos clics.
    // Una ronda ya cerrada conserva el marcador visible (útil al retomar una grabación).
    if (state.round.status === 'playing') {
      state.scores = state.scores.map((score, player) => score - state.round.pointsBy[player]);
    }
    state.history = state.history.filter(h => h.index !== state.index);

    state.rerolls = state.rerolls || {};
    const serial = (state.rerolls[state.index] || 0) + 1;
    state.rerolls[state.index] = serial;

    const occupied = new Set(state.order);
    const recent = new Set(state.order.slice(Math.max(0, state.index - 4), state.index)
      .flatMap(id => roundById(data, id).pokemon));
    const rand = E.rng(`${state.seed}:reroll:${state.index}:${serial}`);
    const candidates = data.rounds.filter(r => !occupied.has(r.id));
    if (!candidates.length) return false;

    let best = null, bestScore = -Infinity;
    for (const candidate of candidates) {
      const overlap = candidate.pokemon.filter(k => recent.has(k)).length;
      const score = (candidate.difficulty === current.difficulty ? 20 : 0)
        - 2 * overlap - (candidate.family === current.family ? 2 : 0) + rand();
      if (score > bestScore) { best = candidate; bestScore = score; }
    }

    state.order[state.index] = best.id;
    state.round = freshRound(state, data, 0);
    return true;
  }

  /* CONTINUAR. Con {force:true} (admin) salta aunque la ronda no haya terminado. */
  function next(state, data, opts) {
    if (state.finished) return false;
    if (state.round.status === 'playing' && !(opts && opts.force)) return false;
    if (state.index + 1 >= state.order.length) { state.finished = true; return true; }
    state.index += 1;
    if (!byClick(state)) state.active = 1 - state.round.starter;
    state.round = freshRound(state, data, 0);
    return true;
  }

  /* Ronda anterior (admin): deshace el resultado de esa ronda y la vuelve a repartir. */
  function prev(state, data) {
    if (state.index === 0 && !state.finished) return false;
    if (!state.finished) state.index -= 1;
    state.finished = false;
    const h = state.history.find(x => x.index === state.index);
    if (h) { state.scores = h.scoresBefore.slice(); state.active = h.starter; }
    else state.active = byClick(state) ? starterFor(state, state.index) : 1 - state.active;
    state.history = state.history.filter(x => x.index < state.index);
    state.round = freshRound(state, data, 0);
    return true;
  }

  /* Cambio manual del turno. En modo 'round' los puntos de la ronda en curso pasan al
     jugador corregido; en modo 'click' cada punto ya es de quien hizo el clic. */
  function setActive(state, player) {
    if (player !== 0 && player !== 1) return false;
    const r = state.round;
    if (!byClick(state) && player !== state.active && r.points) {
      state.scores[state.active] -= r.points;
      state.scores[player] += r.points;
      r.pointsBy = player === 0 ? [r.points, 0] : [0, r.points];
      const h = state.history.find(x => x.index === state.index);
      if (h) { h.player = player; h.pointsBy = r.pointsBy.slice(); }
    }
    if (!byClick(state)) r.starter = player;
    state.active = player;
    return true;
  }
  function adjustScore(state, player, delta) { state.scores[player] += delta; return true; }
  function resetScores(state) {
    state.scores = [0, 0];
    Object.assign(state.round, { scoresBefore: [0, 0], points: 0, pointsBy: [0, 0] });
    state.history = [];
    return true;
  }

  function winner(state) {
    if (state.scores[0] === state.scores[1]) return -1;
    return state.scores[0] > state.scores[1] ? 0 : 1;
  }

  return { DEFAULTS, buildOrder, dealCards, createMatch, solution, hits, pick, undo, retry, reroll, next, prev, setActive, adjustScore, resetScores, winner, roundById };
});
