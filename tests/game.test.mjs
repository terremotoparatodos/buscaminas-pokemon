/* Lógica de partida con el banco REAL (data/game-data.js): seed, turnos (por clic y
   por ronda), puntaje, bomba, tablero limpio, deshacer, reintento, reveal final. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const G = require('../js/game.js');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL('../data/game-data.js', import.meta.url), 'utf8'), sandbox);
// JSON ida y vuelta: objetos del mismo "realm" que los tests (deepStrictEqual compara prototipos).
const DATA = JSON.parse(JSON.stringify(sandbox.window.BUSCAMINAS_DATA));

const match = (seed = 'test', config = {}) => G.createMatch(DATA, { seed, config });
const roundMatch = (seed = 'test', config = {}) => match(seed, { turnMode: 'round', ...config });
const split = s => {
  const sol = G.solution(DATA, s.round.id);
  return { ok: s.round.cards.filter(k => sol[k]), bad: s.round.cards.filter(k => !sol[k]) };
};
const diff = id => G.roundById(DATA, id).difficulty;

test('el banco del juego tiene rondas de 12 con 8 correctos y 4 bombas', () => {
  assert.ok(DATA.rounds.length >= 30);
  for (const r of DATA.rounds) {
    assert.equal(r.pokemon.length, 12, r.id);
    assert.equal(new Set(r.pokemon).size, 12, r.id);
    const sol = Object.values(G.solution(DATA, r.id));
    assert.equal(sol.filter(Boolean).length, 8, r.id);
    assert.equal(sol.filter(x => !x).length, 4, r.id);
    assert.equal(r.verified, true, r.id);
  }
});

test('seed reproducible: misma seed → mismo orden y mismas cartas', () => {
  const a = match('12345'), b = match('12345'), c = match('99999');
  assert.deepEqual(a.order, b.order);
  assert.deepEqual(a.round.cards, b.round.cards);
  assert.notDeepEqual(a.order, c.order);
});

test('no se repiten rondas y hay totalRounds', () => {
  const s = match('x', { totalRounds: 20 });
  assert.equal(s.order.length, 20);
  assert.equal(new Set(s.order).size, 20);
});

test('modo clic: curva fácil → normal → difícil a lo largo de la partida', () => {
  const s = match('curva');
  assert.equal(diff(s.order[0]), 'easy');
  assert.equal(diff(s.order[s.order.length - 1]), 'hard');
});

test('modo ronda: curva por pares (A y B juegan la misma dificultad)', () => {
  const s = roundMatch('curva');
  for (let i = 0; i + 1 < s.order.length; i += 2) assert.equal(diff(s.order[i]), diff(s.order[i + 1]), `par ${i}`);
  assert.equal(diff(s.order[0]), 'easy');
  assert.equal(diff(s.order[s.order.length - 1]), 'hard');
});

test('barajado: las 12 cartas son las de la ronda, y las bombas no quedan en una sola fila/columna', () => {
  for (let i = 0; i < 40; i++) {
    const s = match(`b${i}`);
    assert.deepEqual([...s.round.cards].sort(), [...G.roundById(DATA, s.round.id).pokemon].sort());
    const rows = new Set(s.round.bombSlots.map(x => x >> 2)), cols = new Set(s.round.bombSlots.map(x => x % 4));
    assert.ok(rows.size > 1 && cols.size > 1);
  }
});

test('las bombas no están siempre en las mismas posiciones', () => {
  const seen = new Set();
  for (let i = 0; i < 30; i++) seen.add(match(`pos${i}`).round.bombSlots.join());
  assert.ok(seen.size > 20);
});

/* ─── MODO CLIC (por defecto): un clic cada uno sobre el mismo tablero ─── */
test('clic: acierto +1 para quien hizo clic y el turno pasa al otro', () => {
  const s = match();
  const { ok } = split(s);
  assert.equal(s.config.turnMode, 'click');
  assert.equal(s.active, 0);
  assert.equal(G.pick(s, DATA, ok[0]).type, 'correct');
  assert.deepEqual(s.scores, [1, 0]);
  assert.equal(s.active, 1);
  G.pick(s, DATA, ok[1]);
  assert.deepEqual(s.scores, [1, 1]);
  assert.equal(s.active, 0);
  assert.equal(s.round.by[ok[0]], 0);
  assert.equal(s.round.by[ok[1]], 1);
  assert.equal(G.pick(s, DATA, ok[0]).type, 'ignored', 'no se puede elegir dos veces');
  assert.equal(s.active, 0, 'un clic ignorado no cambia el turno');
  assert.equal(G.hits(s, DATA), 2);
});

