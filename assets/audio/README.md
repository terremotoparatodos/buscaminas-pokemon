# Audio (opcional)

El juego busca estos archivos. Si no existen, no suena nada (fallback silencioso):

| Archivo          | Cuándo suena                        |
|------------------|-------------------------------------|
| `correct.mp3`    | al acertar un Pokémon               |
| `bomb.mp3`       | al tocar una bomba                  |
| `perfect.mp3`    | ronda perfecta (8/8)                |
| `next-round.mp3` | al pasar a la ronda siguiente       |

Las rutas se cambian en `js/config.js` (`audio`). Mute: botón 🔊 del panel o tecla `M`.
