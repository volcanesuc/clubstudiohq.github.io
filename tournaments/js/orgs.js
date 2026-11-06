// /tournaments/js/orgs.js
// Organizaciones: una asociación, liga, club o persona que organiza torneos y (con permiso) pickups.
//   orgs/{id}                    nombre, tipo, logo, color, país, ownerUids, features.pickups, pickupSettings
//   orgs/{id}/private/invites    { admin: token } (solo admins)
//   org_invites/{token}          { orgId, role: "admin" } — con el link alguien se suma como admin
// El permiso de pickups (features.pickups + features.pickupsUntil) solo lo cambia el admin de la plataforma.
// pendingEmails: correos invitados como admin; al entrar con esa cuenta de Google la organización pasa a ser suya.
import { db, COL } from "/tournaments/js/firebase.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { randomId } from "/tournaments/js/model.js";
import { defaultPickupSettings, pickupMs, slugify } from "/tournaments/js/pickups.js";

export const ORG_KINDS = ["association", "league", "club", "person"];

const list = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
const orgRef = (id) => doc(db, COL.orgs, id);
const invitesRef = (id) => doc(db, COL.orgs, id, "private", "invites");

export const isOrgAdmin = (org, uid) => !!uid && (org?.ownerUids || []).includes(uid);
export const DAY_MS = 86400000;
export const SOON_DAYS = 7;
const normEmail = (e) => String(e || "").trim().toLowerCase();
export const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail(e));

/** Estado del permiso: off | on | soon (vence en ≤ 7 días) | expired. until = ms (0 = sin vencimiento) */
export function pickupAccess(org, now = Date.now()) {
  const f = org?.features || {};
  const until = f.pickupsUntil ? pickupMs(f.pickupsUntil) : 0;
  if (f.pickups !== true) return { state: "off", until, days: null };
  if (until && now >= until) return { state: "expired", until, days: 0 };
  // días de calendario hasta el día del vencimiento (vence el 9 y hoy es 6 → 3)
  const dayStart = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const days = until ? Math.round((dayStart(until) - dayStart(now)) / DAY_MS) : null;
  return { state: until && days <= SOON_DAYS ? "soon" : "on", until, days };
}
export const orgHasPickups = (org, now) => ["on", "soon"].includes(pickupAccess(org, now).state);

// Fecha de un <input type="date"> → fin de ese día (hora local)
export function endOfDay(value) {
  const [y, m, d] = String(value || "").split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d, 23, 59, 59).getTime() : 0;
}
export function addMonths(ms, n = 1) {
  const d = new Date(ms || Date.now());
  d.setMonth(d.getMonth() + n);
  d.setHours(23, 59, 59, 0);
  return d.getTime();
}
export const orgJoinUrl = (token) => `${location.origin}/pickups/organize.html?join=${encodeURIComponent(token)}`;