test('clic: bomba termina la ronda, registra quién la tocó y cada uno conserva lo suyo', () => {
  const s = match();
  const { ok, bad } = split(s);
  G.pick(s, DATA, ok[0]); G.pick(s, DATA, ok[1]); G.pick(s, DATA, ok[2]); // SKY, GUTI, SKY
  assert.equal(G.pick(s, DATA, bad[0]).type, 'bomb');                     // GUTI
  assert.equal(s.round.status, 'bomb');
  assert.equal(s.round.bomber, 1);
  assert.deepEqual(s.scores, [2, 1]);
  assert.deepEqual(s.round.pointsBy, [2, 1]);
  assert.equal(G.pick(s, DATA, ok[3]).type, 'ignored', 'la ronda ya terminó');
  assert.equal(s.history[0].bomber, 1);
  assert.deepEqual(s.history[0].pointsBy, [2, 1]);
});

test('clic: penalización por bomba y keepPointsOnBomb afectan sólo a quien la tocó', () => {
  const s = match('t', { bombPenalty: 2 });
  const a = split(s);
  G.pick(s, DATA, a.ok[0]); G.pick(s, DATA, a.bad[0]); // SKY acierta, GUTI pisa la bomba
  assert.deepEqual(s.scores, [1, -2]);
  const k = match('t', { keepPointsOnBomb: false });
  const c = split(k);
  G.pick(k, DATA, c.ok[0]); G.pick(k, DATA, c.ok[1]); G.pick(k, DATA, c.bad[0]); // SKY pisa la bomba
  assert.deepEqual(k.scores, [0, 1]);
});

test('clic: tablero limpio (8 de 8) y bonus para quien encuentra el último', () => {
  const s = match();
  const types = split(s).ok.map(k => G.pick(s, DATA, k).type);
  assert.deepEqual(types, [...Array(7).fill('correct'), 'perfect']);
  assert.equal(s.round.status, 'perfect');
  assert.deepEqual(s.scores, [4, 4]);
  const b = match('t', { perfectBonus: 3 });
  split(b).ok.forEach(k => G.pick(b, DATA, k));
  assert.deepEqual(b.scores, [4, 7]);
});

test('clic: quién abre la ronda se alterna ronda a ronda', () => {
  const s = match('turnos');
  const starters = [];
  for (let i = 0; i < 6; i++) {
    starters.push(s.active);
    G.pick(s, DATA, split(s).ok[0]);
    G.pick(s, DATA, split(s).bad[0]);
    G.next(s, DATA);
  }
  assert.deepEqual(starters, [0, 1, 0, 1, 0, 1]);
  assert.equal(match('t', { startingPlayer: 1 }).active, 1);
});

test('clic: deshacer el último clic devuelve punto y turno (también tras una bomba)', () => {
  const s = match();
  const { ok, bad } = split(s);
  assert.equal(G.undo(s, DATA), false, 'nada para deshacer');
  G.pick(s, DATA, ok[0]); G.pick(s, DATA, ok[1]);
  G.undo(s, DATA);
  assert.deepEqual(s.scores, [1, 0]);
  assert.equal(s.active, 1);
  assert.deepEqual(s.round.picked, [ok[0]]);
  G.pick(s, DATA, bad[0]); // GUTI toca bomba
  assert.equal(s.round.status, 'bomb');
  G.undo(s, DATA);
  assert.equal(s.round.status, 'playing');
  assert.equal(s.active, 1);
  assert.equal(s.history.length, 0);
  assert.deepEqual(s.scores, [1, 0]);
});

