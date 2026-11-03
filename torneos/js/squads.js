// /torneos/js/squads.js
// Equipos permanentes (como un club): dueños/co-admins, roster con jugadores que se unen por link,
// perfiles de jugador e historial de estadísticas en todos los torneos.
//   squads/{sid}                          nombre, logo, color, ownerUids, capitanes por defecto
//   squads/{sid}/members/{id}             roster: id = uid si el jugador tiene cuenta, si no lo cargó un admin
//   squads/{sid}/private/invites          tokens vigentes { player, admin } (solo admins)
//   squads/{sid}/tournaments/{eventId}    torneos donde se inscribió (puntero a la inscripción)
//   squad_invites/{token}                 { squadId, role } — quien tiene el link puede unirse
//   profiles/{uid}                        perfil del jugador: foto, número, F/M, equipos (squadIds)
import { db, COL } from "/torneos/js/firebase.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { GAME_STATUS, randomId } from "/torneos/js/model.js";
import { listGames, listTeams, loadEvent, loadRegistration } from "/torneos/js/services.js";

export const INVITE_ROLE = { PLAYER: "player", ADMIN: "admin" };

const list = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
const squadRef = (sid) => doc(db, COL.squads, sid);
const membersCol = (sid) => collection(db, COL.squads, sid, "members");
const invitesRef = (sid) => doc(db, COL.squads, sid, "private", "invites");
const profileRef = (uid) => doc(db, COL.profiles, uid);

export const isSquadAdmin = (squad, uid) => !!uid && (squad?.ownerUids || []).includes(uid);
export const joinUrl = (token) => `${location.origin}/torneos/unirme.html?t=${encodeURIComponent(token)}`;
export const squadUrl = (sid) => `/torneos/club.html?s=${encodeURIComponent(sid)}`;
export const profileUrl = (uid) => `/torneos/perfil.html?u=${encodeURIComponent(uid)}`;

