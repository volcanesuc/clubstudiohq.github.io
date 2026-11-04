// /tournaments/js/scheduler.js
// Arma el calendario (sin Firebase): reparte partidos en días, horarios y canchas respetando
//  - días del torneo con su horario, o fechas de una liga (días de la semana, cada N semanas, fechas que se saltan)
//  - máximo de partidos por equipo por día y descanso mínimo entre partidos del mismo equipo
//  - repartir parejo entre los días o llenar primero
//  - llaves: un partido va después (con descanso) de los partidos de los que salen sus equipos; playoffs el último día
//  - varias categorías: mezcladas en la misma hora, alternadas por bloques o una después de la otra
// Los partidos que no entran quedan "sin programar" con el motivo.

const toMin = (hhmm) => {
  const [h, m] = String(hhmm || "0:0").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
const pad = (n) => String(n).padStart(2, "0");
const dayStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (day, min) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, Math.floor(min / 60), min % 60);
};

/**
 * Días de juego con su horario.
 * @param {{ kind: "tournament"|"league", days?: {day,start,end}[], league?: { from, to, weekdays: number[], every: number, skip: string[], start, end } }} cfg
 * @returns {{ day: string, start: number, end: number }[]}
 */
export function playDays(cfg) {
  if (cfg.kind === "league") {
    const l = cfg.league || {};
    if (!l.from || !l.to || !(l.weekdays || []).length) return [];
    const out = [];
    const first = new Date(`${l.from}T12:00`);
    const last = new Date(`${l.to}T12:00`);
    const skip = new Set(l.skip || []);
    const every = Math.max(1, Number(l.every) || 1);
    // semana 0 = la del inicio (lunes como inicio de semana)
    const weekStart = (d) => {
      const x = new Date(d);
      x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
      return x;
    };
    const w0 = weekStart(first).getTime();
    for (let d = new Date(first); d <= last && out.length < 400; d.setDate(d.getDate() + 1)) {
      const week = Math.round((weekStart(d).getTime() - w0) / (7 * 86400000));
      if (week % every) continue;
      if (!l.weekdays.includes(d.getDay())) continue;
      const day = dayStr(d);
      if (skip.has(day)) continue;
      out.push({ day, start: toMin(l.start || "19:00"), end: toMin(l.end || "22:00") });
    }
    return out;
  }
  return (cfg.days || []).filter((d) => d.on !== false && d.day).map((d) => ({ day: d.day, start: toMin(d.start || "08:00"), end: toMin(d.end || "18:00") }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * @param {object} p
 * @param {Record<string, object[]>} p.byDivision partidos a programar por categoría (de los generadores de formato)
 * @param {string[]} p.divisionOrder orden de las categorías
 * @param {object[]} p.occupied partidos que ya están (no se tocan): ocupan cancha, hora y equipo
 * @param {{ day, start, end }[]} p.days
 * @param {string[]} p.fields canchas
 * @param {number} p.slotMinutes duración del partido + descanso entre partidos
 * @param {{ maxPerDay?: number, restSlots?: number, spread?: boolean, playoffsLastDay?: boolean,
 *           mix?: "mixed"|"alternate"|"sequential", block?: number, fillCourts?: boolean }} p.rules
 * @returns {{ games: object[], unscheduled: { game: object, reason: string }[] }}
 */
export function buildSchedule({ byDivision = {}, divisionOrder = [], occupied = [], days = [], fields = [], slotMinutes = 100, rules = {} }) {
  const courts = fields.length ? fields : [""];
  const step = Math.max(15, Number(slotMinutes) || 100);
  const maxPerDay = Number(rules.maxPerDay) || 0;
  const rest = Math.max(0, Number(rules.restSlots) || 0);
  const mix = rules.mix || "mixed";
  const block = Math.max(1, Number(rules.block) || 1);
  const fillCourts = rules.fillCourts !== false;
  const divs = divisionOrder.filter((d) => (byDivision[d] || []).length);

  // franjas de cada día (índice global para medir descansos dentro del día)
  const daySlots = days.map((d) => {
    const list = [];
    for (let m = d.start; m + step <= d.end + 0.01 || (list.length === 0 && m < d.end); m += step) list.push(m);
    return { ...d, slots: list };
  });

  // ocupado: cancha+hora y equipo+día+franja (partidos que ya existen y no se regeneran)
  const cellBusy = new Set();
  const teamSlots = new Map(); // `${teamId}|${day}` -> [slotIdx]
  const teamDayCount = new Map();
  const mark = (teamId, day, idx) => {
    if (!teamId) return;
    const k = `${teamId}|${day}`;
    if (!teamSlots.has(k)) teamSlots.set(k, []);
    teamSlots.get(k).push(idx);
    teamDayCount.set(k, (teamDayCount.get(k) || 0) + 1);
  };
  const dayOfMs = (ms) => dayStr(new Date(ms));
  occupied.forEach((g) => {
    const ms = g.startAt?.toMillis ? g.startAt.toMillis() : g.startAt ? new Date(g.startAt).getTime() : 0;
    if (!ms) return;
    const d = new Date(ms);
    const day = dayOfMs(ms);
    const ds = daySlots.find((x) => x.day === day);
    const min = d.getHours() * 60 + d.getMinutes();
    const idx = ds ? Math.round((min - ds.start) / step) : -1;
    cellBusy.add(`${day}|${idx}|${g.field || ""}`);
    [g.teamA?.id, g.teamB?.id].forEach((t) => mark(t, day, idx));
  });

  const queues = Object.fromEntries(divs.map((d) => [d, (byDivision[d] || []).slice().sort((a, b) => (a.round || 0) - (b.round || 0))]));
  const placedAt = new Map(); // `${div}|${key}` -> { dayIdx, slotIdx }
  const poolDone = new Map(); // `${div}|${pool}` -> { dayIdx, slotIdx } último partido del grupo
  const out = [];
  const lastDay = daySlots.length - 1;
  const poolOf = (g) => String(g.pool || "").toUpperCase();
  const before = (a, b, gap = 0) => a.dayIdx < b.dayIdx || (a.dayIdx === b.dayIdx && a.slotIdx + gap < b.slotIdx);

  // ¿se puede jugar g en (dayIdx, slotIdx)?
  function eligible(div, g, dayIdx, slotIdx, usedTeams) {
    const day = daySlots[dayIdx].day;
    const here = { dayIdx, slotIdx };
    for (const s of [g.slotA, g.slotB]) {
      if (!s) continue;
      if (s.from) {
        const src = placedAt.get(`${div}|${s.from}`);
        if (!src || !before(src, here, rest)) return false;
      }
      if (s.pool) {
        const pending = queues[div].some((x) => !x.key && (poolOf(x) === s.pool || !x.pool));
        const done = poolDone.get(`${div}|${s.pool}`) || poolDone.get(`${div}|`);
        if (pending || (done && !before(done, here, rest))) return false;
      }
    }
    if (rules.playoffsLastDay && g.key && dayIdx !== lastDay && days.length > 1) return false;
    for (const t of [g.teamA?.id, g.teamB?.id]) {
      if (!t) continue;
      if (usedTeams.has(t)) return false;
      const k = `${t}|${day}`;
      if (maxPerDay && (teamDayCount.get(k) || 0) >= maxPerDay) return false;
      if ((teamSlots.get(k) || []).some((i) => Math.abs(i - slotIdx) <= rest)) return false;
    }
    return true;
  }

  // categorías en orden de preferencia para una cancha en una franja
  function priority(slotSeq, courtIdx) {
    if (divs.length <= 1) return divs;
    let firstIdx;
    if (mix === "alternate") firstIdx = Math.floor(slotSeq / block) % divs.length;
    else if (mix === "sequential") firstIdx = divs.findIndex((d) => queues[d].length);
    else firstIdx = (courtIdx + slotSeq) % divs.length; // mezcladas: cada cancha una categoría, rotando
    const order = [...divs.slice(Math.max(0, firstIdx)), ...divs.slice(0, Math.max(0, firstIdx))];
    return fillCourts ? order : order.slice(0, 1);
  }

  let slotSeq = 0;
  daySlots.forEach((ds, dayIdx) => {
    // repartir parejo: cada categoría juega en este día en proporción a su capacidad (franjas × canchas)
    const cap = (x) => x.slots.length * courts.length;
    const capLeft = daySlots.slice(dayIdx).reduce((n, x) => n + cap(x), 0) || 1;
    const quota = Object.fromEntries(divs.map((d) => [d, rules.spread ? Math.ceil((queues[d].length * cap(ds)) / capLeft) : Infinity]));
    const usedToday = Object.fromEntries(divs.map((d) => [d, 0]));
    ds.slots.forEach((min, slotIdx) => {
      const usedTeams = new Set();
      courts.forEach((field, courtIdx) => {
        if (cellBusy.has(`${ds.day}|${slotIdx}|${field}`)) return;
        for (const div of priority(slotSeq, courtIdx)) {
          if (usedToday[div] >= quota[div]) continue;
          const q = queues[div];
          const i = q.findIndex((g) => eligible(div, g, dayIdx, slotIdx, usedTeams));
          if (i < 0) continue;
          const g = q.splice(i, 1)[0];
          usedToday[div]++;
          [g.teamA?.id, g.teamB?.id].forEach((t) => {
            if (!t) return;
            usedTeams.add(t);
            mark(t, ds.day, slotIdx);
          });
          const pos = { dayIdx, slotIdx };
          if (g.key) placedAt.set(`${div}|${g.key}`, pos);
          else poolDone.set(`${div}|${poolOf(g)}`, pos);
          out.push({ ...g, divisionId: div, field, startAt: at(ds.day, min) });
          break;
        }
      });
      slotSeq++;
    });
  });

  const unscheduled = [];
  divs.forEach((d) => queues[d].forEach((g) => unscheduled.push({ game: { ...g, divisionId: d, field: "", startAt: null }, reason: "noRoom" })));
  return { games: out, unscheduled };
}

/**
 * Avisos de la vista previa: equipos que pasan el máximo por día, días vacíos, partidos sin lugar.
 */
export function scheduleWarnings(plan, { maxPerDay = 0 } = {}) {
  const warn = [];
  if (plan.unscheduled.length) warn.push({ type: "unscheduled", n: plan.unscheduled.length });
  if (maxPerDay) {
    const count = new Map();
    plan.games.forEach((g) => [g.teamA, g.teamB].forEach((t) => {
      if (!t?.id) return;
      const k = `${t.id}|${dayStr(g.startAt)}`;
      count.set(k, { name: t.name, day: dayStr(g.startAt), n: (count.get(k)?.n || 0) + 1 });
    }));
    [...count.values()].filter((x) => x.n > maxPerDay).forEach((x) => warn.push({ type: "overMax", ...x }));
  }
  return warn;
}
