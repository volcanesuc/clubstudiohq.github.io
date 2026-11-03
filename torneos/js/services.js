// /torneos/js/services.js
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
import { auth, db, COL } from "/torneos/js/firebase.js";
import { signInAnonymously } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { GAME_STATUS, randomId } from "/torneos/js/model.js";
import { DIVISION_OPTIONS } from "/torneos/js/divisions-config.js";
import { toMillis } from "/torneos/js/ui.js";

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
    organizerEmails: [],
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
export async function listTeams(eid) {
  const snap = await getDocs(teamsCol(eid));
  return list(snap).sort((a, b) => String(a.name).localeCompare(String(b.name)));
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
  const fields = pick(reg, approved ? REG_FIELDS.filter((k) => !REG_LOCKED_WHEN_APPROVED.includes(k)) : REG_FIELDS);
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
      await setDoc(doc(teamsCol(eid), reg.teamId), { ...pick(reg, TEAM_MANAGER_FIELDS), updatedAt: serverTimestamp() }, { merge: true });
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
const teamRef = (t) => (t ? { id: t.id, name: t.name || "", color: t.color || "" } : null);

export async function listGames(eid) {
  const snap = await getDocs(gamesCol(eid));
  return list(snap).sort((a, b) => toMillis(a.startAt) - toMillis(b.startAt) || String(a.field || "").localeCompare(String(b.field || "")));
}

export function subscribeGames(eid, cb) {
  return onSnapshot(gamesCol(eid), (snap) => cb(list(snap).sort((a, b) => toMillis(a.startAt) - toMillis(b.startAt))));
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
  return `${location.origin}/torneos/planillar.html?${new URLSearchParams({ event: eid, game: gid, key: token })}`;
}

export async function claimScorekeeper(eid, gid, token) {
  if (!auth.currentUser) await signInAnonymously(auth);
  const uid = auth.currentUser.uid;
  await setDoc(doc(db, COL.gameClaims, `${gid}_${uid}`), { eventId: eid, gameId: gid, token, uid, createdAt: serverTimestamp() });
  return uid;
}
