// /tournaments/js/pickups_services.js
// Firestore de pickups.
//   pickups/{id}                                  datos del juego (de una organización con permiso)
//   pickups/{id}/players/{pid}                    lista pública: nombre, tarifa, estado (pid = uid si se anotó solo)
//   pickups/{id}/players/{pid}/private/proof      comprobante (jugador o quien lo anotó + admins de la organización)
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
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { randomId } from "/tournaments/js/model.js";
import { PAY, PICKUP_STATUS, PLAYER_STATUS, leaveDeadline, pickupMs, slugify } from "/tournaments/js/pickups.js";

const list = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
const pickupRef = (id) => doc(db, COL.pickups, id);
const playersCol = (pid) => collection(db, COL.pickups, pid, "players");
const playerRef = (pid, plid) => doc(db, COL.pickups, pid, "players", plid);
const proofRef = (pid, plid) => doc(db, COL.pickups, pid, "players", plid, "private", "proof");

export const pickupUrl = (p) => `/pickups/pickup.html?s=${encodeURIComponent(p.slug || p.id)}`;
export const pickupAbsUrl = (p) => `${location.origin}${pickupUrl(p)}`;

const byStartAsc = (a, b) => pickupMs(a.startAt) - pickupMs(b.startAt);

/* =========================
   Pickups
========================= */
export async function listPublicPickups() {
  return list(await getDocs(query(collection(db, COL.pickups), where("isPublic", "==", true)))).sort(byStartAsc);
}

export async function listOrgPickups(orgId) {
  return list(await getDocs(query(collection(db, COL.pickups), where("orgId", "==", orgId)))).sort((a, b) => byStartAsc(b, a));
}

