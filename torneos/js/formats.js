// /js/features/events/formats.js
// Formatos de competencia. Cada formato genera partidos (sin guardarlos) a partir de los equipos.
// Para agregar uno (fase 2: swiss, eliminación, grupos + llave, personalizados):
//   registerFormat({ id, label, available: true, generate(teams, options) -> [{ phase, round, teamA, teamB }] })
// El organizador elige el formato al generar el calendario; los horarios y canchas los asigna assignSlots().

const FORMATS = new Map();

export function registerFormat(format) {
  FORMATS.set(format.id, format);
}

export function listFormats() {
  return [...FORMATS.values()];
}

export function getFormat(id) {
  return FORMATS.get(id) || FORMATS.get("round_robin");
}

/* =========================
   Round robin (todos contra todos, por grupo)
========================= */
// Método del círculo: n equipos -> n-1 rondas (n par) o n rondas con descanso (n impar).
export function roundRobinPairs(teams) {
  const list = [...teams];
  if (list.length < 2) return [];
  if (list.length % 2) list.push(null); // descanso
  const n = list.length;
  const rounds = [];
  let rot = list.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const ring = [list[0], ...rot];
    const games = [];
    for (let i = 0; i < n / 2; i++) {
      const a = ring[i];
      const b = ring[n - 1 - i];
      if (a && b) games.push(r % 2 ? [b, a] : [a, b]); // alterna quién es "A"
    }
    rounds.push(games);
    rot = [rot[rot.length - 1], ...rot.slice(0, -1)];
  }
  return rounds;
}

registerFormat({
  id: "round_robin",
  label: "Round robin (todos contra todos)",
  available: true,
  // teams: [{ id, name, pool }]; un round robin por grupo
  generate(teams) {
    const pools = new Map();
    teams.forEach((t) => {
      const pool = String(t.pool || "").trim().toUpperCase() || "A";
      if (!pools.has(pool)) pools.set(pool, []);
      pools.get(pool).push(t);
    });
    const singlePool = pools.size === 1;
    const games = [];
    pools.forEach((poolTeams, pool) => {
      roundRobinPairs(poolTeams).forEach((round, ri) => {
        round.forEach(([a, b]) => games.push({ pool: singlePool ? "" : pool, round: ri + 1, teamA: a, teamB: b }));
      });
    });
    return games;
  },
});

// Fase 2: se habilitan al implementarlos
registerFormat({ id: "swiss", label: "Swiss", available: false, generate: () => [] });
registerFormat({ id: "single_elim", label: "Eliminación directa", available: false, generate: () => [] });
registerFormat({ id: "pools_bracket", label: "Grupos + llave", available: false, generate: () => [] });

/* =========================
   Horarios y canchas
========================= */
/**
 * Reparte partidos en franjas: cada franja usa todas las canchas, y un equipo no juega dos veces en la misma franja.
 * Mantiene el orden por ronda (los de la ronda 1 primero).
 * @returns los mismos partidos con { field, startAt: Date }
 */
export function assignSlots(games, { fields = [], start, gameMinutes = 90 } = {}) {
  const courts = fields.length ? fields : [""];
  const pending = games.slice().sort((a, b) => (a.round || 0) - (b.round || 0));
  const out = [];
  let slot = 0;
  while (pending.length) {
    const busy = new Set();
    let used = 0;
    for (let i = 0; i < pending.length && used < courts.length; ) {
      const g = pending[i];
      const ids = [g.teamA?.id, g.teamB?.id];
      if (ids.some((id) => busy.has(id))) {
        i++;
        continue;
      }
      ids.forEach((id) => busy.add(id));
      out.push({
        ...g,
        field: courts[used],
        startAt: start ? new Date(start.getTime() + slot * gameMinutes * 60000) : null,
      });
      used++;
      pending.splice(i, 1);
    }
    slot++;
    if (slot > 500) break; // seguridad
  }
  return out;
}
