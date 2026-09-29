/* Sincronización P2P entre computadoras.
   Trystero usa la red Nostr sólo para que los navegadores se encuentren;
   el estado de la partida viaja cifrado y directamente por WebRTC. */
window.BMSync = (function () {
  'use strict';

  const CDN = 'https://esm.run/trystero@0.25.4';
  const APP_ID = 'ar.terremotoparatodos.buscaminas-pokemon.v1';

  function connect(options) {
    const peers = new Set();
    let action = null;
    let room = null;
    let pending = null;
    let ready = false;

    const status = (phase, error) => options.onStatus({ phase, peers: peers.size, error });
    const publish = state => {
      pending = state;
      if (ready && action) action.send(state).catch(() => status('error', 'No se pudo enviar el estado'));
    };

    import(CDN).then(({ joinRoom }) => {
      room = joinRoom({ appId: APP_ID }, options.roomId);
      action = room.makeAction('game-state');
      action.onMessage = state => options.onState(state);
      room.onPeerJoin = peerId => {
        peers.add(peerId);
        status('ready');
        action.send(options.getState(), { target: peerId }).catch(() => {});
      };
      room.onPeerLeave = peerId => {
        peers.delete(peerId);
        status('ready');
      };
      ready = true;
      status('ready');
      if (pending) action.send(pending).catch(() => {});
    }).catch(error => status('error', error && error.message ? error.message : 'Sin conexión'));

    addEventListener('beforeunload', () => { if (room) room.leave(); }, { once: true });
    status('connecting');
    return { publish };
  }

  return { connect };
})();
