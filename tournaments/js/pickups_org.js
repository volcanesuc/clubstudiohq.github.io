// /tournaments/js/pickups_org.js
// /pickups/organize.html: la organización (perfil, ajustes de pickups, admins) y sus pickups.
// Crear pickups solo se puede si el admin de la plataforma activó features.pickups en la organización.
import { EX, LOCALE } from "/tournaments/js/strings.js";
import { PK, pkf } from "/tournaments/js/pickups_strings.js";
import { countryOptions, countryName, flagOf } from "/tournaments/js/countries.js";
import { cropFromInput } from "/tournaments/js/cropper.js";
import { isPlatformAdmin } from "/tournaments/js/services.js";
import { loadProfile } from "/tournaments/js/squads.js";
import {
  ORG_KINDS,
  createOrg,
  deleteOrg,
  getOrgInvite,
  isOrgAdmin,
  joinOrg,
  listMyOrgs,
  loadOrg,
  loadOrgInvite,
  pickupAccess,
  claimPendingOrgs,
  orgJoinUrl,
  regenerateOrgInvite,
  saveOrg,
  setOrgOwners,
} from "/tournaments/js/orgs.js";
import { TIER_RULES, defaultPickupSettings, slugify } from "/tournaments/js/pickups.js";
import { mountPickups } from "/tournaments/js/pickups_manage.js";
import { askConfirm, esc, fmtWhen, hideLoader, isGoogleUser, renderNav, setAdminMode, showLoader, signInGoogle, teamBadge, waitForUser } from "/tournaments/js/ui.js";

const root = document.getElementById("tnRoot");
const params = new URLSearchParams(location.search);
const TABS = ["pickups", "settings", "admins", "profile"];
const CURRENCIES = ["CRC", "USD", "MXN", "COP", "GTQ", "HNL", "NIO", "PEN", "CLP", "ARS", "EUR"];
const state = {
  user: null,
  platformAdmin: false,
  orgs: [],
  org: null,
  tab: TABS.includes(params.get("tab")) ? params.get("tab") : "pickups",
  admins: null, // [{ uid, name, photoURL }]
  invite: "",
  tiers: [], // borrador de tarifas en Ajustes
};
const WA = "50670567463";

function alertBox(msg, kind = "success") {
  const el = document.getElementById("tnAlert");
  el.className = `alert alert-${kind}`;
  el.textContent = msg;
  el.classList.toggle("d-none", !msg);
  if (msg && kind === "success") setTimeout(() => el.classList.add("d-none"), 2500);
}

async function run(fn, okMsg = "") {
  showLoader();
  try {
    await fn();
    if (okMsg) alertBox(okMsg);
  } catch (err) {
    console.error("[pickups]", err);
    alertBox(`${EX.error} ${err?.code || err?.message || ""}`, "danger");
  } finally {
    hideLoader();
  }
}

function setUrl() {
  const u = new URL(location.href);
  u.searchParams.delete("join");
  if (state.org) u.searchParams.set("org", state.org.id);
  else u.searchParams.delete("org");
  u.searchParams.set("tab", state.tab);
  if (state.tab !== "pickups") u.searchParams.delete("p");
  history.replaceState(null, "", u);
}

const canManage = () => !!state.org && (isOrgAdmin(state.org, state.user?.uid) || state.platformAdmin);

/* =========================
   Sin cuenta / sin organización
========================= */
function renderSignIn() {
  root.innerHTML = `
    <div class="ev-card text-center py-5 mt-3" style="max-width:520px;margin:auto">
      <div class="display-6 mb-2"><i class="bi bi-people"></i></div>
      <h1 class="h4 fw-bold">${esc(PK.orgTitle)}</h1>
      <p class="ev-muted">${esc(PK.orgSignIn)}</p>
      <button class="btn tn-btn-grad" id="pkLogin"><i class="bi bi-google me-1"></i>${esc(EX.signIn)}</button>
    </div>`;
  document.getElementById("pkLogin").onclick = async () => {
    try {
      await signInGoogle();
      location.reload();
    } catch (err) {
      alertBox(`${EX.error} ${err?.code || ""}`, "danger");
    }
  };
}

