// /tournaments/js/divisions-config.js
// Opciones por defecto para armar divisiones (categoría + rama) y modalidades de juego.
// Se pueden reemplazar sin tocar código desde Firestore: documento platform_config/divisions
// con los campos { levels: [...], genders: [{ id, name, mixed }] } (ver README).
export const DIVISION_OPTIONS = {
  levels: ["Open", "Masters", "Grand Masters", "Sub-24", "Sub-20", "Sub-17", "Universitario", "Recreativo"],
  genders: [
    { id: "mixto", name: "Mixto", mixed: true },
    { id: "masculino", name: "Masculino" },
    { id: "femenino", name: "Femenino" },
    { id: "open", name: "Open" },
  ],
};

// Jugadores en cancha por modalidad; "other" deja escribir la cantidad
export const GAME_MODES = [
  { id: "7v7", label: "7 vs 7", players: 7 },
  { id: "5v5", label: "5 vs 5", players: 5 },
  { id: "4v4", label: "4 vs 4", players: 4 },
  { id: "3v3", label: "3 vs 3", players: 3 },
  { id: "other", label: "Otra", players: null },
];