function newToken() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function loadOrg(id) {
  if (!id) return null;
  const snap = await getDoc(orgRef(id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function listMyOrgs(user) {
  if (!user) return [];
  const snap = await getDocs(query(collection(db, COL.orgs), where("ownerUids", "array-contains", user.uid)));
  return list(snap).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** Organizaciones que invitaron a mi correo: me sumo como admin. Devuelve las que reclamé. */
export async function claimPendingOrgs(user) {
  const email = normEmail(user?.email);
  if (!email || user.emailVerified === false) return [];
  const snap = await getDocs(query(collection(db, COL.orgs), where("pendingEmails", "array-contains", email))).catch(() => null);
  if (!snap) return [];
  const claimed = [];
  for (const org of list(snap)) {
    if (isOrgAdmin(org, user.uid)) continue;
    try {
      await updateDoc(orgRef(org.id), {
        ownerUids: [...(org.ownerUids || []), user.uid],
        pendingEmails: (org.pendingEmails || []).filter((e) => e !== email),
        updatedAt: serverTimestamp(),
      });
      claimed.push(org);
    } catch (err) {
      console.warn("[orgs] claim", org.id, err?.code || err);
    }
  }
  return claimed;
}

export async function listAllOrgs() {
  return list(await getDocs(collection(db, COL.orgs))).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export async function createOrg(user, data) {
  const id = randomId("org");
  await setDoc(orgRef(id), {
    name: String(data.name || "").trim(),
    slug: slugify(data.name) || id,
    kind: ORG_KINDS.includes(data.kind) ? data.kind : "association",
    city: data.city || "",
    country: data.country || "",
    color: data.color || "#6d28d9",
    logo: data.logo || "",
    contactPhone: data.contactPhone || "",
    ownerUids: [user.uid],
    createdBy: user.uid,
    ownerEmail: (user.email || "").toLowerCase(),
    pickupSettings: defaultPickupSettings(data.country),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return id;
}

// Datos de la organización (nombre, logo, ajustes de pickups…). Nunca toca ownerUids ni features.
export async function saveOrg(id, data) {
  const { ownerUids, features, createdBy, ...safe } = data;
  if (safe.name) safe.slug = slugify(safe.name) || id;
  await updateDoc(orgRef(id), { ...safe, updatedAt: serverTimestamp() });
}

export async function setOrgOwners(id, ownerUids) {
  await updateDoc(orgRef(id), { ownerUids, updatedAt: serverTimestamp() });
}

// Solo el admin de la plataforma (las reglas lo impiden para el resto)
export async function setOrgFeature(id, feature, on) {
  await updateDoc(orgRef(id), { [`features.${feature}`]: !!on, updatedAt: serverTimestamp() });
}

/** Permiso de pickups con fecha: until = ms (0 = sin vencimiento). Solo el admin de la plataforma. */
export async function setOrgPickups(id, { on, until = 0 }) {
  await updateDoc(orgRef(id), {
    "features.pickups": !!on,
    "features.pickupsUntil": until ? Timestamp.fromMillis(until) : null,
    updatedAt: serverTimestamp(),
  });
}

/** El admin de la plataforma crea la organización para un correo, con los pickups ya activados. */
export async function createOrgForEmail(admin, data) {
  const id = randomId("org");
  const email = normEmail(data.email);
  await setDoc(orgRef(id), {
    name: String(data.name || "").trim(),
    slug: slugify(data.name) || id,
    kind: ORG_KINDS.includes(data.kind) ? data.kind : "association",
    city: data.city || "",
    country: data.country || "",
    color: data.color || "#6d28d9",
    logo: "",
    contactPhone: data.contactPhone || "",
    ownerUids: [],
    pendingEmails: [email],
    createdBy: admin.uid,
    ownerEmail: email,
    features: { pickups: true, pickupsUntil: data.until ? Timestamp.fromMillis(data.until) : null },
    pickupSettings: defaultPickupSettings(data.country),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return id;
}

/** Invitar a otro correo como admin (lo usan el admin de la plataforma y los admins de la organización) */
export async function addOrgEmail(org, email) {
  const e = normEmail(email);
  const pending = [...new Set([...(org.pendingEmails || []), e])];
  await updateDoc(orgRef(org.id), { pendingEmails: pending, ...(org.ownerEmail ? {} : { ownerEmail: e }), updatedAt: serverTimestamp() });
  return pending;
}

export async function deleteOrg(id) {
  await deleteDoc(orgRef(id));
}

/* =========================
   Invitaciones de admin
========================= */
export async function getOrgInvite(id, user) {
  const snap = await getDoc(invitesRef(id));
  const cur = snap.exists() ? snap.data() : {};
  if (cur.admin) return cur.admin;
  const token = newToken();
  await setDoc(doc(db, COL.orgInvites, token), { orgId: id, role: "admin", createdBy: user.uid, createdAt: serverTimestamp() });
  await setDoc(invitesRef(id), { admin: token });
  return token;
}

export async function regenerateOrgInvite(id, user) {
  const snap = await getDoc(invitesRef(id));
  const cur = snap.exists() ? snap.data() : {};
  if (cur.admin) await deleteDoc(doc(db, COL.orgInvites, cur.admin)).catch(() => {});
  await setDoc(invitesRef(id), { admin: "" });
  return getOrgInvite(id, user);
}

export async function loadOrgInvite(token) {
  if (!token) return null;
  const snap = await getDoc(doc(db, COL.orgInvites, token));
  return snap.exists() ? { token, ...snap.data() } : null;
}

export async function joinOrg(user, invite) {
  const org = await loadOrg(invite.orgId);
  if (!org) throw new Error("org-not-found");
  if (!isOrgAdmin(org, user.uid)) {
    await updateDoc(orgRef(org.id), { ownerUids: [...(org.ownerUids || []), user.uid], joinToken: invite.token, updatedAt: serverTimestamp() });
  }
  return org.id;
}
