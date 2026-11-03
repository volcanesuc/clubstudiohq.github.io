// /torneos/js/firebase.js
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { FIREBASE_CONFIG } from "/torneos/js/firebase-config.js";

const app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);

export const db = getFirestore(app);
export const auth = getAuth(app);

// Colecciones del proyecto de la plataforma
export const COL = {
  events: "events", // events/{id} + teams, games, games/{id}/plays
  gameKeys: "game_keys", // link de planillero -> { eventId, gameId }
  gameClaims: "game_claims", // sesión que reclamó un link
  platformAdmins: "platform_admins", // platform_admins/{uid}: quién aprueba torneos
};