test('clic: cambio manual de turno no mueve puntos ya ganados', () => {
  const s = match();
  G.pick(s, DATA, split(s).ok[0]); // SKY +1, turno GUTI
  G.setActive(s, 0);
  assert.equal(s.active, 0);
  assert.deepEqual(s.scores, [1, 0]);
  G.pick(s, DATA, split(s).ok[1]);
  assert.deepEqual(s.scores, [2, 0]);
  assert.equal(G.setActive(s, 5), false);
});

test('reveal final: al terminar se conoce la clasificación de las 12 cartas', () => {
  const s = match();
  const { ok, bad } = split(s);
  G.pick(s, DATA, bad[0]);
  const sol = G.solution(DATA, s.round.id);
  assert.equal(s.round.cards.filter(k => sol[k]).length, 8);
  assert.equal(s.round.cards.filter(k => !sol[k]).length, 4);
  assert.ok(ok.every(k => sol[k]) && bad.every(k => !sol[k]));
});

test('reintentar: sólo con la ronda terminada; restaura puntaje, turno inicial y re-baraja', () => {
  const s = match();
  const { ok, bad } = split(s);
  assert.equal(G.retry(s, DATA), false, 'no se puede reintentar mientras se juega');
  G.pick(s, DATA, ok[0]); G.pick(s, DATA, bad[0]);
  const before = s.round.cards.join();
  assert.equal(G.retry(s, DATA), true);
  assert.deepEqual(s.scores, [0, 0]);
  assert.equal(s.active, 0);
  assert.equal(s.round.status, 'playing');
  assert.equal(s.round.attempt, 1);
  assert.equal(s.history.length, 0);
  assert.notEqual(s.round.cards.join(), before);
  const c = match('t', { allowRetry: false });
  G.pick(c, DATA, split(c).bad[0]);
  assert.equal(G.retry(c, DATA), false, 'desactivable por configuración');
});

test('reroll: cambia la ronda y conserva número, marcador y orden sin duplicados', () => {
  const s = match('reroll');
  for (let i = 0; i < 3; i++) G.next(s, DATA, { force: true });
  G.adjustScore(s, 0, 12); G.adjustScore(s, 1, 12);
  const oldId = s.round.id;
  assert.equal(G.reroll(s, DATA), true);
  assert.equal(s.index, 3, 'sigue siendo la ronda 4');
  assert.deepEqual(s.scores, [12, 12]);
  assert.notEqual(s.round.id, oldId);
  assert.equal(s.round.status, 'playing');
  assert.deepEqual(s.round.picked, []);
  assert.equal(new Set(s.order).size, s.order.length);
  assert.equal(diff(s.round.id), diff(oldId), 'mantiene la dificultad prevista');
});

test('reroll: quita sólo los puntos parciales de la ronda en curso', () => {
  const s = match('reroll-parcial');
  G.adjustScore(s, 0, 12); G.adjustScore(s, 1, 12);
  const { ok } = split(s);
  G.pick(s, DATA, ok[0]); G.pick(s, DATA, ok[1]);
  assert.deepEqual(s.scores, [13, 13]);
  assert.equal(G.reroll(s, DATA), true);
  assert.deepEqual(s.scores, [12, 12]);
  assert.deepEqual(s.round.scoresBefore, [12, 12]);
});

test('reroll: ofrece muchas opciones seguidas sin volver a una ya descartada', () => {
  const s = match('muchos-rerolls');
  const seen = new Set([s.round.id]);
  for (let i = 0; i < 12; i++) {
    assert.equal(G.reroll(s, DATA), true);
    assert.equal(seen.has(s.round.id), false, `la opción ${i + 1} no debe repetirse`);
    seen.add(s.round.id);
  }
  assert.equal(seen.size, 13);
  assert.equal(s.index, 0);
});

