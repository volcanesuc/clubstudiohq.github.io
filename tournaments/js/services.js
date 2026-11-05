// /tournaments/js/services.js
// Firestore de la plataforma de torneos:
//   events/{eventId}                        torneo (info, reglas, organizadores, activación)
//   events/{eventId}/teams/{teamId}         equipos con roster
//   events/{eventId}/registrations/{regId}  inscripciones que mandan los admins de equipo
//   squads/{id} (+ members, private, tournaments)  equipos permanentes: ver squads.js
//   squad_invites/{token}, profiles/{uid}          invitaciones y perfiles de jugador
//   events/{eventId}/games/{gameId}         partidos (marcador, reloj, resumen, espíritu)
//   events/{eventId}/games/{gameId}/plays   jugadas
//   game_keys/{token}                       link de planillero -> { eventId, gameId }
//   game_claims/{gameId}_{uid}              sesión que reclamó un link
//   platform_admins/{uid}                   quién aprueba torneos (se crea a mano en la consola)
import { auth, db, COL } from "/tournaments/js/firebase.js";
import { onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { GAME_STATUS, randomId } from "/tournaments/js/model.js";
import { DIVISION_OPTIONS } from "/tournaments/js/divisions-config.js";
import { resolveGames } from "/tournaments/js/brackets.js";
import { toMillis } from "/tournaments/js/ui.js";

export const APPROVAL = { NONE: "none", REQUESTED: "requested", APPROVED: "approved", REJECTED: "rejected" };
export const REG = { PENDING: "pending", APPROVED: "approved", REJECTED: "rejected" };

const list = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
const eventRef = (eid) => doc(db, COL.events, eid);
const teamsCol = (eid) => collection(db, COL.events, eid, "teams");
const regsCol = (eid) => collection(db, COL.events, eid, "registrations");
const gamesCol = (eid) => collection(db, COL.events, eid, "games");
const playsCol = (eid, gid) => collection(db, COL.events, eid, "games", gid, "plays");
const byStartDesc = (a, b) => String(b.startDate || "").localeCompare(String(a.startDate || ""));

export const isApproved = (event) => event?.approval?.status === APPROVAL.APPROVED;

// Fecha límite de inscripción ("YYYY-MM-DD"): cierra al terminar ese día (hora local).
export const deadlineEnd = (day) => (/^\d{4}-\d{2}-\d{2}$/.test(day || "") ? new Date(`${day}T23:59:59`) : null);
export const registrationExpired = (event, now = new Date()) => {
  const end = event?.registrationDeadlineAt ? new Date(toMillis(event.registrationDeadlineAt)) : deadlineEnd(event?.registrationDeadline);
  return !!end && now > end;
};
// Cuotas del torneo: { team, currency, info } (la cuota por jugador queda para después)
export const CURRENCIES = ["CRC", "USD", "EUR", "MXN", "COP", "GTQ", "HNL", "NIO", "PAB", "DOP", "PEN", "CLP", "ARS"];
export const teamFee = (event) => Number(event?.fees?.team) || 0;
export function fmtMoney(amount, currency = "USD") {
  try {
    return new Intl.NumberFormat("es", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(amount) || 0);
  } catch {
    return `${currency} ${Number(amount) || 0}`;
  }
}

// Pago de la inscripción: el admin del equipo sube el comprobante (opcional) y el organizador lo aprueba.
// En la inscripción: paymentStatus "none" | "submitted" | "approved" | "rejected", paymentProof (imagen), paymentAt
export const PAYMENT = { NONE: "none", SUBMITTED: "submitted", APPROVED: "approved", REJECTED: "rejected" };

export async function submitRegistrationPayment(eid, rid, proof) {
  await updateDoc(doc(regsCol(eid), rid), { paymentProof: proof, paymentStatus: PAYMENT.SUBMITTED, paymentAt: serverTimestamp(), updatedAt: serverTimestamp() });
}

export async function decideRegistrationPayment(eid, rid, approved, note = "") {
  await updateDoc(doc(regsCol(eid), rid), {
    paymentStatus: approved ? PAYMENT.APPROVED : PAYMENT.REJECTED,
    paymentNote: note,
    paymentDecidedAt: serverTimestamp(),
    paymentDecidedBy: auth.currentUser?.uid || null,
    updatedAt: serverTimestamp(),
  });
}

// Formulario de exención (waiver) del torneo: event.waiver = { enabled, title, text, askEmergency, askBirth, askMedical, version }
// Cada jugador firma el suyo: waivers/{uid} (datos privados: solo el jugador y el organizador)
// y waiver_status/{uid} (público: quién firmó, para que el equipo vea pendientes).
export const waiverOn = (event) => event?.waiver?.enabled === true && !!String(event.waiver.text || "").trim();
export const waiverVersion = (text = "") => {
  let h = 0;
  for (const c of String(text)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return `v${(h >>> 0).toString(36)}`;
};

export async function listWaiverStatus(eid) {
  const snap = await getDocs(collection(db, COL.events, eid, "waiver_status"));
  return list(snap);
}

export async function loadMyWaiver(eid, uid) {
  const snap = await getDoc(doc(db, COL.events, eid, "waivers", uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function signWaiver(eid, user, data) {
  const batch = writeBatch(db);
  const at = serverTimestamp();
  batch.set(doc(db, COL.events, eid, "waivers", user.uid), { ...data, uid: user.uid, email: user.email || "", signedAt: at });
  batch.set(doc(db, COL.events, eid, "waiver_status", user.uid), {
    uid: user.uid, name: data.signature || "", teamId: data.teamId || "", teamName: data.teamName || "", version: data.version || "", minor: !!data.guardianName, signedAt: at,
  });
  await batch.commit();
}

// Roster cerrado: después de rosterDeadline los equipos ya no suman ni sacan jugadores (el organizador sí).
export const rosterLocked = (event, now = new Date()) => {
  const end = event?.rosterDeadlineAt ? new Date(toMillis(event.rosterDeadlineAt)) : deadlineEnd(event?.rosterDeadline);
  return !!end && now > end;
};

// Inscripciones abiertas: el interruptor del organizador y que no haya pasado la fecha límite
export const registrationIsOpen = (event, now = new Date()) => event?.registrationOpen === true && !registrationExpired(event, now);

/* =========================
   Configuración de la plataforma
========================= */
// Opciones de divisiones: platform_config/divisions en Firestore o, si no existe, el archivo de config
let divisionOptions = null;
export async function loadDivisionOptions() {
  if (divisionOptions) return divisionOptions;
  try {
    const snap = await getDoc(doc(db, COL.platformConfig, "divisions"));
    const d = snap.exists() ? snap.data() : {};
    divisionOptions = {
      levels: Array.isArray(d.levels) && d.levels.length ? d.levels : DIVISION_OPTIONS.levels,
      genders: Array.isArray(d.genders) && d.genders.length ? d.genders : DIVISION_OPTIONS.genders,
    };
  } catch {
    divisionOptions = DIVISION_OPTIONS;
  }
  return divisionOptions;
}

/* =========================
   Admins de la plataforma
========================= */
export async function isPlatformAdmin(uid) {
  if (!uid) return false;
  try {
    return (await getDoc(doc(db, COL.platformAdmins, uid))).exists();
  } catch {
    return false;
  }
}

/* =========================
   Torneos
========================= */
export async function listPublicEvents() {
  const snap = await getDocs(query(collection(db, COL.events), where("isPublic", "==", true)));
  return list(snap).sort(byStartDesc);
}

// Torneos donde el usuario es dueño/co-organizador (por uid o por correo)
export async function listMyEvents(user) {
  if (!user) return [];
  const queries = [getDocs(query(collection(db, COL.events), where("organizerUids", "array-contains", user.uid)))];
  if (user.email) queries.push(getDocs(query(collection(db, COL.events), where("organizerEmails", "array-contains", user.email.toLowerCase()))));
  const snaps = await Promise.all(queries.map((p) => p.catch(() => null)));
  const map = new Map();
  snaps.filter(Boolean).forEach((s) => list(s).forEach((e) => map.set(e.id, e)));
  return [...map.values()].sort(byStartDesc);
}

export async function loadEvent(eid) {
  const snap = await getDoc(eventRef(eid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function loadPublicEventBySlug(slug) {
  const snap = await getDocs(query(collection(db, COL.events), where("slug", "==", slug), where("isPublic", "==", true)));
  return snap.docs[0] ? { id: snap.docs[0].id, ...snap.docs[0].data() } : null;
}

export async function createEvent(user, data) {
  const id = randomId("ev");
  await setDoc(eventRef(id), {
    ...data,
    ownerUid: user.uid,
    ownerEmail: (user.email || "").toLowerCase(),
    ownerName: user.displayName || "",
    organizerUids: [user.uid],
    organizerEmails: data.organizerEmails || [], // co-organizadores (Crear torneo, etapa 5)
    isPublic: false,
    approval: { status: APPROVAL.NONE },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return id;
}

// El organizador no toca dueño ni activación (las reglas lo impiden igual).
export async function saveEvent(eid, data) {
  const { ownerUid, approval, ...safe } = data;
  await setDoc(eventRef(eid), { ...safe, updatedAt: serverTimestamp() }, { merge: true });
}

export async function deleteEvent(eid) {
  const [teams, games, regs] = await Promise.all([listTeams(eid), listGames(eid), listRegistrations(eid).catch(() => [])]);
  const batch = writeBatch(db);
  teams.forEach((t) => batch.delete(doc(teamsCol(eid), t.id)));
  regs.forEach((r) => batch.delete(doc(regsCol(eid), r.id)));
  games.forEach((g) => batch.delete(doc(gamesCol(eid), g.id)));
  batch.delete(eventRef(eid));
  await batch.commit();
}

/* =========================
   Activación (aprobación + plan)
========================= */
export async function requestApproval(eid, note = "") {
  await setDoc(eventRef(eid), {
    approval: { status: APPROVAL.REQUESTED, note: String(note).slice(0, 500), requestedAt: serverTimestamp() },
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function listApprovalRequests() {
  const snap = await getDocs(query(collection(db, COL.events), where("approval.status", "==", APPROVAL.REQUESTED)));
  return list(snap).sort((a, b) => toMillis(a.approval?.requestedAt) - toMillis(b.approval?.requestedAt));
}

export async function listApprovedEvents() {
  const snap = await getDocs(query(collection(db, COL.events), where("approval.status", "==", APPROVAL.APPROVED)));
  return list(snap).sort(byStartDesc);
}

export async function setApproval(eid, { status, plan = "", expiresAt = null, adminNote = "" }) {
  await setDoc(eventRef(eid), {
    approval: {
      status,
      plan,
      expiresAt,
      adminNote: String(adminNote).slice(0, 500),
      decidedAt: serverTimestamp(),
      decidedBy: auth.currentUser?.uid || null,
    },
    // si se desactiva, deja de ser público
    ...(status === APPROVAL.APPROVED ? {} : { isPublic: false }),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

/* =========================
   Equipos
========================= */
// Datos del club (squads/{id}) por id, una lectura por página aunque varios torneos lo pidan.
const squadCache = new Map();
function squadInfo(sid) {
  if (!squadCache.has(sid)) {
    squadCache.set(sid, getDoc(doc(db, COL.squads, sid)).then((d) => (d.exists() ? d.data() : null)).catch(() => null));
  }
  return squadCache.get(sid);
}

// Equipos del torneo. Los que vienen de un club muestran el logo, color y ciudad actuales del club
// (al inscribirse se guarda una copia que no se actualiza si el club cambia su logo).
// El nombre queda el del torneo: ese lo controla el organizador.
export async function listTeams(eid) {
  const snap = await getDocs(teamsCol(eid));
  const teams = list(snap);
  await Promise.all(teams.filter((t) => t.squadId).map(async (t) => {
    const sq = await squadInfo(t.squadId);
    if (!sq) return;
    if (sq.logo) t.logo = sq.logo;
    if (sq.color) t.color = sq.color;
    if (sq.city) t.city = sq.city;
  }));
  return teams.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export async function saveTeam(eid, team) {
  const id = team.id || randomId("tm");
  const { id: _omit, ...data } = team;
  await setDoc(doc(teamsCol(eid), id), { ...data, updatedAt: serverTimestamp() }, { merge: true });
  return id;
}

export async function deleteTeam(eid, tid) {
  await deleteDoc(doc(teamsCol(eid), tid));
}

/* =========================
   Inscripciones de equipos
========================= */
// La inscripción toma nombre, logo y jugadores del equipo (squad) y queda como copia para el torneo.
// Una vez aprobada, nombre, color y división son del organizador.
const REG_FIELDS = ["name", "city", "color", "logo", "divisionId", "players", "captainId", "spiritCaptainId", "contact", "squadId"];
const REG_LOCKED_WHEN_APPROVED = ["name", "color", "divisionId", "squadId"];
// Lo que se copia al equipo del torneo (público: sin contacto ni correo)
const TEAM_FIELDS = ["name", "city", "color", "logo", "divisionId", "players", "captainId", "spiritCaptainId", "squadId"];
const TEAM_MANAGER_FIELDS = ["city", "logo", "players", "captainId", "spiritCaptainId"];
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
const squadTournamentRef = (sid, eid) => doc(db, COL.squads, sid, "tournaments", eid);

export async function listRegistrations(eid) {
  const snap = await getDocs(regsCol(eid));
  return list(snap).sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
}

export async function loadRegistration(eid, rid) {
  const snap = await getDoc(doc(regsCol(eid), rid));
  return snap.exists() ? { id: snap.id, eventId: eid, ...snap.data() } : null;
}

/**
 * Crea o actualiza la inscripción. Si ya está aprobada, también actualiza el equipo del torneo.
 * Deja un puntero en squads/{id}/tournaments/{eventId} para el historial del equipo y sus jugadores.
 * @returns {Promise<string>} id de la inscripción
 */
export async function saveRegistration(user, event, reg) {
  const eid = event.id;
  const approved = reg.status === REG.APPROVED;
  // roster cerrado: la inscripción ya hecha no toca los jugadores (solo contacto, capitanes, etc.)
  const lockPlayers = !!reg.id && rosterLocked(event);
  const fields = pick(reg, (approved ? REG_FIELDS.filter((k) => !REG_LOCKED_WHEN_APPROVED.includes(k)) : REG_FIELDS).filter((k) => !(lockPlayers && k === "players")));
  let id = reg.id;
  if (!id) {
    id = randomId("rg");
    await setDoc(doc(regsCol(eid), id), {
      ...fields,
      eventId: eid,
      eventName: event.name || "",
      managerUid: user.uid,
      managerEmail: (user.email || "").toLowerCase(),
      managerName: user.displayName || "",
      status: REG.PENDING,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else {
    // rechazada: al corregirla vuelve a quedar pendiente
    const resubmit = reg.status === REG.REJECTED ? { status: REG.PENDING } : {};
    await setDoc(doc(regsCol(eid), id), { ...fields, ...resubmit, eventName: event.name || "", updatedAt: serverTimestamp() }, { merge: true });
    if (approved && reg.teamId) {
      await setDoc(doc(teamsCol(eid), reg.teamId), { ...pick(reg, TEAM_MANAGER_FIELDS.filter((k) => !(lockPlayers && k === "players"))), updatedAt: serverTimestamp() }, { merge: true });
    }
  }
  const sid = reg.squadId;
  if (sid) {
    await setDoc(squadTournamentRef(sid, eid), {
      eventId: eid,
      regId: id,
      eventName: event.name || "",
      eventSlug: event.slug || "",
      startDate: event.startDate || "",
      endDate: event.endDate || "",
      updatedAt: serverTimestamp(),
    });
  }
  return id;
}

export async function withdrawRegistration(eid, rid, sid) {
  await deleteDoc(doc(regsCol(eid), rid));
  if (sid) await deleteDoc(squadTournamentRef(sid, eid)).catch(() => {});
}

// Organizador: aprobar crea (o actualiza) el equipo del torneo con los datos de la inscripción
export async function approveRegistration(eid, reg) {
  const teamId = await saveTeam(eid, {
    id: reg.teamId || undefined,
    ...pick(reg, TEAM_FIELDS),
    managerUid: reg.managerUid,
    registrationId: reg.id,
  });
  await setDoc(doc(regsCol(eid), reg.id), { status: REG.APPROVED, teamId, note: "", decidedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
  return teamId;
}

export async function rejectRegistration(eid, rid, note = "") {
  await setDoc(doc(regsCol(eid), rid), { status: REG.REJECTED, note: String(note).slice(0, 500), decidedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
}

/* =========================
   Partidos
========================= */
// (en llaves, un equipo todavía desconocido se guarda vacío: resolveGames lo completa)
const teamRef = (t) => (t && t.id ? { id: t.id, name: t.name || "", color: t.color || "" } : { id: "", name: "" });

// Los partidos de llave (eliminación, playoffs) se devuelven con sus equipos ya resueltos (ver brackets.js)
export async function listGames(eid) {
  const snap = await getDocs(gamesCol(eid));
  return resolveGames(list(snap)).sort((a, b) => toMillis(a.startAt) - toMillis(b.startAt) || String(a.field || "").localeCompare(String(b.field || "")));
}

export function subscribeGames(eid, cb) {
  return onSnapshot(gamesCol(eid), (snap) => cb(resolveGames(list(snap)).sort((a, b) => toMillis(a.startAt) - toMillis(b.startAt))));
}

export function subscribeGame(eid, gid, cb) {
  return onSnapshot(doc(gamesCol(eid), gid), (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null));
}

export async function createGames(eid, games) {
  for (let i = 0; i < games.length; i += 400) {
    const batch = writeBatch(db);
    games.slice(i, i + 400).forEach((g) => {
      batch.set(doc(gamesCol(eid), randomId("gm")), {
        divisionId: g.divisionId || "",
        phase: g.phase || "",
        pool: g.pool || "",
        round: g.round || null,
        // llaves: de dónde sale cada equipo (se llena solo al terminar los partidos anteriores)
        key: g.key || "",
        slotA: g.slotA || null,
        slotB: g.slotB || null,
        field: g.field || "",
        startAt: g.startAt || null,
        teamA: teamRef(g.teamA),
        teamB: teamRef(g.teamB),
        status: GAME_STATUS.SCHEDULED,
        scoreA: 0,
        scoreB: 0,
        createdAt: serverTimestamp(),
      });
    });
    await batch.commit();
  }
}

export async function updateGame(eid, gid, patch) {
  await setDoc(doc(gamesCol(eid), gid), { ...patch, updatedAt: serverTimestamp() }, { merge: true });
}

// Evaluación de espíritu de un equipo (A = lo que A le da a B). Solo toca su lado: no pisa la del rival.
export async function saveTeamSpirit(eid, gid, side, card) {
  await updateDoc(doc(gamesCol(eid), gid), { [`spirit.${side}`]: card, updatedAt: serverTimestamp() });
}

export async function deleteGame(eid, gid) {
  await deleteDoc(doc(gamesCol(eid), gid));
}

// Partido sin datos: nunca empezó ni tiene marcador
export const isUnplayed = (g) => g.status === GAME_STATUS.SCHEDULED && !g.startedAt && !(g.scoreA || 0) && !(g.scoreB || 0);

// Borra los partidos sin jugar (y sus links de planillero) para regenerar el calendario
export async function deleteUnplayedGames(eid, games, keysByGame = new Map()) {
  const doomed = games.filter(isUnplayed);
  for (let i = 0; i < doomed.length; i += 200) {
    const batch = writeBatch(db);
    doomed.slice(i, i + 200).forEach((g) => {
      batch.delete(doc(gamesCol(eid), g.id));
      const token = keysByGame.get(g.id);
      if (token) batch.delete(doc(db, COL.gameKeys, token));
    });
    await batch.commit();
  }
  return doomed.length;
}

/* =========================
   Jugadas
========================= */
export function subscribePlays(eid, gid, cb) {
  return onSnapshot(playsCol(eid, gid), (snap) => cb(list(snap)));
}

// id propio: funciona sin señal (Firestore envía cuando vuelve)
export function addPlay(eid, gid, play) {
  const id = play.id || `${Date.now().toString(36)}${randomId().slice(0, 6)}`;
  const { id: _omit, ...data } = play;
  setDoc(doc(playsCol(eid, gid), id), { ...data, createdAt: serverTimestamp() }).catch((err) => console.warn("[torneos] jugada:", err?.code || err));
  return id;
}

export function updatePlay(eid, gid, id, patch) {
  return setDoc(doc(playsCol(eid, gid), id), { ...patch, updatedAt: serverTimestamp() }, { merge: true }).catch((err) => console.warn("[torneos] jugada:", err?.code || err));
}

/* =========================
   Links de planillero
========================= */
export async function listGameKeys(eid) {
  return list(await getDocs(query(collection(db, COL.gameKeys), where("eventId", "==", eid))));
}

export async function createGameKey(eid, gid) {
  const token = randomId("k") + randomId();
  await setDoc(doc(db, COL.gameKeys, token), { eventId: eid, gameId: gid, createdAt: serverTimestamp() });
  return token;
}

export function scorekeeperUrl(eid, gid, token) {
  return `${location.origin}/tournaments/score.html?${new URLSearchParams({ event: eid, game: gid, key: token })}`;
}

// Espera a que Firebase restaure la sesión guardada (al cargar la página auth.currentUser es null un instante).
function authReady() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (u) => {
      unsub();
      resolve(u || null);
    });
  });
}

export async function claimScorekeeper(eid, gid, token) {
  // Solo si de verdad no hay nadie: un login anónimo reemplaza la sesión de Google en todo el sitio.
  if (!(await authReady())) await signInAnonymously(auth);
  const uid = auth.currentUser.uid;
  const ref = doc(db, COL.gameClaims, `${gid}_${uid}`);
  // si ya abrió este link antes (recargó la página), el permiso ya existe: las reglas no dejan reescribirlo
  const existing = await getDoc(ref).catch(() => null);
  if (existing?.exists()) return uid;
  await setDoc(ref, { eventId: eid, gameId: gid, token, uid, createdAt: serverTimestamp() });
  return uid;
}

/* =========================
   Hat: jugadores que se inscriben solos
========================= */
// events/{e}/hat_players/{uid}__{divisionId}  pool (público, sin puntajes)
// events/{e}/hat_ratings/{uid}                autoevaluación y puntajes (solo el organizador lo lee)
// events/{e}/hat_payments/{uid}__{divisionId} comprobante de la cuota (jugador + organizador)
// profiles/{uid}/private/info                 fecha de nacimiento (solo el jugador)
const hatPlayersCol = (eid) => collection(db, COL.events, eid, "hat_players");
const hatPaymentsCol = (eid) => collection(db, COL.events, eid, "hat_payments");
const hatRatingRef = (eid, uid) => doc(db, COL.events, eid, "hat_ratings", uid);
const privateInfoRef = (uid) => doc(db, COL.profiles, uid, "private", "info");
const hatEntryId = (uid, divisionId) => `${uid}__${divisionId}`;

export async function listHatPlayers(eid) {
  return list(await getDocs(hatPlayersCol(eid)));
}

export async function listMyHatEntries(eid, uid) {
  if (!uid) return [];
  return list(await getDocs(query(hatPlayersCol(eid), where("uid", "==", uid))));
}

export async function loadMyBirthDate(uid) {
  const snap = await getDoc(privateInfoRef(uid)).catch(() => null);
  return snap?.exists() ? snap.data().birthDate || "" : "";
}

export async function loadMyHatPayment(eid, entryId) {
  const snap = await getDoc(doc(hatPaymentsCol(eid), entryId)).catch(() => null);
  return snap?.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Inscribe (o actualiza) al jugador en el hat de una división, en un solo batch:
 * ficha del pool, autoevaluación privada (si respondió), fecha de nacimiento privada, comprobante y el torneo en su perfil.
 * Si cambió de división, borra la ficha anterior (la pareja se pierde: el organizador ve el aviso).
 * @param {{ entry: object, prevDivisionId?: string, status?: string, rating?: { answers, selfScore }|null, birthDate: string, proof?: string }} data
 * @returns {Promise<string>} id de la ficha
 */
export async function saveHatEntry(user, event, { entry, prevDivisionId = "", status = "waiting", rating = null, birthDate = "", proof = "" }) {
  const eid = event.id;
  const id = hatEntryId(user.uid, entry.divisionId);
  const ref = doc(hatPlayersCol(eid), id);
  const exists = (await getDoc(ref).catch(() => null))?.exists();
  const batch = writeBatch(db);
  if (prevDivisionId && prevDivisionId !== entry.divisionId) batch.delete(doc(hatPlayersCol(eid), hatEntryId(user.uid, prevDivisionId)));
  const fields = {
    name: entry.name || "",
    number: entry.number ?? null,
    gender: entry.gender || "",
    photoURL: entry.photoURL || "",
    jersey: { size: entry.jersey?.size || "", cut: entry.jersey?.cut || "" },
    position: entry.position || "",
    teammateUid: entry.teammateUid || "",
    ...(proof ? { paymentStatus: PAYMENT.SUBMITTED } : {}),
    updatedAt: serverTimestamp(),
  };
  if (exists) batch.set(ref, fields, { merge: true });
  else batch.set(ref, { ...fields, uid: user.uid, divisionId: entry.divisionId, status, teamId: "", paymentStatus: proof ? PAYMENT.SUBMITTED : PAYMENT.NONE, createdAt: serverTimestamp() });
  if (rating) batch.set(hatRatingRef(eid, user.uid), { uid: user.uid, answers: rating.answers, selfScore: rating.selfScore, birthDate, updatedAt: serverTimestamp() }, { merge: true });
  if (birthDate) batch.set(privateInfoRef(user.uid), { birthDate, updatedAt: serverTimestamp() }, { merge: true });
  if (proof) batch.set(doc(hatPaymentsCol(eid), id), { uid: user.uid, divisionId: entry.divisionId, proof, status: PAYMENT.SUBMITTED, at: serverTimestamp() });
  batch.set(doc(db, COL.profiles, user.uid), { hatEventIds: arrayUnion(eid), updatedAt: serverTimestamp() }, { merge: true });
  await batch.commit();
  return id;
}

// La fecha de nacimiento cambió sin volver a responder: el organizador la ve igual (para la edad)
export async function updateHatBirthDate(eid, uid, birthDate) {
  await setDoc(hatRatingRef(eid, uid), { birthDate, updatedAt: serverTimestamp() }, { merge: true });
}

// Comprobante subido después de inscribirse (también con inscripciones cerradas o ya con equipo)
export async function submitHatPayment(eid, entry, proof) {
  const batch = writeBatch(db);
  batch.set(doc(hatPaymentsCol(eid), entry.id), { uid: entry.uid, divisionId: entry.divisionId, proof, status: PAYMENT.SUBMITTED, at: serverTimestamp() });
  batch.update(doc(hatPlayersCol(eid), entry.id), { paymentStatus: PAYMENT.SUBMITTED, updatedAt: serverTimestamp() });
  await batch.commit();
}

export async function leaveHat(eid, entryId) {
  await deleteDoc(doc(hatPlayersCol(eid), entryId));
}

/* ----- Hat: organizador ----- */
export async function listHatRatings(eid) {
  return list(await getDocs(collection(db, COL.events, eid, "hat_ratings")));
}

export async function listHatPayments(eid) {
  return list(await getDocs(hatPaymentsCol(eid)));
}

// Puntaje del organizador (mismo rango 0–100 que el propio); null lo borra y vuelve a contar el propio
export async function setHatOrganizerScore(eid, uid, score) {
  await setDoc(hatRatingRef(eid, uid), { organizerScore: score, organizerAt: serverTimestamp(), organizerBy: auth.currentUser?.uid || null }, { merge: true });
}

export async function setHatNotes(eid, uid, notes) {
  await setDoc(hatRatingRef(eid, uid), { notes: String(notes || "").slice(0, 500) }, { merge: true });
}

export async function decideHatPayment(eid, entry, approved, note = "") {
  const status = approved ? PAYMENT.APPROVED : PAYMENT.REJECTED;
  const batch = writeBatch(db);
  batch.set(doc(hatPaymentsCol(eid), entry.id), { status, note, decidedAt: serverTimestamp(), decidedBy: auth.currentUser?.uid || null }, { merge: true });
  batch.update(doc(hatPlayersCol(eid), entry.id), { paymentStatus: status, updatedAt: serverTimestamp() });
  await batch.commit();
}

// Pagado en efectivo u otro medio: el organizador lo marca sin comprobante
export async function setHatPaymentStatus(eid, entry, status) {
  await updateDoc(doc(hatPlayersCol(eid), entry.id), { paymentStatus: status, updatedAt: serverTimestamp() });
}

export async function setHatStatus(eid, entryId, status) {
  await updateDoc(doc(hatPlayersCol(eid), entryId), { status, updatedAt: serverTimestamp() });
}

// Organizador: pasa al jugador a otra división (la ficha cambia de id; el comprobante la sigue).
// Si ya tenía equipo, vuelve a quedar en espera; la pareja deja de contar (queda el aviso en el pool).
export async function moveHatDivision(eid, entry, divisionId) {
  if (!divisionId || divisionId === entry.divisionId) return;
  const newId = hatEntryId(entry.uid, divisionId);
  const { id: _omit, ...data } = entry;
  const batch = writeBatch(db);
  batch.set(doc(hatPlayersCol(eid), newId), { ...data, divisionId, status: "waiting", teamId: "", movedFrom: entry.divisionId, updatedAt: serverTimestamp() });
  batch.delete(doc(hatPlayersCol(eid), entry.id));
  const pay = await getDoc(doc(hatPaymentsCol(eid), entry.id)).catch(() => null);
  if (pay?.exists()) {
    batch.set(doc(hatPaymentsCol(eid), newId), { ...pay.data(), divisionId });
    batch.delete(doc(hatPaymentsCol(eid), entry.id));
  }
  await batch.commit();
}

/* ----- Hat: armado y publicación de equipos ----- */
// events/{e}/hat_drafts/{divisionId}: { seed, teams: [{ key, name, color, uids }], teamIds: { key: teamId }, publishedAt, changedAt }
const hatDraftRef = (eid, divId) => doc(db, COL.events, eid, "hat_drafts", divId);

export async function loadHatDraft(eid, divId) {
  const snap = await getDoc(hatDraftRef(eid, divId));
  return snap.exists() ? snap.data() : null;
}

export async function saveHatDraft(eid, divId, draft) {
  await setDoc(hatDraftRef(eid, divId), { ...draft, changedAt: serverTimestamp() });
}

/**
 * Publica los equipos de UNA división: crea o actualiza sus equipos del torneo (sin squadId ni inscripción:
 * existen solo en este torneo) con el roster normal { id: uid, uid, name, number, gender }, borra los que ya no están
 * y marca a cada jugador del pool como asignado (o de vuelta en espera si quedó sin equipo). Los puntajes no se copian.
 * @param {object[]} entries fichas del pool de esa división
 * @param {string[]} removeTeamIds equipos publicados antes que ya no existen en el borrador (sin partidos)
 */
export async function publishHatDivision(eid, divisionId, draft, entries, removeTeamIds = []) {
  const byUid = new Map(entries.map((p) => [p.uid, p]));
  const teamIds = {};
  const assigned = new Map();
  const batch = writeBatch(db);
  draft.teams.forEach((t) => {
    const id = draft.teamIds?.[t.key] || randomId("tm");
    teamIds[t.key] = id;
    const players = t.uids.map((u) => byUid.get(u)).filter(Boolean)
      .map((p) => ({ id: p.uid, uid: p.uid, name: p.name || "", number: p.number ?? null, gender: p.gender || "" }));
    players.forEach((p) => assigned.set(p.uid, id));
    batch.set(doc(teamsCol(eid), id), { name: t.name || "", color: t.color || "", divisionId, players, hat: true, updatedAt: serverTimestamp() }, { merge: true });
  });
  removeTeamIds.forEach((id) => batch.delete(doc(teamsCol(eid), id)));
  entries.forEach((p) => {
    const tid = assigned.get(p.uid);
    if (tid && (p.status !== "assigned" || p.teamId !== tid)) batch.update(doc(hatPlayersCol(eid), p.id), { status: "assigned", teamId: tid, updatedAt: serverTimestamp() });
    if (!tid && p.status === "assigned") batch.update(doc(hatPlayersCol(eid), p.id), { status: "waiting", teamId: "", updatedAt: serverTimestamp() });
  });
  batch.set(hatDraftRef(eid, divisionId), { ...draft, teamIds, publishedAt: serverTimestamp(), changedAt: serverTimestamp() });
  await batch.commit();
  return teamIds;
}
