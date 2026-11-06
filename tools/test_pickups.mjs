// node tools/test_pickups.mjs — prueba la lógica pura de pickups (cupos, lista de espera, hora límite, quién debe)
import assert from "node:assert/strict";
import { PAY, SPOT, canLeave, leaveDeadline, owes, spotOf, splitSpots, totals } from "../tournaments/js/pickups.js";

const H = 3600000;
const start = Date.UTC(2026, 10, 12, 1, 0); // jue 12 nov 19:00 en Costa Rica
const pickup = { status: "published", capacity: 3, startAt: start, leaveDeadlineAt: leaveDeadline(start, 12), tiers: [] };
const pl = (id, minute, extra = {}) => ({ id, name: id, status: "active", joinedAt: start - 48 * H + minute * 60000, price: 3000, paymentStatus: PAY.NONE, ...extra });

let players = [pl("ana", 1), pl("beto", 2, { paymentStatus: PAY.APPROVED }), pl("caro", 3), pl("dani", 4), pl("eli", 5, { price: 0, paymentStatus: PAY.FREE })];

// 1. orden de llegada: 3 confirmados, 2 en espera
let s = splitSpots(pickup, players);
assert.deepEqual(s.in.map((p) => p.id), ["ana", "beto", "caro"]);
assert.deepEqual(s.waitlist.map((p) => p.id), ["dani", "eli"]);

// 2. alguien se sale: el primero de la espera sube solo
players = players.map((p) => (p.id === "beto" ? { ...p, status: "left" } : p));
s = splitSpots(pickup, players);
assert.deepEqual(s.in.map((p) => p.id), ["ana", "caro", "dani"]);
assert.equal(spotOf(pickup, players, "eli"), SPOT.WAITLIST);
assert.equal(spotOf(pickup, players, "beto"), SPOT.LEFT);

// 3. hora límite: 12 h antes
assert.equal(canLeave(pickup, start - 13 * H), true);
assert.equal(canLeave(pickup, start - 11 * H), false);

// 4. quién debe: confirmado, sin pagar y ya pasó la hora límite
const after = start - 11 * H;
const before = start - 13 * H;
const ana = players.find((p) => p.id === "ana");
assert.equal(owes(pickup, ana, SPOT.IN, before), false);
assert.equal(owes(pickup, ana, SPOT.IN, after), true);
assert.equal(owes(pickup, players.find((p) => p.id === "eli"), SPOT.WAITLIST, after), false);
assert.equal(owes({ ...pickup, status: "cancelled" }, ana, SPOT.IN, after), false);

// 5. totales
const t = totals(pickup, players, after);
assert.equal(t.in, 3);
assert.equal(t.waitlist, 1);
assert.equal(t.paid, 0);
assert.equal(t.due, 9000);
assert.equal(t.owing, 3);

// 6. sin cupo (0) = todos confirmados; amigos del mismo envío se ordenan por `order`
const same = start - 24 * H;
const group = [pl("yo", 0, { joinedAt: same, order: 0 }), pl("amigo2", 0, { joinedAt: same, order: 2 }), pl("amigo1", 0, { joinedAt: same, order: 1 })];
assert.deepEqual(splitSpots({ ...pickup, capacity: 0 }, group).in.map((p) => p.id), ["yo", "amigo1", "amigo2"]);

console.log("pickups: 6 casos OK");
console.log("  confirmados:", s.in.map((p) => p.id).join(", "), "| espera:", s.waitlist.map((p) => p.id).join(", "));
console.log("  totales después de la hora límite:", JSON.stringify(t));
