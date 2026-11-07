// /tournaments/js/join.js
// Unirse a un equipo con un link (?t=TOKEN). El jugador entra con su propia cuenta de Google,
// completa su perfil (foto opcional, nombre, número, F/M) y queda en el roster. El link de admin lo hace co-admin.
import { EX, exf } from "/tournaments/js/strings.js";
import { isPlatformAdmin } from "/tournaments/js/services.js";
import { cropFromInput } from "/tournaments/js/cropper.js";
import {
  INVITE_ROLE,
  ensureProfile,
  isSquadAdmin,
  joinSquad,
  listMembers,
  loadInvite,
  loadSquad,
  squadUrl,
} from "/tournaments/js/squads.js";
import {
  avatarHtml,
  esc,
  hideLoader,
  isGoogleUser,
  renderNav,
  showLoader,
  signInGoogle,
  teamBadge,
  waitForUser,
} from "/tournaments/js/ui.js";

const root = document.getElementById("tnRoot");
const $ = (sel) => root.querySelector(sel);
const TOKEN = new URLSearchParams(location.search).get("t") || "";

const state = { user: null, invite: null, squad: null, members: [], profile: null };

function alertBox(msg, kind = "danger") {
  const el = document.getElementById("tnAlert");
  el.className = `alert alert-${kind}`;
  el.textContent = msg;
  el.classList.toggle("d-none", !msg);
}

const wrap = (inner) => `<div class="mx-auto mt-2 d-grid gap-3" style="max-width:560px">${inner}</div>`;

// Banner del equipo que invita
function teamBanner() {
  const s = state.squad;
  const admin = state.invite.role === INVITE_ROLE.ADMIN;
  return `
    <section class="tn-banner">
      <div class="tn-banner__top"></div>
      <div class="tn-banner__body text-center">
        <div class="d-flex justify-content-center mb-2">${teamBadge(s, 104)}</div>
        <div class="small ev-muted">${esc(admin ? EX.jnInvitedAdmin : EX.jnInvitedPlayer)}</div>
        <h1 class="h3 fw-bold mb-1">${esc(s.name)}</h1>
        <div class="small ev-muted">${esc([s.city, state.members.length ? exf(EX.jnTeamPlayers, { n: state.members.length }) : ""].filter(Boolean).join(" · "))}</div>
      </div>
    </section>`;
}

function renderSignIn() {
  root.innerHTML = wrap(`
    ${teamBanner()}
    <section class="ev-card text-center">
      <p class="ev-muted mb-3">${esc(EX.jnSignInText)}</p>
      <button class="btn tn-btn-grad btn-lg" id="jnLogin"><i class="bi bi-google me-1"></i>${esc(EX.signIn)}</button>
    </section>`);
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
  root.innerHTML = wrap(`
    ${teamBanner()}
    <section class="ev-card text-center">
      <p class="mb-3"><i class="bi bi-check-circle-fill text-success me-1"></i>${esc(EX.jnAlready)}</p>
      <a class="btn btn-primary" href="${esc(squadUrl(state.squad.id))}">${esc(EX.jnGoToTeam)}</a>
    </section>`);
}

const photoPicker = (p) => `
  <label class="tn-photo-pick" for="jnPhoto" title="${esc(EX.pfPhotoTap)}">
    <span id="jnPhotoPrev">${avatarHtml(p, 96)}</span>
    <span class="tn-photo-pick__badge"><i class="bi bi-camera-fill"></i></span>
    <input type="file" accept="image/*" id="jnPhoto" hidden />
  </label>`;

function renderForm() {
  const p = state.profile;
  const admin = state.invite.role === INVITE_ROLE.ADMIN;
  root.innerHTML = wrap(`
    ${teamBanner()}
    <form id="jnForm" class="ev-card d-grid gap-3" novalidate>
      <h2 class="h6 fw-bold mb-0">${esc(EX.jnStep1)}</h2>
      <div class="d-flex align-items-center gap-3">
        ${photoPicker(p)}
        <div>
          <div class="fw-semibold">${esc(EX.pfPhoto)}<span class="tn-optional">${esc(EX.pfOptional)}</span></div>
          <div class="small ev-muted">${esc(EX.pfPhotoTap)}</div>
          <button type="button" class="btn btn-sm btn-link text-danger p-0 ${p.photoURL ? "" : "d-none"}" id="jnPhotoDel">${esc(EX.pfPhotoRemove)}</button>
        </div>
      </div>
      <div><label class="form-label small" for="jnName">${esc(EX.pfName)}</label><input class="form-control form-control-lg" id="jnName" value="${esc(p.name || "")}" required autocomplete="name" /></div>
      <div class="row g-2">
        <div class="col-6"><label class="form-label small" for="jnNumber">${esc(EX.playerNumber)}<span class="tn-optional">${esc(EX.pfOptional)}</span></label><input class="form-control form-control-lg" id="jnNumber" type="number" min="0" max="999" inputmode="numeric" value="${esc(p.number ?? "")}" /></div>
        <div class="col-6">
          <label class="form-label small" for="jnGender">${esc(EX.pfGender)}</label>
          <select class="form-select form-select-lg" id="jnGender" required>
            <option value="">—</option>
            <option value="F" ${p.gender === "F" ? "selected" : ""}>${esc(EX.pfGenderF)}</option>
            <option value="M" ${p.gender === "M" ? "selected" : ""}>${esc(EX.pfGenderM)}</option>
          </select>
        </div>
      </div>
      ${admin ? `
        <div class="form-check form-switch">
          <input class="form-check-input" type="checkbox" id="jnAsPlayer" checked />
          <label class="form-check-label" for="jnAsPlayer">${esc(EX.jnAlsoPlay)}</label>
        </div>` : ""}
      <button class="btn tn-btn-grad btn-lg" type="submit"><i class="bi bi-person-check me-1"></i>${esc(exf(EX.jnJoin, { team: state.squad.name }))}</button>
      <div class="form-text text-center m-0">${esc(EX.jnPrivacy)}</div>
    </form>`);

  const refreshPhoto = () => {
    $("#jnPhotoPrev").innerHTML = avatarHtml({ ...state.profile, name: $("#jnName").value }, 96);
    $("#jnPhotoDel").classList.toggle("d-none", !state.profile.photoURL);
  };
  $("#jnPhoto").onchange = async (ev) => {
    try {
      const photo = await cropFromInput(ev.target, { aspect: 1, round: true, width: 256, maxChars: 120000, title: EX.cropPhoto });
      if (!photo) return;
      state.profile.photoURL = photo;
      refreshPhoto();
    } catch {
      alertBox(EX.imageBad, "warning");
    }
  };
  $("#jnPhotoDel").onclick = () => {
    state.profile.photoURL = "";
    refreshPhoto();
  };
  // las iniciales del avatar siguen al nombre mientras no haya foto
  $("#jnName").oninput = () => {
    if (!state.profile.photoURL) refreshPhoto();
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
      root.innerHTML = wrap(`<div class="ev-card text-center py-4"><div class="display-6">🔗</div><p class="mb-0">${esc(EX.jnInvalid)}</p></div>`);
      return;
    }
    state.members = await listMembers(state.squad.id).catch(() => []);
    if (!state.user) return renderSignIn();
    const inRoster = state.members.some((m) => m.id === state.user.uid);
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
