// /tournaments/js/waiver.js
// Formulario de exención del torneo (?e=<evento>): cada jugador del roster lo firma desde su cuenta.
import { EX, exf } from "/tournaments/js/strings.js";
import { listMyHatEntries, listTeams, loadEvent, loadMyWaiver, loadPublicEventBySlug, signWaiver, waiverOn } from "/tournaments/js/services.js";
import { esc, eventUrl, fmtWhen, hideLoader, isGoogleUser, renderNav, showLoader, signInGoogle, teamBadge, toMillis, waitForUser } from "/tournaments/js/ui.js";

const root = document.getElementById("tnRoot");
const EK = new URLSearchParams(location.search).get("e") || "";
const state = { user: null, event: null, teams: [], mine: null, hat: [] };

const alertBox = (msg, kind = "danger") => {
  const el = document.getElementById("tnAlert");
  el.className = `alert alert-${kind}`;
  el.textContent = msg;
  el.classList.toggle("d-none", !msg);
};
const wrap = (inner) => `<div class="mx-auto d-grid gap-3" style="max-width:680px">${inner}</div>`;
const message = (icon, text) => (root.innerHTML = wrap(`<div class="ev-card text-center py-5"><div class="display-6 mb-2">${icon}</div><p class="mb-0">${esc(text)}</p></div>`));

// menor de edad a la fecha de inicio del torneo
function isMinor(birth) {
  if (!birth) return false;
  const ref = new Date(`${state.event.startDate || new Date().toISOString().slice(0, 10)}T12:00`);
  const b = new Date(`${birth}T12:00`);
  let age = ref.getFullYear() - b.getFullYear();
  if (ref.getMonth() < b.getMonth() || (ref.getMonth() === b.getMonth() && ref.getDate() < b.getDate())) age--;
  return age < 18;
}

