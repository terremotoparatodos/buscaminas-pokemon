/* ═══════════════════════════════════════════════════════════════
   BUSCAMINAS POKÉMON · APP (DOM)
   Compartida por index.html (vertical) y horizontal.html. Cada layout sólo cambia CSS.
   Las animaciones salen de comparar el estado nuevo con el último dibujado, así
   funcionan igual si la jugada viene de esta pestaña o del panel en otra pestaña.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const DATA = window.BUSCAMINAS_DATA;
  if (!DATA) {
    document.body.innerHTML = '<p style="color:#fff;font:20px system-ui;padding:40px">Falta data/game-data.js. Corré <code>npm run build</code>.</p>';
    return;
  }
  const G = window.BMGame, E = window.BMEngine, A = window.BMAudio;
  const CFG = Object.assign({}, G.DEFAULTS, window.BUSCAMINAS_CONFIG || {});
  const params = new URLSearchParams(location.search);
  const ROOM = (() => {
    const requested = (params.get('room') || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 80);
    if (requested) return requested;
    let saved = '';
    try { saved = localStorage.getItem('buscaminas-default-room') || ''; } catch (_) {}
    if (!saved) {
      const token = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2) + Date.now().toString(36);
      saved = `sala-${token.slice(0, 20)}`;
      try { localStorage.setItem('buscaminas-default-room', saved); } catch (_) {}
    }
    const url = new URL(location.href); url.searchParams.set('room', saved); history.replaceState(null, '', url);
    return saved;
  })();
  const KEY = `buscaminas-state-v2:${ROOM}`;
  const CLIENT_ID = (() => {
    try {
      let id = sessionStorage.getItem('buscaminas-client-id');
      if (!id) { id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; sessionStorage.setItem('buscaminas-client-id', id); }
      return id;
    } catch (_) { return `${Date.now()}-${Math.random()}`; }
  })();
  const DIFF_TEXT = { easy: 'FÁCIL', normal: 'NORMAL', hard: 'DIFÍCIL' };
  const up = s => String(s).toLocaleUpperCase('es');
  const $ = s => document.querySelector(s);
  const el = {
    grid: $('.grid'), status: $('.status'), stamp: $('.stamp'), progress: $('.progress'),
    qText: $('.q-text'), qRule: $('.q-rule'), roundNo: $('.round-no'), chip: $('.head .chip'),
    players: [...document.querySelectorAll('.player')],
  };

  if (params.get('debug') === '1') document.body.classList.add('debug');
  if (params.get('nopanel') === '1') document.body.classList.add('nopanel');
  if (params.get('clean') === '1') document.body.classList.add('clean');
  if (location.hash === '#panel') document.body.classList.add('panel-only');

  /* ─────────── ESTADO + SINCRONIZACIÓN ENTRE PESTAÑAS (como PokeDuelo) ─────────── */
  const flags = c => ({ allowRetry: c.allowRetry, perfectBonus: c.perfectBonus, bombPenalty: c.bombPenalty, keepPointsOnBomb: c.keepPointsOnBomb, players: c.players });
  function validState(s) {
    try {
      return s && s.version === 2 && s.round && s.order[s.index] === s.round.id
        && s.config.turnMode === CFG.turnMode
        && s.order.every(id => DATA.rounds.some(r => r.id === id));
    } catch (_) { return false; }
  }
  const newMatch = seed => {
    const selected = String(seed || '');
    const batch = DATA.rounds.some(r => r.batch === selected) ? selected : null;
    return G.createMatch(DATA, { seed: selected, batch, config: CFG });
  };
  let S = null;
  try { S = JSON.parse(localStorage.getItem(KEY)); } catch (_) {}
  const urlSeed = params.get('seed');
  if (!validState(S) || (urlSeed && S.seed !== urlSeed)) S = newMatch(urlSeed || ROOM);
  S.dataBuiltAt = DATA.builtAt; // migra partidas guardadas cuando sólo se amplía el banco
  S.config = Object.assign({}, S.config, flags(CFG));
  if (!S.sync) S.sync = { rev: 0, by: '' };

  let bc = null;
  let remotePublish = () => {};
  try { bc = new BroadcastChannel(`buscaminas:${ROOM}`); bc.onmessage = e => receive(e.data); } catch (_) {}
  addEventListener('storage', e => { if (e.key === KEY && e.newValue) { try { receive(JSON.parse(e.newValue)); } catch (_) {} } });
  const stamp = s => [s && s.sync ? s.sync.rev || 0 : 0, s && s.sync ? s.sync.by || '' : ''];
  const newer = (a, b) => {
    const [ar, ab] = stamp(a), [br, bb] = stamp(b);
    return ar > br || (ar === br && ab > bb);
  };
  function commit() {
    S.sync = { rev: (S.sync && S.sync.rev || 0) + 1, by: CLIENT_ID };
    S.v = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (_) {}
    try { bc && bc.postMessage(S); } catch (_) {}
    remotePublish(S);
    render();
  }
  function receive(ns) {
    if (validState(ns) && newer(ns, S)) {
      S = ns;
      try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (_) {}
      render();
    }
  }

  /* ─────────── SPRITES: todos los de la partida, precargados al abrir ─────────── */
  const spriteOf = key => DATA.facts.pokemon[key].sprite;
  /* Se guardan las referencias: así las imágenes quedan decodificadas en memoria y
     un cambio de ronda no vuelve a pedir nada. */
  const preloaded = new Map();
  function preload() {
    S.order.forEach(id => G.roundById(DATA, id).pokemon.forEach(k => {
      if (preloaded.has(k)) return;
      const img = new Image(); img.decoding = 'async'; img.src = spriteOf(k);
      if (img.decode) img.decode().catch(() => {});
      preloaded.set(k, img);
    }));
  }

  /* ─────────── ÍCONOS ─────────── */
  const ICON_OK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON_BOMB = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="10" r="5.2" fill="currentColor"/><rect x="8.6" y="3.2" width="3" height="3" rx=".6" transform="rotate(45 10.1 4.7)" fill="currentColor"/><path d="M11.5 3.2q1.2-2 3-1.6" fill="none" stroke="#ffb020" stroke-width="1.6" stroke-linecap="round"/><circle cx="5.2" cy="8.3" r="1.2" fill="#fff" opacity=".55"/></svg>';

  /* ─────────── RENDER ─────────── */
  const view = { key: null, picked: [], status: null, scores: [null, null], finished: false, first: true, statusHtml: '' };
  let cardEls = [];

  function restart(node, cls) {
    node.classList.remove('a-pop', 'a-shake', 'a-rev', 'a-deal');
    void node.offsetWidth; // reinicia la animación CSS
    node.classList.add(cls);
  }

  /* Achica el texto hasta que entre en maxLines líneas y en su ancho
     (una medición al repartir la ronda, nunca por frame). */
  function fitText(node, min, maxLines) {
    node.style.fontSize = '';
    const cs = getComputedStyle(node);
    let size = parseFloat(cs.fontSize);
    const lh = (parseFloat(cs.lineHeight) || size * 1.1) / size;
    const tooBig = () => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > size * lh * (maxLines + 0.5);
    while (tooBig() && size > min) { size -= 1; node.style.fontSize = size + 'px'; }
  }
  const LAYOUT = document.body.dataset.layout;
  const CLICK = CFG.turnMode !== 'round';
  function restartTurn(p) {
    const t = p.querySelector('.turn');
    t.classList.remove('flip'); void t.offsetWidth; t.classList.add('flip');
  }

  function buildGrid(def, animate) {
    const details = {};
    E.solveRound(def, DATA.facts).forEach(c => { details[c.key] = c; });
    el.grid.innerHTML = S.round.cards.map((k, i) => {
      const p = DATA.facts.pokemon[k], name = up(p.name), d = details[k];
      const extra = d.multiplier !== undefined ? `×${String(d.multiplier).replace('.', ',')}` : d.detail === 'habilidad oculta' ? 'OCULTA' : '';
      return `<button class="card" data-key="${k}" style="--d:${i * 35}ms" aria-label="${p.name}">
        <span class="tint"></span>
        <span class="art"><img src="${spriteOf(k)}" alt="" width="96" height="96" decoding="async"></span>
        <span class="name${name.length > 11 ? ' long' : ''}">${name}</span>
        <span class="badge b-ok">${ICON_OK}<em style="font-style:normal">CORRECTO</em></span>
        <span class="badge b-bomb">${ICON_BOMB}<em style="font-style:normal">BOMBA</em></span>
        ${extra ? `<span class="detail">${extra}</span>` : ''}
      </button>`;
    }).join('');
    cardEls = [...el.grid.children];
    cardEls.forEach(c => {
      const name = c.querySelector('.name');
      fitText(name, 12, 2);
      if (animate) restart(c, 'a-deal');
    });
    el.grid.classList.remove('celebrate');
  }

  function updateGrid(solution, prevPicked, justEnded, animate) {
    const r = S.round, ended = r.status !== 'playing';
    el.grid.classList.toggle('done', ended);
    if (!ended) el.grid.classList.remove('celebrate');
    if (justEnded && r.status === 'perfect') el.grid.classList.add('celebrate');
    let n = 0;
    cardEls.forEach(c => {
      const k = c.dataset.key, picked = r.picked.includes(k), correct = solution[k], show = picked || ended;
      c.classList.toggle('ok', show && correct);
      c.classList.toggle('bad', show && !correct);
      c.classList.toggle('picked', picked);
      c.classList.toggle('rev', ended && !picked);
      c.classList.toggle('boom', r.bomb === k);
      c.querySelector('.b-bomb em').textContent = r.bomb === k ? (CLICK ? `¡${S.config.players[r.bomber]}!` : '¡BOMBA!') : 'BOMBA';
      // Modo por clic: la carta acertada muestra quién la encontró.
      c.querySelector('.b-ok em').textContent = picked && CLICK ? S.config.players[r.by[k]] : 'CORRECTO';
      c.classList.toggle('by-0', picked && CLICK && r.by[k] === 0);
      c.classList.toggle('by-1', picked && CLICK && r.by[k] === 1);
      c.disabled = picked || ended || S.finished;
      if (animate && picked && !prevPicked.includes(k)) restart(c, correct ? 'a-pop' : 'a-shake');
      if (justEnded && !picked) { c.style.setProperty('--d', `${(r.status === 'bomb' ? 420 : 200) + n++ * 70}ms`); restart(c, 'a-rev'); }
    });
  }

  function renderPlayers(animate) {
    el.players.forEach((p, i) => {
      const on = S.active === i && !S.finished && S.round.status === 'playing';
      if (animate && on && !p.classList.contains('active')) restartTurn(p);
      p.classList.toggle('active', on);
      p.querySelector('.pname').textContent = S.config.players[i];
      const score = p.querySelector('.pscore');
      score.textContent = S.scores[i];
      if (animate && view.scores[i] !== null && view.scores[i] !== S.scores[i]) { score.classList.remove('bump'); void score.offsetWidth; score.classList.add('bump'); }
      p.querySelector('.phist').innerHTML = S.history.filter(h => CLICK || h.player === i).slice(-12)
        .map(h => `<i class="${h.bomber === i ? 'bomb' : h.result === 'perfect' ? 'perfect' : ''}" title="Ronda ${h.index + 1}">${h.pointsBy ? h.pointsBy[i] : h.points}</i>`).join('');
    });
  }

  function renderHead(def) {
    el.roundNo.textContent = `RONDA ${S.index + 1} / ${S.order.length}`;
    el.chip.textContent = DIFF_TEXT[def.difficulty];
    el.chip.className = `chip ${def.difficulty}`;
    const results = Object.fromEntries(S.history.map(h => [h.index, h.result]));
    el.progress.innerHTML = S.order.map((_, i) => {
      const res = results[i];
      const cls = res === 'perfect' ? 'perfect' : res === 'bomb' ? 'bomb' : i === S.index && !S.finished ? 'current' : '';
      return `<i class="${cls}"></i>`;
    }).join('');
  }

  function renderQuestion(def, fresh) {
    if (!fresh && el.qText.textContent === def.question) return;
    el.qText.textContent = def.question;
    el.qRule.textContent = def.rule;
    fitText(el.qText, 18, LAYOUT === 'vertical' ? 2 : 1);
  }

  function renderStatus(solution, animate) {
    const r = S.round;
    const last = S.index + 1 >= S.order.length;
    let html;
    if (S.finished) {
      html = `<div class="result perfect outline">PARTIDA TERMINADA</div><div class="actions"><button class="btn go" data-act="new">NUEVA PARTIDA</button></div>`;
    } else if (r.status === 'playing') {
      const hits = r.picked.filter(k => solution[k]).length;
      const turn = CLICK ? `<div class="turnlbl outline">TURNO: <b>${S.config.players[S.active]}</b></div>` : '';
      html = `${turn}<div class="hits outline">ACIERTOS: <b>${hits}</b> / 8</div><div class="pips">${Array.from({ length: 8 }, (_, i) => `<i class="${i < hits ? 'on' : ''}"></i>`).join('')}</div>`;
    } else {
      const hits = r.picked.filter(k => solution[k]).length;
      const P = S.config.players, split = `<small>${P[0]} +${r.pointsBy[0]} · ${P[1]} +${r.pointsBy[1]}</small>`;
      const txt = CLICK
        ? (r.status === 'perfect' ? `¡TABLERO LIMPIO!${split}` : `¡BOMBA DE ${P[r.bomber]}!${split}`)
        : (r.status === 'perfect' ? `¡RONDA PERFECTA! +${r.points}` : `¡BOMBA! ${hits}/8 · +${r.points}`);
      html = `<div class="result ${r.status} outline">${txt}</div><div class="actions">
        ${S.config.allowRetry ? '<button class="btn retry" data-act="retry">REINTENTAR RONDA</button>' : ''}
        <button class="btn go" data-act="next">${last ? 'VER RESULTADO' : 'CONTINUAR'}</button></div>`;
    }
    if (html === view.statusHtml) return;
    const kindChanged = (view.status === 'playing') !== (r.status === 'playing') || view.finished !== S.finished;
    view.statusHtml = html;
    el.status.innerHTML = html;
    if (animate && kindChanged) [...el.status.children].forEach((c, i) => { c.classList.add('enter'); c.style.animationDelay = `${250 + i * 120}ms`; });
  }

  function showStamp(kind, html, animate) {
    el.stamp.className = 'stamp';
    el.stamp.innerHTML = html;
    void el.stamp.offsetWidth;
    if (kind === 'final') el.stamp.classList.add('final', animate ? 'stay' : 'stay');
    else el.stamp.classList.add(kind, 'show', ...(kind === 'perfect' ? ['big'] : []));
    if (!animate && kind === 'final') el.stamp.classList.add('noanim');
  }

  function render() {
    const r = S.round, def = G.roundById(DATA, r.id), solution = G.solution(DATA, r.id);
    const key = `${S.index}|${r.attempt}|${r.id}`;
    const fresh = key !== view.key, animate = !view.first;
    const prevPicked = fresh ? r.picked : view.picked;
    const justEnded = animate && !fresh && view.status === 'playing' && r.status !== 'playing';

    renderPlayers(animate);
    renderHead(def);
    renderQuestion(def, fresh);
    if (fresh) buildGrid(def, animate);
    updateGrid(solution, prevPicked, justEnded, animate);
    renderStatus(solution, animate);

    const player = S.config.players[S.active];
    const P = S.config.players;
    if (justEnded && r.status === 'perfect') {
      showStamp('perfect', CLICK ? `¡TABLERO LIMPIO!<small>${P[0]} +${r.pointsBy[0]} · ${P[1]} +${r.pointsBy[1]}</small>` : `¡RONDA PERFECTA!<small>+${r.points} PARA ${player}</small>`, true);
      A.play('perfect');
    } else if (justEnded && r.status === 'bomb') {
      showStamp('bomb', `¡BOMBA!<small>${CLICK ? `LA PISÓ ${P[r.bomber]}` : 'SE TERMINA LA RONDA'}</small>`, true);
      A.play('bomb');
    }
    else if (animate && !fresh && r.picked.length > view.picked.length && r.status === 'playing') A.play('correct');
    if (S.finished && (!view.finished || view.first)) {
      const w = G.winner(S);
      showStamp('final', `${w < 0 ? '¡EMPATE!' : `¡GANA ${S.config.players[w]}!`}<small>${S.config.players[0]} ${S.scores[0]} · ${S.config.players[1]} ${S.scores[1]}</small>`, animate);
    } else if (!S.finished && (fresh || view.finished)) el.stamp.className = 'stamp';
    if (fresh && animate && !S.finished) A.play('nextRound');

    Object.assign(view, { key, picked: r.picked.slice(), status: r.status, scores: S.scores.slice(), finished: S.finished, first: false });
    renderPanel(def, solution);
  }

  /* ─────────── ACCIONES ─────────── */
  const act = {
    pick: k => { if (G.pick(S, DATA, k).type !== 'ignored') commit(); },
    next: () => { if (G.next(S, DATA)) commit(); },
    retry: () => { if (G.retry(S, DATA)) commit(); },
    reroll: () => { if (G.reroll(S, DATA)) { view.key = null; preload(); commit(); } },
    skip: () => { if (G.next(S, DATA, { force: true })) commit(); },
    prev: () => { if (G.prev(S, DATA)) commit(); },
    swap: () => { G.setActive(S, 1 - S.active); commit(); },
    undo: () => { if (G.undo(S, DATA)) commit(); },
    setActive: i => { G.setActive(S, i); commit(); },
    adjust: (i, d) => { G.adjustScore(S, i, d); commit(); },
    resetScores: () => { if (confirm('¿Poner los dos marcadores en 0?')) { G.resetScores(S); commit(); } },
    newMatch: seed => {
      if (!confirm('¿Empezar una partida nueva? Se pierde la actual.')) return;
      const v = S.v, sync = S.sync; S = newMatch(seed || ROOM); S.v = v; S.sync = sync; view.key = null; view.first = true; preload(); commit();
    },
  };

  el.grid.addEventListener('click', e => {
    const c = e.target.closest('.card');
    if (c) { c.blur(); act.pick(c.dataset.key); }
  });
  el.status.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    b.blur();
    if (b.dataset.act === 'next') act.next();
    else if (b.dataset.act === 'retry') act.retry();
    else if (b.dataset.act === 'new') act.newMatch();
  });

  /* ─────────── PANEL DE CONTROL (no se graba) ─────────── */
  const panel = $('#panel');
  panel.innerHTML = `
    <header><h2>⚙ Panel · Buscaminas Pokémon</h2>
      <div class="line"><button id="b-sound" title="Silenciar (M)">🔊</button><button id="b-pop" title="Abrir el panel en otra pestaña">↗ Pestaña</button></div></header>
    <section><h3>Partida</h3>
      <div class="muted">Seed <b id="p-seed"></b> · ronda <b id="p-round"></b> · <span id="p-diff"></span></div>
      <div class="sync" id="p-sync"></div>
      <div class="line" style="margin-top:8px"><button id="b-copy-link">🔗 Copiar link compartido</button></div>
      <div class="line" style="margin-top:8px"><button id="b-reroll" title="Cambia la consigna y los 12 Pokémon sin avanzar ni alterar el marcador">🎲 Reroll ronda actual</button></div>
      <div class="line" style="margin-top:8px"><button id="b-prev" title="←">◀ Anterior</button><button id="b-retry" title="T">↺ Reintentar</button><button id="b-skip" title="→">Siguiente ▶</button></div>
      <label>Nueva partida (seed opcional, para reproducirla)</label>
      <div class="line"><input id="p-seed-in" placeholder="p. ej. 12345"><button class="danger" id="b-new">Nueva partida</button></div>
    </section>
    <section><h3>Jugadores</h3>
      ${[0, 1].map(i => `<div class="line" style="margin-bottom:6px"><button data-active="${i}" style="min-width:90px"></button>
        <button data-adj="${i}:-1">−</button><span class="score" data-score="${i}"></span><button data-adj="${i}:1">+</button></div>`).join('')}
      <div class="line"><button id="b-swap" title="J">⇄ Cambiar turno</button><button id="b-undo" title="U / Retroceso">↶ Deshacer clic</button><button class="danger" id="b-reset">Reset score</button></div>
      <div class="muted" style="margin-top:6px">Modo: ${CLICK ? 'un clic cada uno (el tablero es compartido)' : 'una ronda cada uno'}</div>
    </section>
    <section id="debug"><h3>Debug</h3><div id="dbg"></div></section>
    <footer><kbd>R</kbd> grabación 1:1 · <kbd>G</kbd> guías · <kbd>P</kbd> panel · <kbd>M</kbd> mute · <kbd>D</kbd> debug<br>
      <kbd>Enter</kbd>/<kbd>Espacio</kbd> continuar · <kbd>T</kbd> reintentar · <kbd>J</kbd> cambiar turno · <kbd>U</kbd> deshacer clic ·
      <kbd>←</kbd>/<kbd>→</kbd> ronda anterior/siguiente · <kbd>+</kbd>/<kbd>−</kbd> puntaje del jugador activo</footer>`;
  const pq = s => panel.querySelector(s);
  pq('#b-sound').onclick = () => { A.setMuted(!A.isMuted()); updateSound(); };
  pq('#b-pop').onclick = () => window.open(location.href.split('#')[0] + '#panel', '_blank');
  pq('#b-copy-link').onclick = async () => {
    const button = pq('#b-copy-link');
    const url = new URL(location.href); url.searchParams.set('room', ROOM); url.hash = '';
    try { await navigator.clipboard.writeText(url.href); button.textContent = '✓ Link copiado'; }
    catch (_) { button.textContent = url.href; }
    setTimeout(() => { button.textContent = '🔗 Copiar link compartido'; }, 2200);
  };
  pq('#b-prev').onclick = act.prev;
  pq('#b-retry').onclick = act.retry;
  pq('#b-reroll').onclick = act.reroll;
  pq('#b-skip').onclick = act.skip;
  pq('#b-new').onclick = () => act.newMatch(pq('#p-seed-in').value.trim());
  pq('#b-swap').onclick = act.swap;
  pq('#b-undo').onclick = act.undo;
  pq('#b-reset').onclick = act.resetScores;
  panel.addEventListener('click', e => {
    const a = e.target.closest('[data-active]'), d = e.target.closest('[data-adj]');
    if (a) act.setActive(+a.dataset.active);
    if (d) { const [i, v] = d.dataset.adj.split(':').map(Number); act.adjust(i, v); }
  });
  function updateSound() { pq('#b-sound').textContent = A.isMuted() ? '🔇' : '🔊'; }
  let syncInfo = { phase: 'connecting', peers: 0 };
  function updateSync() {
    const node = pq('#p-sync');
    if (!node) return;
    node.className = `sync ${syncInfo.phase === 'error' ? 'error' : syncInfo.peers ? 'online' : ''}`;
    node.textContent = syncInfo.phase === 'error' ? '● Modo local · sin conexión P2P'
      : syncInfo.phase === 'connecting' ? '● Conectando la sala…'
      : syncInfo.peers ? `● ${syncInfo.peers + 1} PCs sincronizadas · sala ${ROOM}`
      : `● Esperando la segunda PC · sala ${ROOM}`;
  }

  function renderPanel(def, solution) {
    pq('#p-seed').textContent = S.seed;
    pq('#p-round').textContent = `${S.index + 1}/${S.order.length}${S.finished ? ' (terminada)' : ''}`;
    pq('#p-diff').textContent = DIFF_TEXT[def.difficulty];
    updateSync();
    pq('#b-retry').disabled = !S.config.allowRetry;
    pq('#b-reroll').disabled = !!S.batch;
    [0, 1].forEach(i => {
      const b = pq(`[data-active="${i}"]`);
      b.textContent = (S.active === i ? '▶ ' : '') + S.config.players[i];
      b.classList.toggle('on', S.active === i);
      pq(`[data-score="${i}"]`).textContent = S.scores[i];
    });
    if (!document.body.classList.contains('debug')) return;
    const audit = Object.fromEntries((DATA.audit[def.id] || []).map(([k, a, b]) => [k, { a, b }]));
    const rows = E.solveRound(def, DATA.facts).map(c => {
      const p = DATA.facts.pokemon[c.key];
      return `<tr><td>${p.name}<br><span class="muted">${c.key} · #${p.id} · ${p.types.join('/')}</span></td>
        <td class="${c.correct ? 'ok' : 'no'}">${c.correct ? 'CORRECTO' : 'BOMBA'}</td><td>${c.detail}</td>
        <td>A: ${audit[c.key] ? audit[c.key].a : '?'}<br>B: ${audit[c.key] ? audit[c.key].b : '?'}</td></tr>`;
    });
    const nextId = S.order[S.index + 1] || '—', prevId = S.order[S.index - 1] || '—';
    const v = DATA.validation;
    pq('#dbg').innerHTML = `
      <div><b>${def.id}</b> · seed ${S.seed} · activo: ${S.config.players[S.active]}</div>
      <div class="muted">anterior: ${prevId} · siguiente: ${nextId}</div>
      <pre>${JSON.stringify(def.condition, null, 1)}</pre>
      <table><tr><td>Pokémon</td><td>Motor</td><td>Detalle</td><td>Fuentes</td></tr>${rows.join('')}</table>
      <p class="muted">Validación ${v.status} · ${v.validatedAt}<br>A: ${v.sources.A.detail}<br>B: ${v.sources.B.detail}</p>
      <div class="line"><button id="d-prev">◀ Ronda anterior</button><button id="d-next">Ronda siguiente ▶</button><button class="danger" id="d-reset">Reset score</button></div>`;
    pq('#d-prev').onclick = act.prev;
    pq('#d-next').onclick = act.skip;
    pq('#d-reset').onclick = act.resetScores;
  }

  /* ─────────── ESCALA / TECLAS ─────────── */
  const reel = $('#reel');
  const cssPx = v => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(v));
  function fit() {
    if (document.body.classList.contains('rec')) { reel.style.transform = ''; return; }
    const h = ['--h-banner-top', '--h-cams', '--h-game', '--h-banner-bottom'].reduce((a, v) => a + cssPx(v), 0);
    const s = Math.min(innerWidth / cssPx('--reel-w'), innerHeight / h, 1);
    reel.style.transform = `translate(-50%,-50%) scale(${s})`;
  }
  addEventListener('resize', fit);

  addEventListener('keydown', e => {
    if (e.target.closest('input,textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const ended = S.round.status !== 'playing';
    if (k === 'r') { document.body.classList.toggle('rec'); scrollTo(0, 0); fit(); }
    else if (k === 'g') document.body.classList.toggle('clean');
    else if (k === 'p') document.body.classList.toggle('nopanel');
    else if (k === 'd') { document.body.classList.toggle('debug'); render(); }
    else if (k === 'm') { A.setMuted(!A.isMuted()); updateSound(); }
    else if (k === 'enter' || k === ' ') { e.preventDefault(); if (S.finished) act.newMatch(); else if (ended) act.next(); }
    else if (k === 't') { if (ended) act.retry(); }
    else if (k === 'j') act.swap();
    else if (k === 'u' || k === 'backspace') act.undo();
    else if (k === 'arrowright') act.skip();
    else if (k === 'arrowleft') act.prev();
    else if (k === '+' || k === '=') act.adjust(S.active, 1);
    else if (k === '-' || k === '_') act.adjust(S.active, -1);
  });

  A.init(CFG.audio);
  if (window.BMSync && params.get('sync') !== '0') {
    const link = window.BMSync.connect({
      roomId: ROOM,
      getState: () => S,
      onState: receive,
      onStatus: info => { syncInfo = info; updateSync(); },
    });
    remotePublish = link.publish;
  } else syncInfo = { phase: 'error', peers: 0 };
  updateSound();
  document.fonts && document.fonts.ready.then(() => { view.key = null; view.first = true; render(); });
  fit();
  preload();
  render();
  window.BM = { get state() { return S; }, data: DATA, render }; // para depurar desde la consola
})();