/* =========================
   Perfiles
========================= */
export async function loadProfile(uid) {
  if (!uid) return null;
  const snap = await getDoc(profileRef(uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Perfil mínimo con los datos de Google si todavía no existe
export async function ensureProfile(user) {
  const cur = await loadProfile(user.uid);
  if (cur) return cur;
  const data = { name: user.displayName || "", photoURL: user.photoURL || "", number: null, gender: "", squadIds: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  await setDoc(profileRef(user.uid), data);
  return { id: user.uid, ...data };
}

// Guarda el perfil y copia nombre/foto/número/F-M a su ficha en cada equipo donde juega
export async function saveProfile(user, data) {
  const prof = await ensureProfile(user);
  const patch = { name: data.name, photoURL: data.photoURL || "", number: data.number ?? null, gender: data.gender || "", updatedAt: serverTimestamp() };
  await setDoc(profileRef(user.uid), patch, { merge: true });
  await Promise.all((prof.squadIds || []).map(async (sid) => {
    const m = await getDoc(doc(membersCol(sid), user.uid)).catch(() => null);
    if (!m?.exists()) return;
    await setDoc(doc(membersCol(sid), user.uid), { name: patch.name, photoURL: patch.photoURL, number: patch.number, gender: patch.gender, updatedAt: serverTimestamp() }, { merge: true });
  }));
}

async function addSquadToProfile(user, sid) {
  const prof = await ensureProfile(user);
  const ids = prof.squadIds || [];
  if (!ids.includes(sid)) await setDoc(profileRef(user.uid), { squadIds: [...ids, sid], updatedAt: serverTimestamp() }, { merge: true });
}

/* =========================
   Equipos
========================= */
export async function loadSquad(sid) {
  const snap = await getDoc(squadRef(sid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Equipos que administro + equipos donde juego
export async function listMySquads(user) {
  if (!user) return [];
  const [owned, prof] = await Promise.all([
    getDocs(query(collection(db, COL.squads), where("ownerUids", "array-contains", user.uid))).then(list).catch(() => []),
    loadProfile(user.uid).catch(() => null),
  ]);
  const map = new Map(owned.map((s) => [s.id, s]));
  const extra = await Promise.all((prof?.squadIds || []).filter((id) => !map.has(id)).map((id) => loadSquad(id).catch(() => null)));
  extra.filter(Boolean).forEach((s) => map.set(s.id, s));
  return [...map.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export async function createSquad(user, data) {
  const id = randomId("sq");
  await setDoc(squadRef(id), {
    name: data.name,
    city: data.city || "",
    color: data.color || "#19473f",
    logo: data.logo || "",
    ownerUids: [user.uid],
    createdBy: user.uid,
    captainId: "",
    spiritCaptainId: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await ensureProfile(user);
  await getInvites(id, user);
  return id;
}

export async function saveSquad(sid, data) {
  const { id: _id, ownerUids: _o, ...safe } = data;
  await setDoc(squadRef(sid), { ...safe, updatedAt: serverTimestamp() }, { merge: true });
}

// Co-admins: los admins pueden quitar a otros (siempre queda al menos uno)
export async function setOwners(sid, ownerUids) {
  if (!ownerUids.length) throw new Error("need-owner");
  await setDoc(squadRef(sid), { ownerUids, updatedAt: serverTimestamp() }, { merge: true });
}

/* =========================
   Roster
========================= */
export async function listMembers(sid) {
  const snap = await getDocs(membersCol(sid));
  return list(snap).sort((a, b) => (a.number ?? 999) - (b.number ?? 999) || String(a.name).localeCompare(String(b.name)));
}

// Admin: agrega o edita un jugador (sin cuenta, o corrige datos)
export async function saveMember(sid, member) {
  const id = member.id || randomId("p");
  const { id: _id, ...data } = member;
  await setDoc(doc(membersCol(sid), id), { uid: null, photoURL: "", ...data, updatedAt: serverTimestamp() }, { merge: true });
  return id;
}

export async function deleteMember(sid, mid) {
  await deleteDoc(doc(membersCol(sid), mid));
}

/* =========================
   Invitaciones por link
========================= */
const newToken = () => `${randomId("i")}${randomId("")}`.replace(/[^a-z0-9]/gi, "");

// Tokens vigentes del equipo; si faltan, se crean
export async function getInvites(sid, user) {
  const snap = await getDoc(invitesRef(sid));
  const cur = snap.exists() ? snap.data() : {};
  const next = { ...cur };
  for (const role of [INVITE_ROLE.PLAYER, INVITE_ROLE.ADMIN]) {
    if (next[role]) continue;
    next[role] = newToken();
    await setDoc(doc(db, COL.squadInvites, next[role]), { squadId: sid, role, createdBy: user.uid, createdAt: serverTimestamp() });
  }
  if (!snap.exists() || next.player !== cur.player || next.admin !== cur.admin) await setDoc(invitesRef(sid), next);
  return next;
}

// Link nuevo: el anterior deja de servir
export async function regenerateInvite(sid, role, user) {
  const snap = await getDoc(invitesRef(sid));
  const cur = snap.exists() ? snap.data() : {};
  if (cur[role]) await deleteDoc(doc(db, COL.squadInvites, cur[role])).catch(() => {});
  await setDoc(invitesRef(sid), { ...cur, [role]: "" });
  return getInvites(sid, user);
}

export async function loadInvite(token) {
  if (!token) return null;
  const snap = await getDoc(doc(db, COL.squadInvites, token));
  return snap.exists() ? { token, ...snap.data() } : null;
}

/**
 * Unirse con un link. Jugador: crea su ficha en el roster (id = uid).
 * Co-admin: se agrega a ownerUids; con asPlayer también entra al roster.
 */
export async function joinSquad(user, invite, profile, { asPlayer = true } = {}) {
  const sid = invite.squadId;
  const squad = await loadSquad(sid);
  if (!squad) throw new Error("squad-not-found");
  if (invite.role === INVITE_ROLE.ADMIN && !isSquadAdmin(squad, user.uid)) {
    await setDoc(squadRef(sid), { ownerUids: [...(squad.ownerUids || []), user.uid], joinToken: invite.token, updatedAt: serverTimestamp() }, { merge: true });
  }
  if (invite.role === INVITE_ROLE.PLAYER || asPlayer) {
    await setDoc(doc(membersCol(sid), user.uid), {
      uid: user.uid,
      name: profile.name,
      number: profile.number ?? null,
      gender: profile.gender || "",
      photoURL: profile.photoURL || "",
      joinToken: invite.token,
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  await saveProfile(user, profile);
  await addSquadToProfile(user, sid);
  return sid;
}

export async function leaveSquad(user, squad) {
  await deleteMember(squad.id, user.uid).catch(() => {});
  if (isSquadAdmin(squad, user.uid) && squad.ownerUids.length > 1) {
    await setOwners(squad.id, squad.ownerUids.filter((u) => u !== user.uid));
  }
}

/* =========================
   Torneos e historial
========================= */
/**
 * Inscripciones de mis equipos (los que administro) en un torneo.
 * La lista trae además freeSquads: cuántos de mis equipos todavía no están inscritos.
 * @returns {Promise<{ squad: object, reg: object }[] & { freeSquads: number }>}
 */
export async function myRegistrationsFor(user, eventId) {
  if (!user || !eventId) return Object.assign([], { freeSquads: 0 });
  const squads = (await listMySquads(user)).filter((s) => isSquadAdmin(s, user.uid));
  const found = (await Promise.all(squads.map(async (squad) => {
    const ptr = await getDoc(doc(db, COL.squads, squad.id, "tournaments", eventId)).catch(() => null);
    if (!ptr?.exists()) return null;
    const reg = await loadRegistration(eventId, ptr.data().regId).catch(() => null);
    return reg ? { squad, reg } : null;
  }))).filter(Boolean);
  return Object.assign(found, { freeSquads: squads.length - found.length });
}

export async function listSquadTournaments(sid) {
  const snap = await getDocs(collection(db, COL.squads, sid, "tournaments"));
  return list(snap).sort((a, b) => String(b.startDate || "").localeCompare(String(a.startDate || "")));
}

const sumStats = (rows) => rows.reduce((t, r) => {
  ["goals", "assists", "blocks", "turns", "callahans", "games"].forEach((k) => (t[k] = (t[k] || 0) + (r[k] || 0)));
  return t;
}, { goals: 0, assists: 0, blocks: 0, turns: 0, callahans: 0, games: 0 });

/**
 * Historial del jugador: en cada torneo de sus equipos busca el equipo del torneo donde está su uid
 * y suma sus estadísticas en los partidos jugados.
 * @returns {Promise<{ rows: object[], totals: object }>}
 */
export async function playerHistory(uid, squadIds = []) {
  const pointers = (await Promise.all(squadIds.map((sid) => listSquadTournaments(sid).catch(() => [])))).flat();
  const eventIds = [...new Set(pointers.map((p) => p.eventId))];
  const rows = (await Promise.all(eventIds.map(async (eid) => {
    const [event, teams] = await Promise.all([loadEvent(eid).catch(() => null), listTeams(eid).catch(() => [])]);
    const team = teams.find((t) => (t.players || []).some((p) => p.id === uid));
    if (!event || !team) return null;
    const games = (await listGames(eid).catch(() => []))
      .filter((g) => g.status !== GAME_STATUS.SCHEDULED && (g.teamA?.id === team.id || g.teamB?.id === team.id));
    const st = games.reduce((t, g) => {
      const p = g.playerStats?.[uid] || {};
      ["goals", "assists", "blocks", "turns", "callahans"].forEach((k) => (t[k] += p[k] || 0));
      return t;
    }, { goals: 0, assists: 0, blocks: 0, turns: 0, callahans: 0 });
    const gameRows = games
      .sort((a, b) => (a.startAt?.toMillis?.() || 0) - (b.startAt?.toMillis?.() || 0))
      .map((g) => ({ game: g, side: g.teamA?.id === team.id ? "A" : "B", stats: g.playerStats?.[uid] || {} }));
    return { event, team, ...st, games: games.length, gameRows };
  }))).filter(Boolean).sort((a, b) => String(b.event.startDate || "").localeCompare(String(a.event.startDate || "")));
  return { rows, totals: { ...sumStats(rows), tournaments: rows.length } };
}