function orgForm(o = {}) {
  return `
    <div class="row g-3">
      <div class="col-12 col-md-8"><label class="form-label small fw-semibold" for="ogName">${esc(PK.orgName)}</label><input class="form-control" id="ogName" value="${esc(o.name || "")}" placeholder="${esc(PK.orgNamePh)}" maxlength="80" /></div>
      <div class="col-12 col-md-4"><label class="form-label small fw-semibold" for="ogKind">${esc(PK.orgKind)}</label>
        <select class="form-select" id="ogKind">${ORG_KINDS.map((k) => `<option value="${k}" ${k === (o.kind || "association") ? "selected" : ""}>${esc(PK.orgKinds[k])}</option>`).join("")}</select></div>
      <div class="col-12 col-md-5"><label class="form-label small fw-semibold" for="ogCountry">${esc(PK.orgCountry)}</label><select class="form-select" id="ogCountry">${countryOptions(o.country || "", esc(PK.orgCountryPick))}</select></div>
      <div class="col-8 col-md-5"><label class="form-label small fw-semibold" for="ogCity">${esc(PK.orgCity)}</label><input class="form-control" id="ogCity" value="${esc(o.city || "")}" maxlength="60" /></div>
      <div class="col-4 col-md-2"><label class="form-label small fw-semibold" for="ogColor">${esc(PK.orgColor)}</label><input class="form-control form-control-color w-100" type="color" id="ogColor" value="${esc(o.color || "#6d28d9")}" /></div>
      <div class="col-12 col-md-5"><label class="form-label small fw-semibold" for="ogPhone">${esc(PK.orgPhone)}</label><input class="form-control" type="tel" id="ogPhone" value="${esc(o.contactPhone || "")}" placeholder="8888 8888" maxlength="30" /></div>
    </div>`;
}

const readOrgForm = () => ({
  name: root.querySelector("#ogName").value.trim(),
  kind: root.querySelector("#ogKind").value,
  country: root.querySelector("#ogCountry").value,
  city: root.querySelector("#ogCity").value.trim(),
  color: root.querySelector("#ogColor").value,
  contactPhone: root.querySelector("#ogPhone").value.trim(),
});

function renderCreate() {
  state.org = null;
  setUrl();
  root.innerHTML = `
    <section class="ev-hero mb-3">
      <h1>${esc(PK.orgTitle)}</h1>
      <div class="ev-hero__meta">${esc(PK.orgLead)}</div>
    </section>
    <div class="ev-card" style="max-width:720px">
      <h2 class="h5 fw-bold mb-1">${esc(PK.orgCreate)}</h2>
      <div class="small ev-muted mb-3">${esc(PK.orgCreateLead)}</div>
      ${orgForm()}
      <div class="d-flex justify-content-end gap-2 mt-3">
        ${state.orgs.length ? `<button class="btn btn-light" id="ogBack">${esc(EX.cancel)}</button>` : ""}
        <button class="btn tn-btn-grad" id="ogCreate"><i class="bi bi-plus-lg me-1"></i>${esc(PK.orgCreate)}</button>
      </div>
    </div>`;
  root.querySelector("#ogBack")?.addEventListener("click", () => openOrg(state.orgs[0].id));
  root.querySelector("#ogCreate").onclick = () => {
    const data = readOrgForm();
    if (!data.name) return alertBox(PK.orgName, "warning");
    run(async () => {
      const id = await createOrg(state.user, data);
      state.orgs = await listMyOrgs(state.user);
      await openOrg(id);
    });
  };
}

/* =========================
   Organización
========================= */
async function openOrg(id) {
  state.org = state.orgs.find((o) => o.id === id) || (await loadOrg(id));
  state.admins = null;
  state.invite = "";
  state.tiers = (state.org?.pickupSettings?.tiers || []).map((t) => ({ ...t }));
  if (!state.org) return renderCreate();
  setAdminMode(!isOrgAdmin(state.org, state.user.uid) && state.platformAdmin);
  render();
}

