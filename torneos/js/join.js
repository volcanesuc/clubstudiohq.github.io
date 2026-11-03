// /torneos/js/join.js
// Unirse a un equipo con un link (?t=TOKEN). El jugador entra con su propia cuenta de Google,
// completa su perfil (foto, nombre, número, F/M) y queda en el roster. El link de admin lo hace co-admin.
import { EX, exf } from "/torneos/js/strings.js";
import { isPlatformAdmin } from "/torneos/js/services.js";
import {
  INVITE_ROLE,
  ensureProfile,
  isSquadAdmin,
  joinSquad,
  listMembers,
  loadInvite,
  loadSquad,
  squadUrl,
} from "/torneos/js/squads.js";
import {
  avatarHtml,
  esc,
  hideLoader,
  isGoogleUser,
  renderNav,
  showLoader,
  shrinkImage,
  signInGoogle,
  teamBadge,
  waitForUser,
} from "/torneos/js/ui.js";

const root = document.getElementById("tnRoot");
const $ = (sel) => root.querySelector(sel);
const TOKEN = new URLSearchParams(location.search).get("t") || "";

const state = { user: null, invite: null, squad: null, profile: null };

function alertBox(msg, kind = "danger") {
  const el = document.getElementById("tnAlert");
  el.className = `alert alert-${kind}`;
  el.textContent = msg;
  el.classList.toggle("d-none", !msg);
}

const card = (inner) => `<div class="ev-card mt-3 mx-auto" style="max-width:560px">${inner}</div>`;

function teamHead() {
  const s = state.squad;
  const admin = state.invite.role === INVITE_ROLE.ADMIN;
  return `
    <div class="text-center mb-3">
      <div class="d-flex justify-content-center mb-2">${teamBadge(s, 84)}</div>
      <div class="small ev-muted">${esc(admin ? EX.jnInvitedAdmin : EX.jnInvitedPlayer)}</div>
      <h1 class="h3 fw-bold mb-0">${esc(s.name)}</h1>
      ${s.city ? `<div class="ev-muted small">${esc(s.city)}</div>` : ""}
    </div>`;
}

function renderSignIn() {
  root.innerHTML = card(`
    ${teamHead()}
    <p class="ev-muted text-center">${esc(EX.jnSignInText)}</p>
    <div class="text-center"><button class="btn tn-btn-grad" id="jnLogin"><i class="bi bi-google me-1"></i>${esc(EX.signIn)}</button></div>`);
  $("#jnLogin").onclick = async () => {
    try {
      await signInGoogle();
      location.reload();
    } catch (err) {
      alertBox(`${EX.error} ${err?.code || ""}`);
    }
  };
}

function renderAlready() {
  root.innerHTML = card(`
    ${teamHead()}
    <p class="text-center">${esc(EX.jnAlready)}</p>
    <div class="text-center"><a class="btn btn-primary" href="${esc(squadUrl(state.squad.id))}">${esc(EX.jnGoToTeam)}</a></div>`);
}

function renderForm() {
  const p = state.profile;
  const admin = state.invite.role === INVITE_ROLE.ADMIN;
  root.innerHTML = card(`
    ${teamHead()}
    <form id="jnForm" class="d-grid gap-3">
      <div class="d-flex align-items-center gap-3">
        <div id="jnPhotoPrev">${avatarHtml(p, 72)}</div>
        <div>
          <label class="btn btn-sm btn-outline-secondary mb-1"><i class="bi bi-camera me-1"></i>${esc(EX.pfPhoto)}<input type="file" accept="image/*" id="jnPhoto" hidden /></label>
          <div class="form-text m-0">${esc(EX.pfPhotoHint)}</div>
        </div>
      </div>
      <div><label class="form-label small" for="jnName">${esc(EX.pfName)}</label><input class="form-control" id="jnName" value="${esc(p.name || "")}" required /></div>
      <div class="row g-2">
        <div class="col-6"><label class="form-label small" for="jnNumber">${esc(EX.playerNumber)}</label><input class="form-control" id="jnNumber" type="number" min="0" max="999" inputmode="numeric" value="${esc(p.number ?? "")}" /></div>
        <div class="col-6">
          <label class="form-label small" for="jnGender">${esc(EX.pfGender)}</label>
          <select class="form-select" id="jnGender" required>
            <option value="">—</option>
            <option value="F" ${p.gender === "F" ? "selected" : ""}>F</option>
            <option value="M" ${p.gender === "M" ? "selected" : ""}>M</option>
          </select>
        </div>
      </div>
      ${admin ? `
        <div class="form-check form-switch">
          <input class="form-check-input" type="checkbox" id="jnAsPlayer" checked />
          <label class="form-check-label" for="jnAsPlayer">${esc(EX.jnAlsoPlay)}</label>
        </div>` : ""}
      <button class="btn tn-btn-grad btn-lg" type="submit">${esc(exf(EX.jnJoin, { team: state.squad.name }))}</button>
      <div class="form-text text-center m-0">${esc(EX.jnPrivacy)}</div>
    </form>`);

  $("#jnPhoto").onchange = async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      const photo = await shrinkImage(file, 192);
      if (photo.length > 200000) return alertBox(EX.teamLogoTooBig, "warning");
      state.profile.photoURL = photo;
      $("#jnPhotoPrev").innerHTML = avatarHtml({ ...state.profile, name: $("#jnName").value }, 72);
    } catch {
      alertBox(EX.teamLogoTooBig, "warning");
    }
  };

  $("#jnForm").onsubmit = async (ev) => {
    ev.preventDefault();
    const name = $("#jnName").value.trim();
    const gender = $("#jnGender").value;
    if (!name || !gender) return alertBox(EX.jnNeedNameGender, "warning");
    const num = $("#jnNumber").value;
    showLoader();
    try {
      const sid = await joinSquad(state.user, state.invite, {
        name,
        gender,
        number: num === "" ? null : Number(num),
        photoURL: state.profile.photoURL || "",
      }, { asPlayer: admin ? $("#jnAsPlayer").checked : true });
      location.href = squadUrl(sid);
    } catch (err) {
      console.error(err);
      alertBox(`${EX.error} ${err?.code || err?.message || ""}`);
      hideLoader();
    }
  };
}

(async function init() {
  showLoader();
  try {
    const user = await waitForUser();
    state.user = isGoogleUser(user) ? user : null;
    renderNav({ active: "team", user, isAdmin: await isPlatformAdmin(state.user?.uid) });
    state.invite = await loadInvite(TOKEN).catch(() => null);
    state.squad = state.invite ? await loadSquad(state.invite.squadId).catch(() => null) : null;
    if (!state.invite || !state.squad) {
      root.innerHTML = card(`<div class="text-center py-3"><div class="display-6">🔗</div><p class="mb-0">${esc(EX.jnInvalid)}</p></div>`);
      return;
    }
    if (!state.user) return renderSignIn();
    const members = await listMembers(state.squad.id).catch(() => []);
    const inRoster = members.some((m) => m.id === state.user.uid);
    const done = state.invite.role === INVITE_ROLE.ADMIN ? isSquadAdmin(state.squad, state.user.uid) : inRoster;
    if (done) return renderAlready();
    state.profile = await ensureProfile(state.user);
    renderForm();
  } catch (err) {
    console.error(err);
    alertBox(`${EX.error} ${err?.code || err?.message || ""}`);
  } finally {
    hideLoader();
  }
})();
