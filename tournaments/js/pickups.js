// /tournaments/js/pickups.js
// Lógica pura de pickups (sin Firestore ni DOM, se prueba con node tools/test_pickups.mjs).
//
// El cupo (confirmado / lista de espera) NO se guarda: sale del orden de llegada (joinedAt).
// Así, cuando alguien se sale, el primero de la espera sube solo.
// Hasta la hora límite (leaveDeadlineAt) el jugador se puede salir; después queda en la lista y debe.

export const PICKUP_STATUS = { DRAFT: "draft", PUBLISHED: "published", FINISHED: "finished", CANCELLED: "cancelled" };
export const PLAYER_STATUS = { ACTIVE: "active", LEFT: "left" };
export const PAY = { NONE: "none", SUBMITTED: "submitted", APPROVED: "approved", REJECTED: "rejected", FREE: "free" };
export const SPOT = { IN: "in", WAITLIST: "waitlist", LEFT: "left" };
export const TIER_RULES = ["any", "member", "first_time", "minor", "guest"];

const toMs = (v) => (v == null ? 0 : typeof v === "number" ? v : v.toMillis ? v.toMillis() : v.seconds != null ? v.seconds * 1000 : v instanceof Date ? v.getTime() : Date.parse(v) || 0);
export const pickupMs = toMs;

export function slugify(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function defaultTiers() {
  return [
    { id: "general", name: "General", rule: "any", price: 0 },
    { id: "member", name: "Miembro", rule: "member", price: 0 },
    { id: "first", name: "Primera vez", rule: "first_time", price: 0 },
  ];
}

const CURRENCY_BY_COUNTRY = { CR: "CRC", MX: "MXN", CO: "COP", GT: "GTQ", PA: "USD", SV: "USD", HN: "HNL", NI: "NIO", US: "USD", ES: "EUR", AR: "ARS", CL: "CLP", PE: "PEN" };
export function defaultPickupSettings(country = "") {
  return {
    currency: CURRENCY_BY_COUNTRY[country] || "USD",
    defaultCapacity: 24,
    leaveHours: 12,
    payInfo: "",
    tiers: defaultTiers(),
  };
}

// Hora límite para salirse: inicio menos N horas
export function leaveDeadline(startMs, leaveHours = 12) {
  if (!startMs) return 0;
  return startMs - Math.max(0, Number(leaveHours) || 0) * 3600000;
}

export const hasStarted = (p, now = Date.now()) => !!toMs(p?.startAt) && now >= toMs(p.startAt);
export const canLeave = (p, now = Date.now()) => now < toMs(p?.leaveDeadlineAt || p?.startAt);
export const isJoinOpen = (p, now = Date.now()) => p?.status === PICKUP_STATUS.PUBLISHED && !hasStarted(p, now);

export const isActive = (pl) => (pl?.status || PLAYER_STATUS.ACTIVE) === PLAYER_STATUS.ACTIVE;
export const isPaid = (pl) => pl?.paymentStatus === PAY.APPROVED || pl?.paymentStatus === PAY.FREE || Number(pl?.price || 0) <= 0;

// Orden de llegada; `order` desempata los que se anotaron en el mismo envío (yo + amigos)
function byArrival(a, b) {
  return toMs(a.joinedAt) - toMs(b.joinedAt) || (a.order || 0) - (b.order || 0) || String(a.id).localeCompare(String(b.id));
}

/** Divide los jugadores activos en confirmados y lista de espera. capacity 0 = sin límite. */
export function splitSpots(pickup, players = []) {
  const active = players.filter(isActive).sort(byArrival);
  const cap = Number(pickup?.capacity || 0);
  if (!cap) return { in: active, waitlist: [] };
  return { in: active.slice(0, cap), waitlist: active.slice(cap) };
}

export function spotOf(pickup, players, playerId) {
  const { in: inList, waitlist } = splitSpots(pickup, players);
  if (inList.some((p) => p.id === playerId)) return SPOT.IN;
  if (waitlist.some((p) => p.id === playerId)) return SPOT.WAITLIST;
  return SPOT.LEFT;
}

export const isFull = (pickup, players = []) => !!Number(pickup?.capacity || 0) && splitSpots(pickup, players).in.length >= Number(pickup.capacity);

// Debe: está confirmado, ya pasó la hora límite (no se puede salir) y no ha pagado
export function owes(pickup, player, spot, now = Date.now()) {
  if (!pickup || !player || pickup.status === PICKUP_STATUS.CANCELLED) return false;
  if (spot !== SPOT.IN || !isActive(player)) return false;
  if (canLeave(pickup, now)) return false;
  return !isPaid(player);
}

export function totals(pickup, players = [], now = Date.now()) {
  const { in: inList, waitlist } = splitSpots(pickup, players);
  const paid = inList.filter(isPaid).length;
  const due = inList.filter((p) => !isPaid(p)).reduce((s, p) => s + Number(p.price || 0), 0);
  const owing = inList.filter((p) => owes(pickup, p, SPOT.IN, now)).length;
  const review = inList.filter((p) => p.paymentStatus === PAY.SUBMITTED).length;
  return { in: inList.length, waitlist: waitlist.length, paid, due, owing, review, capacity: Number(pickup?.capacity || 0) };
}

// Precio más bajo entre las tarifas del pickup (para "desde ₡2.000")
export function minPrice(pickup) {
  const prices = (pickup?.tiers || []).map((t) => Number(t.price || 0));
  return prices.length ? Math.min(...prices) : 0;
}

export function fmtMoney(value, currency = "USD", locale = "es-CR") {
  const n = Number(value || 0);
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
  } catch {
    return `${currency} ${n}`;
  }
}
