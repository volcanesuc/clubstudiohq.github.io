// /tournaments/js/firebase.js
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { FIREBASE_CONFIG } from "/tournaments/js/firebase-config.js";

const app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);

export const db = getFirestore(app);
export const auth = getAuth(app);

// Colecciones del proyecto de la plataforma
export const COL = {
  events: "events", // events/{id} + teams, games, games/{id}/plays
  gameKeys: "game_keys", // link de planillero -> { eventId, gameId }
  gameClaims: "game_claims", // sesión que reclamó un link
  platformAdmins: "platform_admins", // platform_admins/{uid}: quién aprueba torneos
  platformConfig: "platform_config", // platform_config/divisions: opciones de categorías y ramas
  squads: "squads", // squads/{id}: equipos permanentes (dueños, roster en members/, invitaciones, torneos)
  squadInvites: "squad_invites", // squad_invites/{token}: link para unirse a un equipo (jugador o co-admin)
  profiles: "profiles", // profiles/{uid}: perfil del jugador (foto, número, equipos)
  playerClaims: "player_claims", // player_claims/{eventId}__{playerId}: cuenta asignada por un admin a un jugador importado
  claimRequests: "claim_requests", // claim_requests/{eventId}__{playerId}__{uid}: "soy yo" pedido por el jugador
  migrationRequests: "migration_requests", // migration_requests/{id}: pedido para pasar un torneo de otra plataforma
  orgs: "orgs", // orgs/{id}: organización (asociación, liga, club o persona) que hace torneos y pickups
  orgInvites: "org_invites", // org_invites/{token}: link para sumarse como admin de una organización
  pickups: "pickups", // pickups/{id} + players/{pid} (+ private/proof)
};
