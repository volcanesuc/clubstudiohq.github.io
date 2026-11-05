// tools/test_hat.mjs
// Prueba del armado de equipos del hat (tournaments/js/hat.js) con datos de ejemplo:
//   node tools/test_hat.mjs
// ~60 jugadores en Mixto (con parejas mutuas, una de un solo lado y una pareja en otra división)
// y ~24 en Masters Masculino (dos no cumplen la edad mínima y quedan fuera).
// Imprime los números de cada equipo y falla (exit 1) si algo no se cumple.
import assert from "node:assert/strict";
import { HAT_QUESTIONS } from "../tournaments/js/hat-config.js";
import {
  ageOn,
  balanceGap,
  eligibility,
  generateTeams,
  mutualPairs,
  normalize,
  rawScore,
  seededRandom,
  selfScore,
  suggestTeamCount,
  teamStats,
} from "../tournaments/js/hat.js";

const EVENT = { startDate: "2026-12-05" };
const MIXTO = { id: "mixto", name: "Open Mixto", gender: "mixto", mixed: true, hat: {} };
const MASTERS = { id: "masters", name: "Masters Masculino", gender: "masculino", hat: { minAge: 33 } };

// jugadores de ejemplo con respuestas al azar (con semilla: siempre los mismos)
const rand = seededRandom(2026);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
function player(i, gender, div, birthYear) {
  const answers = Object.fromEntries(HAT_QUESTIONS.map((q) => [q.id, pick(q.options).id]));
  const birthDate = `${birthYear}-0${1 + Math.floor(rand() * 9)}-15`;
  return {
    uid: `u${i}`,
    name: `${gender === "F" ? "Jugadora" : "Jugador"} ${i}`,
    gender,
    divisionId: div.id,
    position: answers.position,
    teammateUid: "",
    birthDate,
    age: ageOn(birthDate, EVENT.startDate),
    raw: rawScore({ selfScore: selfScore(answers) }),
  };
}

const mixto = [];
for (let i = 0; i < 26; i++) mixto.push(player(i, "F", MIXTO, 1990 + Math.floor(rand() * 15)));
for (let i = 26; i < 60; i++) mixto.push(player(i, "M", MIXTO, 1988 + Math.floor(rand() * 17)));
const masters = [];
for (let i = 100; i < 122; i++) masters.push(player(i, "M", MASTERS, 1970 + Math.floor(rand() * 22)));
masters.push(player(122, "M", MASTERS, 1999)); // no cumple: 27 años
masters.push(player(123, "M", MASTERS, 2001)); // no cumple: 25 años

// parejas: 3 mutuas (F+M, F+F, M+M), una de un solo lado y una que pide a alguien de Masters
const pair = (a, b) => {
  mixto.find((p) => p.uid === a).teammateUid = b;
  mixto.find((p) => p.uid === b).teammateUid = a;
};
pair("u0", "u26");
pair("u1", "u2");
pair("u27", "u28");
mixto.find((p) => p.uid === "u3").teammateUid = "u29"; // u29 no la eligió
mixto.find((p) => p.uid === "u4").teammateUid = "u100"; // está en Masters: no cuenta
// un par mutuo en Masters también
masters[0].teammateUid = masters[1].uid;
masters[1].teammateUid = masters[0].uid;

function run(div, all, { playersOnField = 7, seed = 1 } = {}) {
  const eligible = all.filter((p) => eligibility(div, p, EVENT).ok);
  const out = all.filter((p) => !eligibility(div, p, EVENT).ok);
  const pool = normalize(eligible);
  const { n } = suggestTeamCount(pool.length, playersOnField);
  const teams = generateTeams(pool, n, { mixed: !!div.mixed, seed });
  return { pool, out, n, teams };
}

function report(div, { pool, out, n, teams }) {
  console.log(`\n=== ${div.name}: ${pool.length} jugadores → ${n} equipos ===`);
  if (out.length) console.log(`Fuera por elegibilidad: ${out.map((p) => `${p.name} (${p.age} años)`).join(", ")}`);
  console.log("Equipo  Jug  F  M  Total   Prom  Handlers  Edad prom");
  teams.forEach((t, i) => {
    const s = teamStats(t);
    console.log(
      `${String(i + 1).padStart(6)}  ${String(s.n).padStart(3)} ${String(s.f).padStart(2)} ${String(s.m).padStart(2)}  ${String(s.total).padStart(6)}  ${String(s.avg).padStart(5)}  ${String(s.handlers).padStart(8)}  ${String(s.avgAge).padStart(9)}`,
    );
  });
  console.log(`Brecha de promedio (más fuerte − más débil): ${balanceGap(teams)}`);
}

// --- Mixto ---
const mx = run(MIXTO, mixto);
report(MIXTO, mx);
const teamOf = new Map(mx.teams.flatMap((t, i) => t.map((p) => [p.uid, i])));
const mxPairs = mutualPairs(mx.pool);
assert.equal(mxPairs.size, 6, "3 parejas mutuas en Mixto (6 jugadores)");
mxPairs.forEach((mate, uid) => assert.equal(teamOf.get(uid), teamOf.get(mate), `pareja ${uid}–${mate} junta`));
const stats = mx.teams.map(teamStats);
assert.ok(Math.max(...stats.map((s) => s.f)) - Math.min(...stats.map((s) => s.f)) <= 1, "F parejo (±1)");
assert.ok(Math.max(...stats.map((s) => s.m)) - Math.min(...stats.map((s) => s.m)) <= 1, "M parejo (±1)");
assert.ok(Math.max(...stats.map((s) => s.n)) - Math.min(...stats.map((s) => s.n)) <= 1, "tamaño parejo (±1)");
assert.equal(mx.teams.flat().length, mx.pool.length, "nadie queda afuera ni repetido");
console.log(`Parejas mutuas juntas: ${mxPairs.size / 2} ✓ · u3→u29 (de un solo lado) y u4→Masters no cuentan`);

// --- Masters ---
const ms = run(MASTERS, masters);
report(MASTERS, ms);
assert.equal(ms.out.length, 2, "dos fuera por edad");
assert.ok(ms.teams.flat().every((p) => p.divisionId === "masters"), "no mezcla divisiones");
const msTeamOf = new Map(ms.teams.flatMap((t, i) => t.map((p) => [p.uid, i])));
assert.equal(msTeamOf.get(masters[0].uid), msTeamOf.get(masters[1].uid), "pareja de Masters junta");

// --- Determinista con semilla, distinto con otra ---
const ids = (teams) => teams.map((t) => t.map((p) => p.uid).sort().join(",")).join("|");
assert.equal(ids(run(MIXTO, mixto, { seed: 1 }).teams), ids(mx.teams), "mismo seed → mismos equipos");
const other = run(MIXTO, mixto, { seed: 99 });
assert.notEqual(ids(other.teams), ids(mx.teams), "otro seed → otro reparto");
console.log(`\nRegenerar (seed 99): brecha ${balanceGap(other.teams)} · equipos distintos ✓`);

// --- Comparación: reparto al azar (para ver cuánto mejora) ---
const shuffled = [...mx.pool].sort(() => rand() - 0.5);
const naive = Array.from({ length: mx.n }, (_, i) => shuffled.filter((_, j) => j % mx.n === i));
console.log(`Referencia: al azar la brecha es ${balanceGap(naive)}`);
console.log("\nTodo OK ✓");