export async function loadPickup(id) {
  const snap = await getDoc(pickupRef(id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function loadPickupBySlug(slug) {
  if (!slug) return null;
  const snap = await getDocs(query(collection(db, COL.pickups), where("slug", "==", slug), where("isPublic", "==", true))).catch(() => null);
  if (snap && !snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
  // borrador o link por id (solo lo ven los admins de la organización)
  return loadPickup(slug).catch(() => null);
}

/**
 * Crea o edita un pickup. data: { title, venue, city, country, startAt: Date, endAt: Date|null,
 * capacity, leaveHours, tiers, payInfo, currency }
 */
export async function savePickup(id, data, org) {
  const startMs = data.startAt instanceof Date ? data.startAt.getTime() : pickupMs(data.startAt);
  const payload = {
    title: String(data.title || "").trim(),
    venue: data.venue || "",
    city: data.city || "",
    country: data.country || org.country || "",
    startAt: Timestamp.fromMillis(startMs),
    endAt: data.endAt ? Timestamp.fromDate(data.endAt) : null,
    capacity: Math.max(0, Number(data.capacity || 0)),
    leaveHours: Math.max(0, Number(data.leaveHours ?? 12)),
    leaveDeadlineAt: Timestamp.fromMillis(leaveDeadline(startMs, data.leaveHours ?? 12)),
    tiers: data.tiers || [],
    payInfo: data.payInfo || "",
    currency: data.currency || org.pickupSettings?.currency || "USD",
    orgId: org.id,
    orgName: org.name || "",
    orgLogo: org.logo || "",
    orgColor: org.color || "",
    updatedAt: serverTimestamp(),
  };
  // rifa: al editar solo se tocan enabled/minPlayers (el ganador, si ya se sorteó, queda)
  const raffle = { enabled: !!data.raffle?.enabled, minPlayers: Math.max(2, Number(data.raffle?.minPlayers || 0)) };
  if (id) {
    await updateDoc(pickupRef(id), { ...payload, "raffle.enabled": raffle.enabled, "raffle.minPlayers": raffle.minPlayers });
    return id;
  }
  payload.raffle = raffle;
  const newId = randomId("pk");
  const d = new Date(startMs); // fecha local del organizador (19:00 en CR no es "mañana" en UTC)
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  await setDoc(pickupRef(newId), {
    ...payload,
    slug: `${slugify(payload.title) || "pickup"}-${day}-${newId.slice(-4)}`,
    status: PICKUP_STATUS.DRAFT,
    isPublic: false,
    createdBy: auth.currentUser?.uid || "",
    createdAt: serverTimestamp(),
  });
  return newId;
}

// published = visible y abierto; draft = oculto; finished / cancelled = siguen visibles en el historial
export async function setPickupStatus(id, status) {
  await updateDoc(pickupRef(id), {
    status,
    isPublic: status !== PICKUP_STATUS.DRAFT,
    updatedAt: serverTimestamp(),
  });
}

export async function setPickupCapacity(id, capacity) {
  await updateDoc(pickupRef(id), { capacity: Math.max(0, Number(capacity) || 0), updatedAt: serverTimestamp() });
}

export async function deletePickup(id) {
  await deleteDoc(pickupRef(id));
}

/* =========================
   Jugadores
========================= */
export async function listPlayers(pid) {
  return list(await getDocs(playersCol(pid)));
}

export async function loadMyPlayer(pid, uid) {
  if (!uid) return null;
  const snap = await getDoc(playerRef(pid, uid)).catch(() => null);
  return snap?.exists() ? { id: snap.id, ...snap.data() } : null;
}

const tierFields = (pickup, tierId) => {
  const t = (pickup.tiers || []).find((x) => x.id === tierId) || pickup.tiers?.[0] || { id: "", name: "", price: 0 };
  return { tierId: t.id, tierName: t.name, price: Number(t.price || 0) };
};

/**
 * Anotarse: yo (doc = mi uid) y, si quiero, amigos que anoto yo.
 * me: { name, number, gender, photoURL, tierId }; friends: [{ name, tierId }]
 */
export async function joinPickup(user, pickup, me, friends = [], existing = null) {
  const batch = writeBatch(db);
  const base = (tier) => ({ ...tier, paymentStatus: tier.price > 0 ? PAY.NONE : PAY.FREE });
  if (me) {
    const tier = base(tierFields(pickup, me.tierId));
    const profile = { name: me.name || user.displayName || "", number: me.number ?? null, gender: me.gender || "", photoURL: me.photoURL || user.photoURL || "" };
    if (existing && existing.status === PLAYER_STATUS.LEFT) {
      // ya pagado: se mantiene el pago
      const keepPay = existing.paymentStatus === PAY.APPROVED || existing.paymentStatus === PAY.SUBMITTED;
      batch.update(playerRef(pickup.id, user.uid), {
        ...profile,
        tierId: tier.tierId,
        tierName: tier.tierName,
        price: tier.price,
        paymentStatus: keepPay ? existing.paymentStatus : tier.paymentStatus,
        status: PLAYER_STATUS.ACTIVE,
        joinedAt: serverTimestamp(),
        leftAt: null,
        updatedAt: serverTimestamp(),
      });
    } else if (!existing) {
      batch.set(playerRef(pickup.id, user.uid), {
        ...profile,
        ...tier,
        uid: user.uid,
        addedBy: user.uid,
        source: "self",
        status: PLAYER_STATUS.ACTIVE,
        attendance: null,
        order: 0,
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  }
  friends.filter((f) => String(f.name || "").trim()).forEach((f, i) => {
    batch.set(playerRef(pickup.id, randomId("pl")), {
      name: String(f.name).trim(),
      number: null,
      gender: f.gender || "",
      photoURL: "",
      ...base(tierFields(pickup, f.tierId)),
      uid: null,
      addedBy: user.uid,
      source: "friend",
      status: PLAYER_STATUS.ACTIVE,
      attendance: null,
      order: i + 1,
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
  await batch.commit();
}

export async function listMyFriends(pid, uid) {
  if (!uid) return [];
  return list(await getDocs(query(playersCol(pid), where("addedBy", "==", uid)))).filter((p) => p.source === "friend");
}

// El organizador agrega a alguien sin cuenta (o lo liga a un perfil existente con profileUid)
export async function addManualPlayer(pickup, { name, tierId, paid = false, method = "cash", profile = null }) {
  const tier = tierFields(pickup, tierId);
  const id = profile?.id || randomId("pl");
  await setDoc(playerRef(pickup.id, id), {
    name: String(name || profile?.name || "").trim(),
    number: profile?.number ?? null,
    gender: profile?.gender || "",
    photoURL: profile?.photoURL || "",
    ...tier,
    paymentStatus: tier.price <= 0 ? PAY.FREE : paid ? PAY.APPROVED : PAY.NONE,
    paidMethod: paid ? method : null,
    uid: profile?.id || null,
    addedBy: auth.currentUser?.uid || "",
    source: "manual",
    status: PLAYER_STATUS.ACTIVE,
    attendance: null,
    order: 0,
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return id;
}

export async function leavePickup(pid, plid) {
  await updateDoc(playerRef(pid, plid), { status: PLAYER_STATUS.LEFT, leftAt: serverTimestamp(), updatedAt: serverTimestamp() });
}

export async function submitProof(pid, plid, image) {
  await setDoc(proofRef(pid, plid), { image, at: serverTimestamp(), by: auth.currentUser?.uid || "" });
  await updateDoc(playerRef(pid, plid), { paymentStatus: PAY.SUBMITTED, paymentAt: serverTimestamp(), updatedAt: serverTimestamp() });
}

export async function loadProof(pid, plid) {
  const snap = await getDoc(proofRef(pid, plid)).catch(() => null);
  return snap?.exists() ? snap.data() : null;
}

// Solo admins de la organización
export async function setPayment(pid, plid, paymentStatus, method = null) {
  await updateDoc(playerRef(pid, plid), { paymentStatus, paidMethod: method, paymentDecidedAt: serverTimestamp(), updatedAt: serverTimestamp() });
}

export async function updatePlayer(pid, plid, patch) {
  await updateDoc(playerRef(pid, plid), { ...patch, updatedAt: serverTimestamp() });
}

export async function setPlayerTier(pickup, plid, tierId, player) {
  const tier = tierFields(pickup, tierId);
  const patch = { ...tier };
  if (tier.price <= 0) patch.paymentStatus = PAY.FREE;
  else if (player?.paymentStatus === PAY.FREE) patch.paymentStatus = PAY.NONE;
  await updatePlayer(pickup.id, plid, patch);
}

/**
 * Guarda el resultado de la rifa: el ganador juega gratis (se anota cómo estaba su pago por si hay que devolverlo).
 * @param {object} pickup
 * @param {object[]} pool confirmados que entraron
 * @param {object} winner jugador elegido
 */
export async function saveRaffle(pickup, pool, winner) {
  const batch = writeBatch(db);
  batch.update(pickupRef(pickup.id), {
    "raffle.winnerId": winner.id,
    "raffle.winnerName": winner.name || "",
    "raffle.pool": pool.map((p) => ({ id: p.id, name: p.name || "" })),
    "raffle.drawnAt": serverTimestamp(),
    "raffle.drawnBy": auth.currentUser?.uid || "",
    updatedAt: serverTimestamp(),
  });
  batch.update(playerRef(pickup.id, winner.id), {
    raffleWinner: true,
    prevPaymentStatus: winner.paymentStatus || PAY.NONE,
    paymentStatus: PAY.FREE,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function removePlayer(pid, plid) {
  await deleteDoc(proofRef(pid, plid)).catch(() => {});
  await deleteDoc(playerRef(pid, plid));
}

/* =========================
   Mis pickups: los públicos donde estoy anotado (pocos, uno por uno)
========================= */
export async function myPickups(uid, pickups) {
  if (!uid) return [];
  const rows = await Promise.all(pickups.map(async (p) => {
    const me = await loadMyPlayer(p.id, uid);
    return me && me.status === PLAYER_STATUS.ACTIVE ? { pickup: p, me } : null;
  }));
  return rows.filter(Boolean);
}