function header() {
  const o = state.org;
  const acc = pickupAccess(o);
  const on = acc.state === "on" || acc.state === "soon";
  const day = (ms) => fmtWhen(ms, { day: "numeric", month: "short", year: "numeric" });
  const chip = acc.state === "expired" ? ["pk-chip-off", pkf(PK.accExpired, { date: day(acc.until) })]
    : acc.state === "soon" ? ["pk-chip-soon", pkf(PK.accUntil, { date: day(acc.until) })]
    : on ? ["pk-chip-on", acc.until ? pkf(PK.accUntil, { date: day(acc.until) }) : PK.orgPickupsOn]
    : ["pk-chip-off", PK.orgPickupsOff];
  const where = o.country ? `${flagOf(o.country)} ${[o.city, countryName(o.country)].filter(Boolean).join(", ")}` : o.city || "";
  return `
    <section class="ev-hero mb-3 d-flex align-items-center gap-3 flex-wrap">
      <label class="pk-org-logo ${canManage() ? "is-editable" : ""}" title="${esc(PK.orgLogoChange)}">
        ${teamBadge({ id: o.id, name: o.name, logo: o.logo, color: o.color }, 64)}
        ${canManage() ? `<input type="file" accept="image/*" id="ogLogo" hidden />` : ""}
      </label>
      <div class="flex-grow-1 min-w-0">
        <div class="ev-hero__meta">${esc(PK.orgKinds[o.kind] || "")}${where ? ` · ${esc(where)}` : ""}</div>
        <h1 class="mb-1">${esc(o.name)}</h1>
        <span class="ev-chip ${chip[0]}">${esc(chip[1])}</span>
      </div>
      <div class="d-flex gap-2 flex-wrap">
        ${state.orgs.length > 1 ? `<select class="form-select form-select-sm" id="ogSwitch" aria-label="${esc(PK.orgTitle)}">${state.orgs.map((x) => `<option value="${esc(x.id)}" ${x.id === o.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>` : ""}
        <button class="btn btn-sm btn-outline-light" id="ogNew"><i class="bi bi-plus-lg me-1"></i>${esc(PK.orgNew)}</button>
      </div>
    </section>
    <nav class="tp-tabs mb-3" role="tablist">
      ${TABS.map((t) => `<button class="tp-tab ${state.tab === t ? "is-active" : ""}" data-tab="${t}"><i class="bi ${{ pickups: "bi-calendar-event", settings: "bi-sliders", admins: "bi-person-gear", profile: "bi-building" }[t]}"></i> ${esc(PK[`orgTab${t[0].toUpperCase()}${t.slice(1)}`])}</button>`).join("")}
    </nav>`;
}

// Aviso cuando el permiso vence pronto o ya venció (con link para renovar por WhatsApp)
function accessNote() {
  const acc = pickupAccess(state.org);
  if (acc.state !== "soon" && acc.state !== "expired") return "";
  const day = fmtWhen(acc.until, { day: "numeric", month: "long", year: "numeric" });
  const wa = `https://wa.me/${WA}?text=${encodeURIComponent(pkf(PK.orgRenewWa, { name: state.org.name }))}`;
  const expired = acc.state === "expired";
  return `
    <div class="pk-note ${expired ? "pk-note--off" : "pk-note--review"} mb-3 d-flex align-items-center gap-2 flex-wrap">
      <div class="flex-grow-1 min-w-0">
        <div class="fw-bold">${esc(expired ? PK.orgExpiredTitle : pkf(PK.orgSoonTitle, { date: day }))}</div>
        <div class="small">${esc(expired ? pkf(PK.orgExpiredText, { date: day }) : PK.orgSoonText)}</div>
      </div>
      <a class="btn btn-sm tn-btn-grad" href="${esc(wa)}" target="_blank" rel="noopener"><i class="bi bi-whatsapp me-1"></i>${esc(PK.orgRenew)}</a>
    </div>`;
}

function lockedCard() {
  const wa = `https://wa.me/${WA}?text=${encodeURIComponent(pkf(PK.orgLockedWa, { name: state.org.name }))}`;
  return `
    <div class="ev-card text-center py-4" style="max-width:560px;margin:auto">
      <div class="display-6 mb-2"><i class="bi bi-lock"></i></div>
      <h2 class="h5 fw-bold">${esc(PK.orgLockedTitle)}</h2>
      <p class="ev-muted">${esc(PK.orgLockedText)}</p>
      <a class="btn tn-btn-grad" href="${esc(wa)}" target="_blank" rel="noopener"><i class="bi bi-whatsapp me-1"></i>${esc(PK.orgLockedBtn)}</a>
    </div>`;
}

/* ----- Ajustes de pickups ----- */
function tierRow(t, i) {
  return `
    <div class="pk-tier-row" data-tier="${i}">
      <input class="form-control form-control-sm" data-f="name" value="${esc(t.name || "")}" placeholder="${esc(PK.setTierName)}" aria-label="${esc(PK.setTierName)}" maxlength="40" />
      <select class="form-select form-select-sm" data-f="rule" aria-label="${esc(PK.setTierRule)}">${TIER_RULES.map((r) => `<option value="${r}" ${r === (t.rule || "any") ? "selected" : ""}>${esc(PK.setRules[r])}</option>`).join("")}</select>
      <input class="form-control form-control-sm" data-f="price" type="number" min="0" step="1" inputmode="decimal" value="${esc(t.price ?? 0)}" aria-label="${esc(PK.setTierPrice)}" />
      <button class="btn btn-sm btn-light" data-act="tierDel" title="${esc(PK.setTierRemove)}" aria-label="${esc(PK.setTierRemove)}"><i class="bi bi-trash"></i></button>
    </div>`;
}

function settingsTab() {
  const s = { ...defaultPickupSettings(state.org.country), ...(state.org.pickupSettings || {}) };
  const hours = [0, 1, 2, 3, 6, 12, 24, 48];
  if (!hours.includes(Number(s.leaveHours))) hours.push(Number(s.leaveHours));
  return `
    <div class="ev-card">
      <div class="small ev-muted mb-3">${esc(PK.setLead)}</div>
      <div class="fw-bold mb-2">${esc(PK.setTiers)}</div>
      <div class="pk-tier-head small ev-muted"><span>${esc(PK.setTierName)}</span><span>${esc(PK.setTierRule)}</span><span>${esc(PK.setTierPrice)}</span><span></span></div>
      <div id="pkTiers">${state.tiers.map(tierRow).join("")}</div>
      <button class="btn btn-sm btn-light mt-2" data-act="tierAdd"><i class="bi bi-plus-lg me-1"></i>${esc(PK.setTierAdd)}</button>
      <div class="row g-3 mt-2">
        <div class="col-6 col-md-3"><label class="form-label small fw-semibold" for="stCurrency">${esc(PK.setCurrency)}</label>
          <select class="form-select" id="stCurrency">${[...new Set([s.currency, ...CURRENCIES])].map((c) => `<option ${c === s.currency ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
        <div class="col-6 col-md-3"><label class="form-label small fw-semibold" for="stCap">${esc(PK.setCapacity)}</label><input class="form-control" id="stCap" type="number" min="0" value="${esc(s.defaultCapacity)}" /></div>
        <div class="col-12 col-md-6"><label class="form-label small fw-semibold" for="stLeave">${esc(PK.setLeaveHours)}</label>
          <select class="form-select" id="stLeave">${hours.sort((a, b) => a - b).map((h) => `<option value="${h}" ${h === Number(s.leaveHours) ? "selected" : ""}>${esc(h ? pkf(PK.setLeaveOpt, { n: h }) : PK.setLeaveStart)}</option>`).join("")}</select></div>
        <div class="col-12"><label class="form-label small fw-semibold" for="stPay">${esc(PK.setPayInfo)}</label><textarea class="form-control" id="stPay" rows="2" maxlength="400" placeholder="${esc(PK.setPayInfoPh)}">${esc(s.payInfo || "")}</textarea></div>
      </div>
      <div class="d-flex justify-content-end mt-3"><button class="btn tn-btn-grad" data-act="saveSettings"><i class="bi bi-check2 me-1"></i>${esc(PK.orgSave)}</button></div>
    </div>`;
}

function readTiers() {
  return [...root.querySelectorAll("[data-tier]")].map((row, i) => {
    const prev = state.tiers[i] || {};
    const name = row.querySelector('[data-f="name"]').value.trim();
    return {
      id: prev.id || slugify(name) || `t${i}`,
      name,
      rule: row.querySelector('[data-f="rule"]').value,
      price: Math.max(0, Number(row.querySelector('[data-f="price"]').value || 0)),
    };
  });
}

/* ----- Admins ----- */
function adminsTab() {
  if (state.admins === null) return `<div class="ev-card ev-muted small">${esc(EX.loading)}</div>`;
  const me = state.user.uid;
  return `
    <div class="ev-card">
      <div class="small ev-muted mb-3">${esc(PK.orgAdminsLead)}</div>
      <div class="pa-list mb-3">${state.admins.map((a) => `
        <div class="pa-row">
          ${a.photoURL ? `<img class="tn-avatar" src="${esc(a.photoURL)}" alt="" style="width:36px;height:36px" referrerpolicy="no-referrer" />` : `<span class="tn-avatar tn-avatar--empty" style="width:36px;height:36px">${esc((a.name || "?").charAt(0).toUpperCase())}</span>`}
          <div class="flex-grow-1 min-w-0 fw-semibold text-truncate">${esc(a.name || a.uid)}${a.uid === me ? ` <span class="ev-chip">${esc(PK.orgYou)}</span>` : ""}</div>
          ${a.uid !== me && state.admins.length > 1 ? `<button class="btn btn-sm btn-light" data-act="adminDel" data-uid="${esc(a.uid)}">${esc(PK.orgRemoveAdmin)}</button>` : ""}
        </div>`).join("")}</div>
      <label class="form-label small fw-semibold" for="ogInvite">${esc(PK.orgInviteLink)}</label>
      <div class="input-group mb-2">
        <input class="form-control" id="ogInvite" readonly value="${esc(state.invite ? orgJoinUrl(state.invite) : EX.loading)}" />
        <button class="btn btn-primary" data-act="inviteCopy"><i class="bi bi-copy me-1"></i>${esc(PK.orgCopy)}</button>
      </div>
      <div class="d-flex justify-content-between flex-wrap gap-2">
        <button class="btn btn-sm btn-light" data-act="inviteNew"><i class="bi bi-arrow-repeat me-1"></i>${esc(PK.orgRegenerate)}</button>
        ${isOrgAdmin(state.org, me) ? `<button class="btn btn-sm btn-outline-danger" data-act="orgLeave">${esc(PK.orgLeave)}</button>` : ""}
      </div>
    </div>`;
}

async function loadAdmins() {
  const uids = state.org.ownerUids || [];
  const profiles = await Promise.all(uids.map((u) => loadProfile(u).catch(() => null)));
  state.admins = uids.map((uid, i) => ({ uid, name: profiles[i]?.name || (uid === state.user.uid ? state.user.displayName : ""), photoURL: profiles[i]?.photoURL || "" }));
  state.invite = await getOrgInvite(state.org.id, state.user).catch(() => "");
}

/* ----- Perfil ----- */
function profileTab() {
  return `
    <div class="ev-card">
      ${orgForm(state.org)}
      <div class="d-flex justify-content-between flex-wrap gap-2 mt-3">
        <button class="btn btn-sm btn-outline-danger" data-act="orgDelete">${esc(PK.orgDelete)}</button>
        <button class="btn tn-btn-grad" data-act="saveProfile"><i class="bi bi-check2 me-1"></i>${esc(PK.orgSave)}</button>
      </div>
    </div>`;
}

function render() {
  setUrl();
  const o = state.org;
  const acc = pickupAccess(o);
  // vencido: sigue viendo sus pickups (listas y pagos) pero no crea nuevos; nunca activado: tarjeta de pedir permiso
  const expired = acc.state === "expired" && !state.platformAdmin;
  const locked = acc.state === "off" && !state.platformAdmin;
  root.innerHTML = `${header()}<div id="pkTab"></div>`;
  const box = root.querySelector("#pkTab");
  if (state.tab === "pickups") {
    if (locked) box.innerHTML = lockedCard();
    else {
      box.insertAdjacentHTML("beforebegin", accessNote());
      mountPickups(box, { org: o, user: state.user, alertBox, run, pickupId: params.get("p") || "", locked: expired });
    }
  } else if (state.tab === "settings") box.innerHTML = settingsTab();
  else if (state.tab === "admins") {
    box.innerHTML = adminsTab();
    if (state.admins === null) loadAdmins().then(() => state.tab === "admins" && render()).catch((e) => alertBox(`${EX.error} ${e?.code || ""}`, "danger"));
  } else box.innerHTML = profileTab();
}

/* =========================
   Eventos
========================= */
root.addEventListener("change", async (ev) => {
  if (ev.target.id === "ogSwitch") return run(() => openOrg(ev.target.value));
  if (ev.target.id === "ogLogo") {
    let logo = null;
    try {
      logo = await cropFromInput(ev.target, { aspect: 1, width: 256, maxChars: 200000, title: PK.orgLogo });
    } catch {
      return alertBox(EX.imageBad || EX.error, "warning");
    }
    if (!logo) return;
    run(async () => {
      await saveOrg(state.org.id, { logo });
      state.org.logo = logo;
      render();
    }, PK.orgSaved);
  }
});

root.addEventListener("click", async (ev) => {
  const tab = ev.target.closest("[data-tab]");
  if (tab) {
    state.tab = tab.dataset.tab;
    params.delete("p");
    return render();
  }
  if (ev.target.closest("#ogNew")) return renderCreate();
  const act = ev.target.closest("[data-act]")?.dataset.act;
  if (!act) return;
  const o = state.org;
  if (act === "tierAdd") {
    state.tiers = [...readTiers(), { id: "", name: "", rule: "any", price: 0 }];
    root.querySelector("#pkTiers").innerHTML = state.tiers.map(tierRow).join("");
    return root.querySelector("[data-tier]:last-child [data-f=name]")?.focus();
  }
  if (act === "tierDel") {
    const i = Number(ev.target.closest("[data-tier]").dataset.tier);
    state.tiers = readTiers().filter((_, j) => j !== i);
    root.querySelector("#pkTiers").innerHTML = state.tiers.map(tierRow).join("");
    return;
  }
  if (act === "saveSettings") {
    const tiers = readTiers().filter((t) => t.name);
    if (!tiers.length) return alertBox(PK.setNoTiers, "warning");
    // ids únicos aunque dos tarifas se llamen parecido
    const seen = new Set();
    tiers.forEach((t, i) => { while (seen.has(t.id)) t.id = `${t.id}-${i}`; seen.add(t.id); });
    const pickupSettings = {
      tiers,
      currency: root.querySelector("#stCurrency").value,
      defaultCapacity: Math.max(0, Number(root.querySelector("#stCap").value || 0)),
      leaveHours: Number(root.querySelector("#stLeave").value || 0),
      payInfo: root.querySelector("#stPay").value.trim(),
    };
    return run(async () => {
      await saveOrg(o.id, { pickupSettings });
      o.pickupSettings = pickupSettings;
      state.tiers = tiers.map((t) => ({ ...t }));
      render();
    }, PK.orgSaved);
  }
  if (act === "saveProfile") {
    const data = readOrgForm();
    if (!data.name) return alertBox(PK.orgName, "warning");
    return run(async () => {
      await saveOrg(o.id, data);
      Object.assign(o, data);
      render();
    }, PK.orgSaved);
  }
  if (act === "orgDelete") {
    if (!(await askConfirm(pkf(PK.orgDeleteConfirm, { name: o.name }), { ok: PK.orgDelete, danger: true }))) return;
    return run(async () => {
      await deleteOrg(o.id);
      state.orgs = await listMyOrgs(state.user);
      state.orgs.length ? await openOrg(state.orgs[0].id) : renderCreate();
    });
  }
  if (act === "inviteCopy") {
    try {
      await navigator.clipboard.writeText(orgJoinUrl(state.invite));
      alertBox(PK.orgCopied);
    } catch {
      root.querySelector("#ogInvite")?.select();
    }
    return;
  }
  if (act === "inviteNew") {
    if (!(await askConfirm(PK.orgRegenerateConfirm, { ok: PK.orgRegenerate }))) return;
    return run(async () => {
      state.invite = await regenerateOrgInvite(o.id, state.user);
      render();
    });
  }
  if (act === "adminDel") {
    const a = state.admins.find((x) => x.uid === ev.target.closest("[data-uid]").dataset.uid);
    if (!a || !(await askConfirm(pkf(PK.orgRemoveConfirm, { name: a.name || a.uid }), { ok: PK.orgRemoveAdmin, danger: true }))) return;
    return run(async () => {
      o.ownerUids = o.ownerUids.filter((u) => u !== a.uid);
      await setOrgOwners(o.id, o.ownerUids);
      state.admins = state.admins.filter((x) => x.uid !== a.uid);
      render();
    }, PK.orgSaved);
  }
  if (act === "orgLeave") {
    if ((o.ownerUids || []).length <= 1) return alertBox(PK.orgLastAdmin, "warning");
    if (!(await askConfirm(pkf(PK.orgLeaveConfirm, { name: o.name }), { ok: PK.orgLeave, danger: true }))) return;
    return run(async () => {
      await setOrgOwners(o.id, o.ownerUids.filter((u) => u !== state.user.uid));
      state.orgs = await listMyOrgs(state.user);
      state.orgs.length ? await openOrg(state.orgs[0].id) : renderCreate();
    });
  }
});

/* =========================
   Invitación de admin (?join=token)
========================= */
async function handleJoin(token) {
  const invite = await loadOrgInvite(token).catch(() => null);
  const org = invite ? await loadOrg(invite.orgId).catch(() => null) : null;
  if (!invite || !org) {
    root.innerHTML = `<div class="ev-card text-center py-5" style="max-width:520px;margin:auto"><div class="fw-bold">${esc(PK.orgJoinBad)}</div></div>`;
    return true;
  }
  if (isOrgAdmin(org, state.user.uid)) return false;
  root.innerHTML = `
    <div class="ev-card text-center py-5 mt-3" style="max-width:520px;margin:auto">
      <div class="d-flex justify-content-center mb-2">${teamBadge({ id: org.id, name: org.name, logo: org.logo, color: org.color }, 64)}</div>
      <h1 class="h4 fw-bold">${esc(PK.orgJoinTitle)}</h1>
      <p class="ev-muted">${esc(pkf(PK.orgJoinText, { name: org.name }))}</p>
      <button class="btn tn-btn-grad" id="ogJoin">${esc(PK.orgJoinBtn)}</button>
    </div>`;
  root.querySelector("#ogJoin").onclick = () => run(async () => {
    const id = await joinOrg(state.user, invite);
    state.orgs = await listMyOrgs(state.user);
    await openOrg(id);
  }, pkf(PK.orgJoined, { name: org.name }));
  return true;
}

(async function init() {
  showLoader();
  try {
    const user = await waitForUser();
    state.user = isGoogleUser(user) ? user : null;
    state.platformAdmin = !!state.user && (await isPlatformAdmin(state.user.uid));
    renderNav({ active: "pickups", user, isAdmin: state.platformAdmin });
    if (!state.user) return renderSignIn();
    if (params.get("join") && (await handleJoin(params.get("join")))) return;
    // si el admin de la plataforma creó una organización para mi correo, la reclamo al entrar
    const claimed = await claimPendingOrgs(state.user);
    if (claimed.length) alertBox(pkf(PK.orgClaimed, { name: claimed.map((o) => o.name).join(", ") }));
    state.orgs = await listMyOrgs(state.user);
    const want = params.get("org") || claimed[0]?.id;
    // el admin de la plataforma puede abrir cualquier organización con ?org=
    if (want && (state.orgs.some((o) => o.id === want) || state.platformAdmin)) await openOrg(want);
    else if (state.orgs.length) await openOrg(state.orgs[0].id);
    else renderCreate();
  } catch (err) {
    console.error("[pickups]", err);
    alertBox(`${EX.error} ${err?.code || err?.message || ""}`, "danger");
  } finally {
    hideLoader();
  }
})();
