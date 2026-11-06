// /tournaments/js/imports.js
// Herramientas del admin de la plataforma:
//  - importar un torneo terminado desde otra plataforma (JSON "cshq-import/1", ver tools/import_ultie.py)
//  - asignar cuentas a jugadores que quedaron sin cuenta (importados o cargados a mano por el organizador)
//
// Un jugador del roster de un torneo se identifica por su id en ese torneo. Las estadísticas de los partidos
// se guardan con ese id, así que asignar una cuenta no mueve datos: pone el uid en la ficha del roster y deja
// un registro en player_claims/{eventId}__{playerId} para que el perfil de la persona encuentre el torneo.
import { auth, db, COL } from "/tournaments/js/firebase.js";
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
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { computeGameState, DEFAULT_RULES, EVENT_STATUS, eventRules, gameSummary, GAME_STATUS } from "/tournaments/js/model.js";
import { APPROVAL, listTeams, loadEvent } from "/tournaments/js/services.js";

export const IMPORT_FORMAT = "cshq-import/1";
const list = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
const claimId = (eid, pid) => `${eid}__${pid}`;

/* =========================
   Importar torneo
========================= */
export async function listBundledImports() {
  const res = await fetch("/tournaments/data/imports/index.json", { cache: "no-cache" });
  if (!res.ok) return [];
  return (await res.json()).imports || [];
}

export async function loadBundledImport(file) {
  const res = await fetch(`/tournaments/data/imports/${encodeURIComponent(file)}`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`No se pudo leer ${file}`);
  return res.json();
}

export function validateImport(data) {
  if (!data || data.format !== IMPORT_FORMAT) throw new Error(`Formato no reconocido (se espera ${IMPORT_FORMAT})`);
  if (!data.event?.id || !data.event?.name) throw new Error("Falta el torneo");
  const teamIds = new Set((data.teams || []).map((t) => t.id));
  (data.games || []).forEach((g) => {
    if (!teamIds.has(g.teamA) || !teamIds.has(g.teamB)) throw new Error(`Partido ${g.id}: equipo desconocido`);
  });
  return data;
}

// Resumen para mostrar antes de importar (marcadores calculados con la misma lógica del planillero)
export function importPreview(data) {
  const rules = eventRules({ rules: { ...DEFAULT_RULES, ...data.event.rules } });
  const games = data.games.map((g) => ({ ...g, state: computeGameState(g.plays || [], { offenseFirst: g.offenseFirst }, rules) }));
  return {
    teams: data.teams.length,
    players: data.teams.reduce((n, t) => n + (t.players || []).length, 0),
    games: games.length,
    plays: games.reduce((n, g) => n + (g.plays || []).length, 0),
    goals: games.reduce((n, g) => n + g.state.score.A + g.state.score.B, 0),
    spirit: games.reduce((n, g) => n + Object.keys(g.spirit || {}).length, 0),
  };
}

// Escribe en tandas (Firestore acepta hasta 500 operaciones por batch)
async function commitAll(ops, onProgress, label) {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    ops.slice(i, i + 400).forEach(([ref, data]) => batch.set(ref, data));
    await batch.commit();
    onProgress?.(`${label}: ${Math.min(i + 400, ops.length)}/${ops.length}`);
  }
}

const toDate = (v) => (v ? new Date(v) : null);
const clean = (obj) => JSON.parse(JSON.stringify(obj)); // sin undefined

/**
 * Crea (o actualiza, si ya se importó) el torneo con equipos, partidos y jugadas.
 * Lo deja activo, público y terminado. Si se vuelve a importar, conserva las cuentas ya asignadas.
 * Solo admins de la plataforma (las reglas lo exigen para escribir en un torneo ajeno).
 * @returns {Promise<{ eventId: string, slug: string }>}
 */
