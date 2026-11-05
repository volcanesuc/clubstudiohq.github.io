// /tournaments/js/hat-config.js
// Cuestionario de autoevaluación del hat y pesos del puntaje. Sin imports: lo usan el navegador y los tests de node.
// Las respuestas son privadas (solo el organizador las ve). Para cambiar preguntas u opciones, editar acá:
// cada opción tiene un `value` entre 0 y 1 (0 = principiante, 1 = lo máximo) que entra al puntaje con el peso de la pregunta.

export const HAT_QUESTIONS = [
  {
    id: "years",
    label: "¿Cuántos años llevás jugando ultimate?",
    options: [
      { id: "never", label: "Nunca he jugado", value: 0 },
      { id: "lt1", label: "Menos de 1 año", value: 0.15 },
      { id: "1-2", label: "1 a 2 años", value: 0.35 },
      { id: "3-5", label: "3 a 5 años", value: 0.6 },
      { id: "6-10", label: "6 a 10 años", value: 0.85 },
      { id: "10+", label: "Más de 10 años", value: 1 },
    ],
  },
  {
    id: "level",
    label: "¿Cuál es el nivel más alto en el que has jugado?",
    options: [
      { id: "pickup", label: "Pickup o clase de educación física", value: 0.1 },
      { id: "local", label: "Liga local", value: 0.35 },
      { id: "uni", label: "Universidad o torneos", value: 0.55 },
      { id: "club", label: "Club en torneos nacionales", value: 0.8 },
      { id: "national", label: "Selección nacional", value: 1 },
    ],
  },
  {
    id: "recent",
    label: "¿Jugaste con regularidad en los últimos 12 meses?",
    options: [
      { id: "no", label: "No, casi nada", value: 0 },
      { id: "some", label: "A veces (una vez al mes o menos)", value: 0.5 },
      { id: "yes", label: "Sí, todas o casi todas las semanas", value: 1 },
    ],
  },
  {
    id: "throws",
    label: "¿Cómo son tus tiros?",
    options: [
      { id: "1", label: "1 · Estoy aprendiendo a lanzar", value: 0 },
      { id: "2", label: "2 · Backhand corto confiable", value: 0.25 },
      { id: "3", label: "3 · Backhand y forehand cortos, alguno largo", value: 0.5 },
      { id: "4", label: "4 · Tiros largos y con marca encima", value: 0.75 },
      { id: "5", label: "5 · Hucks, breaks y tiros especiales bajo presión", value: 1 },
    ],
  },
  {
    id: "speed",
    label: "Velocidad y atletismo, comparado con gente de tu edad",
    options: [
      { id: "1", label: "1 · Bastante más lento(a) que el promedio", value: 0 },
      { id: "2", label: "2 · Un poco más lento(a)", value: 0.25 },
      { id: "3", label: "3 · Promedio", value: 0.5 },
      { id: "4", label: "4 · Más rápido(a) que el promedio", value: 0.75 },
      { id: "5", label: "5 · De los más rápidos(as) en cualquier cancha", value: 1 },
    ],
  },
  {
    id: "stamina",
    label: "¿Cuánto aguantás en un día de torneo?",
    options: [
      { id: "few", label: "Unos pocos puntos por partido", value: 0.2 },
      { id: "half", label: "Un punto sí y uno no", value: 0.6 },
      { id: "all", label: "Todos los puntos, 4 o más partidos", value: 1 },
    ],
  },
  {
    // no suma al puntaje: sirve para repartir handlers entre equipos
    id: "position",
    label: "¿En qué posición jugás?",
    scored: false,
    options: [
      { id: "handler", label: "Handler" },
      { id: "cutter", label: "Cutter" },
      { id: "both", label: "Ambas" },
      { id: "unknown", label: "No sé" },
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