test('reroll: prioriza el banco nuevo de alternativas para el video', () => {
  const s = match('prioridad-alternativas');
  assert.equal(G.reroll(s, DATA), true);
  assert.match(s.round.id, /-alt-\d+$/);
});

test('continuar sólo con la ronda terminada (salvo admin) y fin de partida', () => {
  const s = match('fin', { totalRounds: 2 });
  assert.equal(G.next(s, DATA), false);
  assert.equal(G.next(s, DATA, { force: true }), true);
  assert.equal(s.index, 1);
  assert.equal(s.active, 1, 'la segunda ronda la abre GUTI');
  G.pick(s, DATA, split(s).ok[0]);
  G.pick(s, DATA, split(s).bad[0]);
  assert.equal(G.next(s, DATA), true);
  assert.equal(s.finished, true);
  assert.equal(G.winner(s), 1);
});

test('admin: ronda anterior deshace el resultado; ajuste y reset de puntaje', () => {
  const s = match();
  G.pick(s, DATA, split(s).ok[0]);
  G.pick(s, DATA, split(s).bad[0]);
  G.next(s, DATA);
  assert.equal(s.active, 1);
  G.prev(s, DATA);
  assert.equal(s.index, 0);
  assert.equal(s.active, 0);
  assert.deepEqual(s.scores, [0, 0]);
  G.adjustScore(s, 1, 5);
  assert.deepEqual(s.scores, [0, 5]);
  G.resetScores(s);
  assert.deepEqual(s.scores, [0, 0]);
});

/* ─── MODO RONDA (turnMode: 'round'): una ronda entera cada uno ─── */
test('ronda: acierto +1 al jugador activo y el turno NO cambia', () => {
  const s = roundMatch();
  const { ok } = split(s);
  G.pick(s, DATA, ok[0]); G.pick(s, DATA, ok[1]);
  assert.deepEqual(s.scores, [2, 0]);
  assert.equal(s.active, 0);
});

test('ronda: bomba conserva aciertos; keepPointsOnBomb=false los descuenta; perfecta = 8', () => {
  const s = roundMatch();
  const { ok, bad } = split(s);
  G.pick(s, DATA, ok[0]); G.pick(s, DATA, ok[1]); G.pick(s, DATA, bad[0]);
  assert.deepEqual(s.scores, [2, 0]);
  const k = roundMatch('t', { keepPointsOnBomb: false });
  G.pick(k, DATA, split(k).ok[0]); G.pick(k, DATA, split(k).bad[0]);
  assert.deepEqual(k.scores, [0, 0]);
  const p = roundMatch();
  split(p).ok.forEach(x => G.pick(p, DATA, x));
  assert.deepEqual(p.scores, [8, 0]);
});

test('ronda: turnos alternados A, B, A, B…', () => {
  const s = roundMatch('turnos');
  const seq = [];
  for (let i = 0; i < 6; i++) {
    seq.push(s.active);
    G.pick(s, DATA, split(s).bad[0]);
    G.next(s, DATA);
  }
  assert.deepEqual(seq, [0, 1, 0, 1, 0, 1]);
});

test('ronda: cambio manual de jugador mueve los puntos de la ronda en curso', () => {
  const s = roundMatch();
  const { ok } = split(s);
  G.pick(s, DATA, ok[0]); G.pick(s, DATA, ok[1]);
  G.setActive(s, 1);
  assert.deepEqual(s.scores, [0, 2]);
  G.pick(s, DATA, ok[2]);
  assert.deepEqual(s.scores, [0, 3]);
});

test('el estado es JSON puro (se puede guardar y sincronizar entre pestañas)', () => {
  const s = match();
  G.pick(s, DATA, split(s).ok[0]);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});
