/* ─── CONFIGURACIÓN DE BUSCAMINAS POKÉMON ───
   Se puede editar sin tocar el resto del código. */
window.BUSCAMINAS_CONFIG = {
  players: ['SKY', 'GUTI'],   // los mismos jugadores que PokeDuelo (izquierda, derecha)
  startingPlayer: 0,          // 0 = SKY empieza, 1 = GUTI empieza
  totalRounds: 20,            // rondas por partida (el banco tiene más; nunca se repiten)
  turnMode: 'click',          // 'click' = un clic cada uno sobre el mismo tablero · 'round' = una ronda cada uno
  allowRetry: true,           // botón REINTENTAR RONDA (false para competitivo)
  perfectBonus: 0,            // puntos extra por ronda perfecta (en modo 'click': para quien encuentra el último)
  bombPenalty: 0,             // puntos que pierde quien toca una bomba
  keepPointsOnBomb: true,     // al tocar una bomba se conservan los aciertos de esa ronda
  difficultyCurve: true,      // fácil → normal → difícil a lo largo de la partida
  audio: {                    // si el archivo no existe, se ignora en silencio
    correct: 'assets/audio/correct.mp3',
    bomb: 'assets/audio/bomb.mp3',
    perfect: 'assets/audio/perfect.mp3',
    nextRound: 'assets/audio/next-round.mp3',
  },
};
