/* Efectos de sonido opcionales. Si un archivo no existe o no carga, se ignora
   en silencio: el juego nunca depende del audio. */
window.BMAudio = (function () {
  const MUTE_KEY = 'buscaminas-muted';
  const clips = {};
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (_) {}

  function init(map) {
    Object.entries(map || {}).forEach(([name, src]) => {
      if (!src) return;
      const a = new Audio();
      a.preload = 'auto';
      a.addEventListener('canplaythrough', () => { clips[name] = a; }, { once: true });
      a.addEventListener('error', () => { delete clips[name]; }, { once: true });
      a.src = src;
    });
  }
  function play(name) {
    if (muted || !clips[name]) return;
    try { clips[name].currentTime = 0; const p = clips[name].play(); if (p) p.catch(() => {}); } catch (_) {}
  }
  function setMuted(v) {
    muted = !!v;
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (_) {}
  }
  return { init, play, setMuted, isMuted: () => muted, loaded: () => Object.keys(clips) };
})();
