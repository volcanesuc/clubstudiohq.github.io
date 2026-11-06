// /tournaments/js/hat-config.js
// Cuestionario de autoevaluación del hat y pesos del puntaje. Sin imports: lo usan el navegador y los tests de node.
// Las respuestas son privadas (solo el organizador las ve). Para cambiar preguntas u opciones, editar acá:
// cada opción tiene un `value` entre 0 y 1 (0 = principiante, 1 = lo máximo) que entra al puntaje con el peso de la pregunta.

export const HAT_QUESTIONS = [
  {
    id: "years",
    label: "¿Cuántos años llevás jugando ultimate?", en: "How many years have you been playing ultimate?",
    options: [
      { id: "never", label: "Nunca he jugado", en: "I've never played", value: 0 },
      { id: "lt1", label: "Menos de 1 año", en: "Less than 1 year", value: 0.15 },
      { id: "1-2", label: "1 a 2 años", en: "1 to 2 years", value: 0.35 },
      { id: "3-5", label: "3 a 5 años", en: "3 to 5 years", value: 0.6 },
      { id: "6-10", label: "6 a 10 años", en: "6 to 10 years", value: 0.85 },
      { id: "10+", label: "Más de 10 años", en: "More than 10 years", value: 1 },
    ],
  },
  {
    id: "level",
    label: "¿Cuál es el nivel más alto en el que has jugado?", en: "What's the highest level you've played at?",
    options: [
      { id: "pickup", label: "Pickup o clase de educación física", en: "Pickup or PE class", value: 0.1 },
      { id: "local", label: "Liga local", en: "Local league", value: 0.35 },
      { id: "uni", label: "Universidad o torneos", en: "College or tournaments", value: 0.55 },
      { id: "club", label: "Club en torneos nacionales", en: "Club at national tournaments", value: 0.8 },
      { id: "national", label: "Selección nacional", en: "National team", value: 1 },
    ],
  },
  {
    id: "recent",
    label: "¿Jugaste con regularidad en los últimos 12 meses?", en: "Did you play regularly in the last 12 months?",
    options: [
      { id: "no", label: "No, casi nada", en: "No, hardly at all", value: 0 },
      { id: "some", label: "A veces (una vez al mes o menos)", en: "Sometimes (once a month or less)", value: 0.5 },
      { id: "yes", label: "Sí, todas o casi todas las semanas", en: "Yes, every or almost every week", value: 1 },
    ],
  },
  {
    id: "throws",
    label: "¿Cómo son tus tiros?", en: "How are your throws?",
    options: [
      { id: "1", label: "1 · Estoy aprendiendo a lanzar", en: "1 · I'm learning to throw", value: 0 },
      { id: "2", label: "2 · Backhand corto confiable", en: "2 · Reliable short backhand", value: 0.25 },
      { id: "3", label: "3 · Backhand y forehand cortos, alguno largo", en: "3 · Short backhand and forehand, some long ones", value: 0.5 },
      { id: "4", label: "4 · Tiros largos y con marca encima", en: "4 · Long throws and throws past a mark", value: 0.75 },
      { id: "5", label: "5 · Hucks, breaks y tiros especiales bajo presión", en: "5 · Hucks, breaks and specialty throws under pressure", value: 1 },
    ],
  },
  {
    id: "speed",
    label: "Velocidad y atletismo, comparado con gente de tu edad", en: "Speed and athleticism, compared with people your age",
    options: [
      { id: "1", label: "1 · Bastante más lento(a) que el promedio", en: "1 · Quite a bit slower than average", value: 0 },
      { id: "2", label: "2 · Un poco más lento(a)", en: "2 · A little slower", value: 0.25 },
      { id: "3", label: "3 · Promedio", en: "3 · Average", value: 0.5 },
      { id: "4", label: "4 · Más rápido(a) que el promedio", en: "4 · Faster than average", value: 0.75 },
      { id: "5", label: "5 · De los más rápidos(as) en cualquier cancha", en: "5 · Among the fastest on any field", value: 1 },
    ],
  },
  {
    id: "stamina",
    label: "¿Cuánto aguantás en un día de torneo?", en: "How much can you play on a tournament day?",
    options: [
      { id: "few", label: "Unos pocos puntos por partido", en: "A few points per game", value: 0.2 },
      { id: "half", label: "Un punto sí y uno no", en: "Every other point", value: 0.6 },
      { id: "all", label: "Todos los puntos, 4 o más partidos", en: "Every point, 4 or more games", value: 1 },
    ],
  },
  {
    // no suma al puntaje: sirve para repartir handlers entre equipos
    id: "position",
    label: "¿En qué posición jugás?", en: "What position do you play?",
    scored: false,
    options: [
      { id: "handler", label: "Handler" },
      { id: "cutter", label: "Cutter" },
      { id: "both", label: "Ambas", en: "Both" },
      { id: "unknown", label: "No sé", en: "I don't know" },
    ],
  },
];

// Peso de cada pregunta en el puntaje propio (se normalizan: no hace falta que sumen 1)
export const HAT_WEIGHTS = {
  years: 0.2,
  level: 0.2,
  recent: 0.1,
  throws: 0.25,
  speed: 0.15,
  stamina: 0.1,
};

// Equipos sugeridos: jugadores por equipo = jugadores en cancha × este factor
export const HAT_PLAYERS_PER_TEAM_FACTOR = 1.6;