function render() {
  const e = state.event;
  const w = e.waiver;
  const myTeams = state.teams.filter((t) => (t.players || []).some((p) => p.uid === state.user.uid));
  // hat: quien está en el pool firma aunque todavía no tenga equipo
  if (!myTeams.length && !state.hat.length) return message("🔒", EX.waiverNotInRoster);
  const team = myTeams[0] || { id: "", name: EX.hatWaiverTeam };
  const prev = state.mine;
  const current = prev && prev.version === w.version;
  const val = (k, d = "") => esc(prev?.[k] ?? d);
  root.innerHTML = wrap(`
    <section class="ev-hero">
      <div class="small opacity-75"><a class="text-white text-decoration-none" href="${esc(eventUrl(e))}">${esc(e.name || "")}</a></div>
      <h1>${esc(w.title || EX.waiverPageTitle)}</h1>
      <div class="ev-hero__meta"><span class="d-inline-flex align-items-center gap-1">${teamBadge(team, 20)} ${esc(exf(EX.waiverAs, { team: team.name }))}</span></div>
    </section>
    ${current ? `<div class="alert alert-success mb-0"><i class="bi bi-check-circle-fill me-1"></i>${esc(exf(EX.waiverDone, { date: fmtWhen(prev.signedAt, { day: "numeric", month: "long", year: "numeric" }) }))}</div>`
      : prev ? `<div class="alert alert-warning mb-0">${esc(EX.waiverOutdated)}</div>` : ""}
    <form id="wvForm" class="ev-card d-grid gap-3">
      <div class="tn-waiver-text">${esc(w.text)}</div>
      ${w.askBirth ? `<div><label class="form-label small" for="wvBirth">${esc(EX.waiverBirth)}</label><input class="form-control" type="date" id="wvBirth" value="${val("birthDate")}" required /></div>` : ""}
      <div id="wvGuardianWrap" class="${isMinor(prev?.birthDate) ? "" : "d-none"}">
        <div class="alert alert-info py-2 small mb-2">${esc(EX.waiverMinor)}</div>
        <label class="form-label small" for="wvGuardian">${esc(EX.waiverGuardian)}</label><input class="form-control" id="wvGuardian" value="${val("guardianName")}" />
      </div>
      ${w.askEmergency ? `
        <div class="row g-2">
          <div class="col-12 col-md-7"><label class="form-label small" for="wvEmName">${esc(EX.waiverEmergencyName)}</label><input class="form-control" id="wvEmName" value="${val("emergencyName")}" required /></div>
          <div class="col-12 col-md-5"><label class="form-label small" for="wvEmPhone">${esc(EX.waiverEmergencyPhone)}</label><input class="form-control" type="tel" id="wvEmPhone" value="${val("emergencyPhone")}" required /></div>
        </div>` : ""}
      ${w.askMedical ? `<div><label class="form-label small" for="wvMed">${esc(EX.waiverMedical)}</label><textarea class="form-control" id="wvMed" rows="2" placeholder="${esc(EX.waiverMedicalPh)}">${val("medical")}</textarea></div>` : ""}
      <div><label class="form-label small" for="wvSig">${esc(EX.waiverSignature)}</label><input class="form-control tn-signature" id="wvSig" value="${val("signature", state.user.displayName || "")}" required /></div>
      <div class="form-check"><input class="form-check-input" type="checkbox" id="wvAccept" ${current ? "checked" : ""} /><label class="form-check-label fw-semibold" for="wvAccept">${esc(EX.waiverAccept)}</label></div>
      <div class="d-flex justify-content-end"><button class="btn tn-btn-grad btn-lg px-4" type="submit"><i class="bi bi-pen me-1"></i>${esc(current ? EX.waiverResign : EX.waiverSubmit)}</button></div>
    </form>`);

  const birth = root.querySelector("#wvBirth");
  birth?.addEventListener("change", () => root.querySelector("#wvGuardianWrap").classList.toggle("d-none", !isMinor(birth.value)));

  root.querySelector("#wvForm").onsubmit = async (ev) => {
    ev.preventDefault();
    const v = (id) => root.querySelector(`#${id}`)?.value.trim() || "";
    const minor = isMinor(v("wvBirth"));
    const need = [v("wvSig"), w.askBirth ? v("wvBirth") : "x", w.askEmergency ? v("wvEmName") : "x", w.askEmergency ? v("wvEmPhone") : "x", minor ? v("wvGuardian") : "x"];
    if (need.some((x) => !x) || !root.querySelector("#wvAccept").checked) return alertBox(EX.waiverMissing, "warning");
    showLoader();
    try {
      const data = {
        teamId: team.id, teamName: team.name || "", version: w.version || "",
        signature: v("wvSig"), birthDate: v("wvBirth"), guardianName: minor ? v("wvGuardian") : "",
        emergencyName: v("wvEmName"), emergencyPhone: v("wvEmPhone"), medical: v("wvMed"),
        title: w.title || "", text: w.text || "", userAgent: navigator.userAgent.slice(0, 200),
      };
      await signWaiver(e.id, state.user, data);
      state.mine = { ...data, signedAt: new Date() };
      alertBox("");
      render();
      window.scrollTo(0, 0);
    } catch (err) {
      console.error(err);
      alertBox(`${EX.error} ${err?.code || ""}`);
    } finally {
      hideLoader();
    }
  };
}

(async function init() {
  showLoader();
  try {
    const user = await waitForUser();
    state.user = isGoogleUser(user) ? user : null;
    renderNav({ active: "team", user });
    const event = (await loadEvent(EK).catch(() => null)) || (await loadPublicEventBySlug(EK).catch(() => null));
    if (!event) return message("🔍", EX.eventNotFound);
    state.event = event;
    if (!waiverOn(event)) return message("📄", EX.waiverOff);
    if (!state.user) {
      root.innerHTML = wrap(`<div class="ev-card text-center py-5"><div class="display-6 mb-2">📝</div><h1 class="h4 fw-bold">${esc(event.waiver.title || EX.waiverPageTitle)}</h1><p class="ev-muted">${esc(EX.waiverSignIn)}</p><button class="btn tn-btn-grad" id="wvLogin"><i class="bi bi-google me-1"></i>${esc(EX.signIn)}</button></div>`);
      root.querySelector("#wvLogin").onclick = async () => { await signInGoogle().catch(() => {}); location.reload(); };
      return;
    }
    const [teams, mine, hat] = await Promise.all([
      listTeams(event.id),
      loadMyWaiver(event.id, state.user.uid).catch(() => null),
      event.type === "hat" ? listMyHatEntries(event.id, state.user.uid).catch(() => []) : [],
    ]);
    state.teams = teams;
    state.hat = hat;

    state.mine = mine;
    render();
  } catch (err) {
    console.error(err);
    alertBox(`${EX.error} ${err?.code || err?.message || ""}`);
  } finally {
    hideLoader();
  }
})();