export async function importTournament(data, onProgress) {
  validateImport(data);
  const user = auth.currentUser;
  const src = data.event;
  const eid = src.id;
  const eventRef = doc(db, COL.events, eid);
  const existing = await loadEvent(eid).catch(() => null);
  const rules = { ...DEFAULT_RULES, ...(src.rules || {}) };

  // slug único: si otro torneo ya lo usa, se agrega el año / un sufijo
  let slug = src.slug;
  const taken = await getDocs(query(collection(db, COL.events), where("slug", "==", slug)));
  if (taken.docs.some((d) => d.id !== eid)) slug = `${slug}-${eid.slice(-4)}`;

  const info = {
    name: src.name,
    shortName: src.shortName || "",
    slug,
    status: EVENT_STATUS.FINISHED,
    startDate: src.startDate || "",
    endDate: src.endDate || "",
    venue: src.venue || "",
    ...(src.logo ? { logo: src.logo } : {}),
    address: src.address || "",
    description: src.description || "",
    divisions: src.divisions || [{ id: "open", name: "Open" }],
    fields: src.fields || [],
    format: src.format || "round_robin",
    rules,
    registrationOpen: false,
    // torneo hat: equipos armados por el organizador, sin club detrás
    ...(src.type === "hat" ? { type: "hat", hat: { multiDivision: false, ...(src.hat || {}) } } : {}),
    imported: { ...data.source, by: user.uid, at: new Date() },
  };

  onProgress?.("Torneo…");
  if (!existing) {
    // las reglas piden crearlo como borrador del que lo crea; después el admin lo activa
    await setDoc(eventRef, {
      ...info,
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
  }
  await setDoc(eventRef, {
    ...info,
    isPublic: true,
    ...(existing?.approval?.status === APPROVAL.APPROVED ? {} : {
      approval: { status: APPROVAL.APPROVED, plan: "import", expiresAt: null, adminNote: "Importado", decidedAt: serverTimestamp(), decidedBy: user.uid },
    }),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  // equipos: conserva cuentas y fotos ya asignadas a los jugadores
  const prevTeams = existing ? await listTeams(eid).catch(() => []) : [];
  const prevPlayers = new Map(prevTeams.flatMap((t) => (t.players || []).map((p) => [p.id, p])));
  const prevById = new Map(prevTeams.map((t) => [t.id, t]));
  const teamOps = data.teams.map((t) => {
    const { id, players = [], ...rest } = t;
    // equipo ya vinculado a un equipo permanente: conserva el vínculo y su logo/color
    const prev = prevById.get(id);
    const linked = prev?.squadId ? { squadId: prev.squadId, logo: prev.logo || rest.logo || "", color: prev.color || rest.color } : {};
    return [doc(db, COL.events, eid, "teams", id), {
      ...clean({
        ...rest,
        ...linked,
        players: players.map((p) => {
          const prev = prevPlayers.get(p.id);
          return { ...p, uid: prev?.uid || p.uid || null, ...(prev?.photoURL ? { photoURL: prev.photoURL } : {}) };
        }),
        imported: true,
      }),
      updatedAt: serverTimestamp(),
    }];
  });
  await commitAll(teamOps, onProgress, "Equipos");

  const teamRef = (id) => {
    const t = data.teams.find((x) => x.id === id);
    return { id, name: t?.name || "", color: t?.color || "" };
  };
  const evRules = eventRules({ rules });
  const gameOps = [];
  const playOps = [];
  data.games.forEach((g) => {
    const state = computeGameState(g.plays || [], { offenseFirst: g.offenseFirst }, evRules);
    const startMs = toDate(g.startAt)?.getTime() || null;
    const endMs = toDate(g.finishedAt)?.getTime() || null;
    gameOps.push([doc(db, COL.events, eid, "games", g.id), clean({
      divisionId: g.divisionId || "",
      phase: g.phase || "",
      pool: g.pool || "",
      round: g.round ?? null,
      field: g.field || "",
      teamA: teamRef(g.teamA),
      teamB: teamRef(g.teamB),
      status: g.status === GAME_STATUS.FINAL ? GAME_STATUS.FINAL : GAME_STATUS.SCHEDULED,
      offenseFirst: g.offenseFirst || "A",
      ...gameSummary(state),
      spirit: g.spirit || {},
      clock: startMs ? { startedAt: startMs, pausedMs: 0, pausedAt: null, offsetMs: 0, endedAt: endMs, break: null } : {},
      source: g.source || null,
    })]);
    // fechas como Timestamp (clean() las volvería texto)
    const last = gameOps[gameOps.length - 1][1];
    last.updatedAt = serverTimestamp();
    last.startAt = toDate(g.startAt);
    last.startedAt = toDate(g.startAt);
    last.finishedAt = toDate(g.finishedAt);
    (g.plays || []).forEach((p) => {
      const { id, ...play } = p;
      playOps.push([doc(db, COL.events, eid, "games", g.id, "plays", id), clean({ ...play, by: user.uid, byRole: "import" })]);
    });
  });
  await commitAll(gameOps, onProgress, "Partidos");
  await commitAll(playOps, onProgress, "Jugadas");
  return { eventId: eid, slug };
}

/* =========================
   Vincular un equipo del torneo con un equipo permanente (squad)
========================= */
export async function listAllSquads() {
  return list(await getDocs(collection(db, COL.squads)))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

/**
 * Une el equipo de un torneo (ej. importado) con el equipo permanente: el torneo aparece en la página
 * y el historial del equipo, y el equipo del torneo toma su logo y color.
 * No toca el roster del torneo (las estadísticas quedan con los ids del torneo).
 */
export async function linkTeamToSquad(event, team, squad) {
  await setDoc(doc(db, COL.events, event.id, "teams", team.id), {
    squadId: squad.id,
    ...(squad.logo ? { logo: squad.logo } : {}),
    ...(squad.color ? { color: squad.color } : {}),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  // puntero del historial del equipo (sin inscripción: regId vacío)
  await setDoc(doc(db, COL.squads, squad.id, "tournaments", event.id), {
    eventId: event.id,
    regId: "",
    teamId: team.id,
    eventName: event.name || "",
    eventSlug: event.slug || "",
    startDate: event.startDate || "",
    endDate: event.endDate || "",
    linkedBy: auth.currentUser?.uid || "",
    updatedAt: serverTimestamp(),
  });
}

export async function unlinkTeamFromSquad(event, team) {
  if (!team.squadId) return;
  await deleteDoc(doc(db, COL.squads, team.squadId, "tournaments", event.id)).catch(() => {});
  await setDoc(doc(db, COL.events, event.id, "teams", team.id), { squadId: "", updatedAt: serverTimestamp() }, { merge: true });
}

/* =========================
   Jugadores sin cuenta
========================= */
export async function listAllProfiles() {
  return list(await getDocs(collection(db, COL.profiles)))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

export async function listEventClaims(eid) {
  return list(await getDocs(query(collection(db, COL.playerClaims), where("eventId", "==", eid))));
}

export async function listClaimsForUser(uid) {
  if (!uid) return [];
  return list(await getDocs(query(collection(db, COL.playerClaims), where("uid", "==", uid))));
}

async function setPlayerUid(eid, teamId, playerId, uid) {
  const ref = doc(db, COL.events, eid, "teams", teamId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Equipo no encontrado");
  const players = (snap.data().players || []).map((p) => (p.id === playerId ? { ...p, uid: uid || null } : p));
  await setDoc(ref, { players, updatedAt: serverTimestamp() }, { merge: true });
}

/**
 * Admin: vuelve a poner el uid en las fichas que tienen asignación (player_claims) pero lo perdieron
 * (ej. alguien editó el roster). Devuelve cuántas fichas reparó.
 */
export async function repairEventClaims(eid, teams) {
  const claims = await listEventClaims(eid);
  let fixed = 0;
  for (const c of claims) {
    const team = teams.find((t) => t.id === c.teamId);
    const player = (team?.players || []).find((x) => x.id === c.playerId);
    if (!player || player.uid === c.uid) continue;
    if (player.uid) continue; // otra cuenta asignada a mano: no se pisa
    await setPlayerUid(eid, team.id, player.id, c.uid);
    player.uid = c.uid;
    fixed += 1;
  }
  return fixed;
}

/**
 * Admin: asigna la cuenta `profile` (profiles/{uid}) al jugador `playerId` del equipo `team` en el torneo `event`.
 * El jugador conserva su id y estadísticas; su ficha queda con uid y su perfil muestra el torneo.
 */
export async function assignPlayerAccount(event, team, player, profile) {
  const uid = profile.id;
  const dupe = (team.players || []).find((p) => p.uid === uid && p.id !== player.id);
  if (dupe) throw new Error(`Esa cuenta ya está asignada a ${dupe.name} en este equipo`);
  await setPlayerUid(event.id, team.id, player.id, uid);
  await setDoc(doc(db, COL.playerClaims, claimId(event.id, player.id)), {
    uid,
    eventId: event.id,
    teamId: team.id,
    playerId: player.id,
    playerName: player.name || "",
    profileName: profile.name || "",
    eventName: event.name || "",
    eventSlug: event.slug || "",
    startDate: event.startDate || "",
    endDate: event.endDate || "",
    assignedBy: auth.currentUser?.uid || "",
    assignedAt: serverTimestamp(),
  });
}

export async function unassignPlayerAccount(event, team, player) {
  await setPlayerUid(event.id, team.id, player.id, null);
  await deleteDoc(doc(db, COL.playerClaims, claimId(event.id, player.id))).catch(() => {});
}
