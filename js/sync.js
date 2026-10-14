/* Encuentro P2P por Nostr y MQTT; la partida viaja por WebRTC. */
window.BMSync = (function () {
  'use strict';
  const APP_ID = 'ar.terremotoparatodos.buscaminas-pokemon.v1';
  const STRATEGIES = [
    'https://esm.run/trystero@0.25.4',
    'https://esm.run/@trystero-p2p/mqtt@0.25.4',
  ];
  function connect(options) {
    const links = [];
    let received = false;
    let stopped = false;
    let failures = 0;
    const status = () => options.onStatus({
      phase: failures === STRATEGIES.length ? 'error' : 'ready',
      peers: Math.max(0, ...links.map(link => link.peers.size)), received,
    });
    const send = (link, state, target) => {
      if (!link.peers.size) return;
      Promise.resolve().then(() => link.action.send(state, target ? { target } : undefined))
        .catch(error => {
          console.warn('No se pudo sincronizar la partida:', error);
          options.onStatus({ phase: 'error', peers: link.peers.size, received: false });
        });
    };
    const publish = state => links.forEach(link => send(link, state));
    for (const url of STRATEGIES) {
      import(url).then(({ joinRoom }) => {
        if (stopped) return;
        const room = joinRoom({ appId: APP_ID }, options.roomId);
        const link = { room, action: room.makeAction('game-state'), peers: new Set() };
        links.push(link);
        link.action.onMessage = state => {
          options.onState(state);
          received = true;
          status();
        };
        room.onPeerJoin = peerId => {
          link.peers.add(peerId);
          status();
          send(link, options.getState(), peerId);
        };
        room.onPeerLeave = peerId => {
          link.peers.delete(peerId);
          if (!links.some(l => l.peers.size)) received = false;
          status();
        };
        status();
      }).catch(error => {
        failures++;
        console.warn('Vía de conexión no disponible:', error);
        status();
      });
    }
    // Recupera el estado tras suspender una pestaña o perder el primer envío.
    const timer = setInterval(() => publish(options.getState()), 5000);
    addEventListener('beforeunload', () => {
      stopped = true;
      clearInterval(timer);
      links.forEach(link => link.room.leave());
    }, { once: true });
    options.onStatus({ phase: 'connecting', peers: 0, received: false });
    return { publish };
  }
  return { connect };
})();
