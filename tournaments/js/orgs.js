// /tournaments/js/orgs.js
// Organizaciones: una asociación, liga, club o persona que organiza torneos y (con permiso) pickups.
//   orgs/{id}                    nombre, tipo, logo, color, país, ownerUids, features.pickups, pickupSettings
//   orgs/{id}/private/invites    { admin: token } (solo admins)
//   org_invites/{token}          { orgId, role: "admin" } — con el link alguien se suma como admin
// El permiso de pickups (features.pickups) solo lo cambia el admin de la plataforma.
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
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { randomId } from "/tournaments/js/model.js";
import { defaultPickupSettings, slugify } from "/tournaments/js/pickups.js";

export const ORG_KINDS = ["association", "league", "club", "person"];

const list = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
const orgRef = (id) => doc(db, COL.orgs, id);
const invitesRef = (id) => doc(db, COL.orgs, id, "private", "invites");

export const isOrgAdmin = (org, uid) => !!uid && (org?.ownerUids || []).includes(uid);
export const orgHasPickups = (org) => org?.features?.pickups === true;
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
