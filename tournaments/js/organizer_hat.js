// /tournaments/js/organizer_hat.js
// Pestaña Hat del organizador: pool de jugadores por división (puntajes, pagos, camisetas, lista de espera),
// cantidad de equipos sugerida y, después, armado de equipos (hat.js), cambios y publicación por división.
// Los puntajes son privados: se leen de hat_ratings y nunca se escriben en los equipos.
import { EX, exf } from "/tournaments/js/strings.js";
import { HAT_QUESTIONS } from "/tournaments/js/hat-config.js";
import { HAT_STATUS, ageOn, ageRefOf, balanceGap, eligibility, generateTeams, jerseyTotals, mutualPairs, normalize, rawScore, suggestTeamCount, teamStats } from "/tournaments/js/hat.js";
import { JERSEY_CUTS } from "/tournaments/js/divisions-config.js";
import { eventRules } from "/tournaments/js/model.js";
import {
  PAYMENT,
  decideHatPayment,
  fmtMoney,
  listHatPayments,
  listHatPlayers,
  listHatRatings,
  loadHatDraft,
  moveHatDivision,
  publishHatDivision,
  saveEvent,
  saveHatDraft,
  setHatNotes,
  setHatOrganizerScore,
  setHatPaymentStatus,
  setHatStatus,
} from "/tournaments/js/services.js";
import { avatarHtml, esc, paymentChip } from "/tournaments/js/ui.js";
import { exportSheets } from "/tournaments/js/export.js";

// estado de la pestaña (se conserva al cambiar de pestaña dentro del organizador)
// view: "pool" | "teams"; drafts: borradores por división; sel: jugador elegido (tocar → tocar destino)
const hs = { eventId: "", divisionId: "", pool: [], ratings: new Map(), payments: new Map(), q: "", sort: "score", open: "", view: "pool", drafts: new Map(), sel: "", drag: "" };
let C = null; // contexto del organizador: { state, run, alertBox, divisions, fields, renderEvent }
let TAB = null;

const ev = () => C.state.event;
const divisions = () => C.divisions();
const divById = (id) => divisions().find((d) => d.id === id) || null;
const feeMode = () => ev().fees?.playerMode || "free";
const feeFor = (div) => (feeMode() === "free" ? 0 : Number(div?.hat?.fee ?? ev().fees?.player) || 0);
const cutLabel = (id) => JERSEY_CUTS.find((c) => c.id === id)?.label || id || "?";

export async function renderHat(tab, ctx) {
  C = ctx;
  TAB = tab;
  if (hs.eventId !== ev().id) Object.assign(hs, { eventId: ev().id, divisionId: "", q: "", open: "", view: "pool", drafts: new Map(), sel: "" });
  if (!divById(hs.divisionId)) hs.divisionId = divisions()[0].id;
  await load();
  paint();
}

async function load() {
  const eid = ev().id;
  const [pool, ratings, payments] = await Promise.all([listHatPlayers(eid), listHatRatings(eid).catch(() => []), listHatPayments(eid).catch(() => [])]);
  hs.pool = pool;
  hs.ratings = new Map(ratings.map((r) => [r.id, r]));
  hs.payments = new Map(payments.map((p) => [p.id, p]));
  await loadDraft();
}

async function loadDraft() {
  if (!hs.drafts.has(hs.divisionId)) hs.drafts.set(hs.divisionId, await loadHatDraft(ev().id, hs.divisionId));
}

/* =========================
   Datos derivados
========================= */
// jugadores de una división con su puntaje (normalizado sobre los que no están en lista de espera), edad y elegibilidad
function divPlayers(divId) {
  const div = divById(divId);
  const entries = hs.pool.filter((p) => p.divisionId === divId);
  const pairs = mutualPairs(entries);
  const byUid = new Map(hs.pool.map((p) => [`${p.uid}__${p.divisionId}`, p]));
  const rows = entries.map((p) => {
    const r = hs.ratings.get(p.uid) || {};
    const birthDate = r.birthDate || "";
    const mate = p.teammateUid ? byUid.get(`${p.teammateUid}__${divId}`) || null : null;
    const mateElsewhere = p.teammateUid && !mate ? hs.pool.find((x) => x.uid === p.teammateUid) || null : null;
    return {
      ...p,
      rating: r,
      raw: rawScore(r),
      rated: r.selfScore !== undefined || r.organizerScore !== undefined,
      birthDate,
      age: ageOn(birthDate, ageRefOf(div, ev())),
      el: eligibility(div, { gender: p.gender, birthDate }, ev()),
      pairUid: pairs.get(p.uid) || "",
      mate,
      mateElsewhere,
    };
  });
  const active = normalize(rows.filter((p) => p.status !== HAT_STATUS.WAITLIST));
  const scoreOf = new Map(active.map((p) => [p.id, p.score]));
  return rows.map((p) => ({ ...p, score: scoreOf.has(p.id) ? scoreOf.get(p.id) : null }));
}

const activeOf = (rows) => rows.filter((p) => p.status !== HAT_STATUS.WAITLIST);

function summary(divId) {
  const rows = divPlayers(divId);
  const active = activeOf(rows);
  const fee = feeFor(divById(divId));
  return {
    rows,
    total: active.length,
    f: active.filter((p) => p.gender === "F").length,
    m: active.filter((p) => p.gender === "M").length,
    waitlist: rows.length - active.length,
    unpaid: fee ? active.filter((p) => p.paymentStatus !== PAYMENT.APPROVED).length : 0,
    ineligible: rows.filter((p) => !p.el.ok).length,
  };
}

// equipos de la división: lo que eligió el organizador o la sugerencia
const teamCountOf = (div, players) => Number(div?.hat?.teamCount) || suggestTeamCount(players, eventRules(ev()).playersOnField).n;

/* =========================
   Pantalla
========================= */
function paint() {
  const div = divById(hs.divisionId);
  const s = summary(div.id);
  const fee = feeFor(div);
  TAB.innerHTML = `
    ${divisions().length > 1 ? `
      <div class="pa-seg hat-divs mb-3">
        ${divisions().map((d) => `<button type="button" class="btn ${d.id === div.id ? "is-on" : ""}" data-hat-div="${esc(d.id)}">${esc(d.name)} <span class="hat-divs__n">${activeOf(hs.pool.filter((p) => p.divisionId === d.id)).length}</span></button>`).join("")}
      </div>` : ""}
    <div class="ev-info-grid hat-summary mb-3">
      ${[
        ["people", EX.hatSumPlayers, `${s.total}${Number(div.hat?.capacity) ? ` / ${div.hat.capacity}` : ""}`],
        ["gender-ambiguous", "F / M", `${s.f} / ${s.m}`],
        ["hourglass-split", EX.hatSumWaitlist, s.waitlist],
        ...(fee ? [["cash-coin", EX.hatSumUnpaid, s.unpaid]] : []),
        ...(s.ineligible ? [["exclamation-triangle", EX.hatSumIneligible, s.ineligible]] : []),
      ].map(([icon, label, value]) => `<div class="ev-info"><i class="bi bi-${icon}"></i><div><div class="ev-info__label">${esc(label)}</div><div class="ev-info__value">${esc(value)}</div></div></div>`).join("")}
    </div>
    <div class="pa-seg mb-3">
      <button type="button" class="btn ${hs.view === "pool" ? "is-on" : ""}" data-hat-view="pool"><i class="bi bi-people me-1"></i>${esc(EX.hatViewPool)}</button>
      <button type="button" class="btn ${hs.view === "teams" ? "is-on" : ""}" data-hat-view="teams"><i class="bi bi-grid-3x3-gap me-1"></i>${esc(EX.hatViewTeams)}</button>
    </div>
    ${warningsHtml(s.rows)}
    ${teamCountHtml(div, s.total)}
    ${hs.view === "teams" ? boardHtml(div) : `${poolHtml(div, s.rows)}${jerseysHtml(div)}`}`;
  bind();
}

function warningsHtml(rows) {
  const items = [];
  rows.filter((p) => !p.el.ok).forEach((p) => {
    const why = p.el.code === "birth" ? EX.hatWarnNoBirth : p.el.code === "gender" ? EX.hatWarnGender : exf(p.el.code === "min" ? EX.hatWarnMin : EX.hatWarnMax, { age: p.age ?? "?", n: p.el.code === "min" ? p.el.min : p.el.max });
    items.push(`<b>${esc(p.name)}</b>: ${esc(why)}`);
  });
  rows.filter((p) => p.mateElsewhere).forEach((p) => {
    items.push(esc(exf(EX.hatWarnPairMoved, { name: p.name, mate: p.mateElsewhere.name, div: divById(p.mateElsewhere.divisionId)?.name || "" })));
  });
  if (!items.length) return "";
  return `<div class="alert alert-warning small py-2"><i class="bi bi-exclamation-triangle me-1"></i>${items.join("<br>")}</div>`;
}

// cantidad de equipos de la división + resumen del torneo (las canchas son compartidas)
function teamCountHtml(div, players) {
  const rules = eventRules(ev());
  const sug = suggestTeamCount(players, rules.playersOnField);
  const fieldsN = C.fields().length;
  const current = Number(div.hat?.teamCount) || "";
  const totalTeams = divisions().reduce((n, d) => n + teamCountOf(d, activeOf(hs.pool.filter((p) => p.divisionId === d.id)).length), 0);
  const atOnce = Math.min(fieldsN, Math.floor(totalTeams / 2));
  const resting = Math.max(0, totalTeams - atOnce * 2);
  const fieldsTxt = fieldsN === 1 ? EX.hatField1 : exf(EX.hatFields, { n: fieldsN });
  const gamesTxt = atOnce === 1 ? EX.hatGame1 : exf(EX.hatGames, { n: atOnce });
  return `
    <section class="ev-card mb-3">
      <div class="d-flex flex-wrap align-items-end gap-2">
        <div>
          <label class="form-label small mb-1" for="hatTeamCount">${esc(EX.hatTeamCount)}</label>
          <div class="input-group input-group-sm" style="max-width:12rem">
            <input class="form-control" type="number" min="2" max="64" id="hatTeamCount" value="${esc(current)}" placeholder="${esc(sug.n)}" />
            <button class="btn btn-outline-primary" type="button" id="hatTeamCountSave">${esc(EX.save)}</button>
          </div>
        </div>
        <div class="small flex-grow-1">
          <div><i class="bi bi-lightbulb me-1 text-warning"></i>${esc(exf(EX.hatSuggestLine, { players, mode: rules.mode === "other" ? `${rules.playersOnField}v${rules.playersOnField}` : rules.mode, fields: fieldsTxt, n: sug.n, per: sug.perTeam }))}</div>
          <div class="ev-muted">${esc(exf(EX.hatFieldsLine, { teams: totalTeams, fields: fieldsTxt, atOnce: gamesTxt, resting }))}</div>
        </div>
      </div>
    </section>`;
}

const POS = Object.fromEntries((HAT_QUESTIONS.find((q) => q.id === "position")?.options || []).map((o) => [o.id, o.label]));

function poolHtml(div, rows) {
  const q = hs.q.trim().toLowerCase();
  const fee = feeFor(div);
  const sorters = {
    score: (a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
    age: (a, b) => (b.age ?? -1) - (a.age ?? -1),
    status: (a, b) => a.status.localeCompare(b.status) || a.name.localeCompare(b.name),
  };
  const list = rows.filter((p) => !q || `${p.name} ${p.number ?? ""}`.toLowerCase().includes(q)).sort(sorters[hs.sort] || sorters.score);
  const otherDivs = divisions().filter((d) => d.id !== div.id);
  const th = (k, label, cls = "") => `<th class="${cls} ${k ? "st-sort" : ""} ${hs.sort === k ? "is-on" : ""}" ${k ? `data-hat-sort="${k}"` : ""}>${esc(label)}</th>`;
  const mateCell = (p) => {
    if (!p.teammateUid) return "";
    if (p.pairUid) return `<span class="ev-chip ev-chip--ok" title="${esc(EX.hatPairMutual)}"><i class="bi bi-arrow-left-right me-1"></i>${esc(p.mate?.name || "")}</span>`;
    if (p.mateElsewhere) return `<span class="ev-chip ev-chip--alert" title="${esc(EX.hatPairOtherDiv)}"><i class="bi bi-exclamation-triangle me-1"></i>${esc(p.mateElsewhere.name)}</span>`;
    return `<span class="small ev-muted" title="${esc(EX.hatPairOneWay)}"><i class="bi bi-arrow-right me-1"></i>${esc(p.mate?.name || "—")}</span>`;
  };
  const statusCell = (p) => {
    if (p.status === HAT_STATUS.ASSIGNED) return `<span class="ev-chip ev-chip--ok">${esc(EX.hatStatusAssigned)}</span>`;
    if (p.status === HAT_STATUS.WAITLIST) return `<button class="btn btn-sm btn-outline-success" data-hat-status="${esc(p.id)}" data-to="${HAT_STATUS.WAITING}">${esc(EX.hatPromote)}</button>`;
    return `<button class="btn btn-sm btn-light" data-hat-status="${esc(p.id)}" data-to="${HAT_STATUS.WAITLIST}" title="${esc(EX.hatToWaitlistHint)}">${esc(EX.hatToWaitlist)}</button>`;
  };
  return `
    <section class="st-card">
      <header class="st-card__head flex-wrap">
        <div><div class="st-card__title">${esc(exf(EX.hatPoolTitle, { div: div.name }))}</div><div class="st-card__sub">${esc(EX.hatPoolPrivate)}</div></div>
        <input class="form-control form-control-sm st-search" id="hatQ" type="search" placeholder="${esc(EX.hatSearch)}" value="${esc(hs.q)}" />
      </header>
      ${rows.length ? `
      <div class="table-responsive">
        <table class="st-table hat-pool">
          <thead><tr>
            ${th("name", EX.hatColPlayer, "st-team")}
            ${th("", "F/M", "num")}
            ${th("age", EX.hatColAge, "num")}
            ${th("", EX.hatColJersey)}
            ${th("", EX.hatColPosition)}
            ${th("", EX.hatColMate)}
            ${fee ? th("", EX.hatColPay) : ""}
            ${th("", EX.hatColSelf, "num")}
            ${th("", EX.hatColOrg, "num")}
            ${th("score", EX.hatColScore, "num")}
            ${th("status", EX.hatColStatus)}
          </tr></thead>
          <tbody>${list.map((p) => `
            <tr class="${p.status === HAT_STATUS.WAITLIST ? "hat-row--wait" : ""} ${!p.el.ok ? "hat-row--bad" : ""}">
              <td class="st-team">
                <button type="button" class="btn btn-link p-0 text-reset text-decoration-none d-flex align-items-center gap-2 text-start" data-hat-open="${esc(p.id)}">
                  ${avatarHtml(p, 30)}
                  <span class="min-w-0">
                    <span class="st-team__name d-block">${esc(p.name)}${p.number !== null && p.number !== undefined ? ` <span class="ev-muted fw-normal">#${esc(p.number)}</span>` : ""}${!p.el.ok ? ` <i class="bi bi-exclamation-triangle-fill text-warning" title="${esc(EX.hatIneligible)}"></i>` : ""}</span>
                    ${p.movedFrom ? `<span class="small ev-muted d-block">${esc(exf(EX.hatMovedFrom, { div: divById(p.movedFrom)?.name || p.movedFrom }))}</span>` : ""}
                  </span>
                </button>
              </td>
              <td class="num">${esc(p.gender || "?")}</td>
              <td class="num">${p.age ?? "—"}</td>
              <td class="text-nowrap">${esc(p.jersey?.size || "?")} · ${esc(cutLabel(p.jersey?.cut))}</td>
              <td class="small">${esc(POS[p.position] || "—")}</td>
              <td>${mateCell(p)}</td>
              ${fee ? `<td class="text-nowrap">${paymentChip(p)}${p.paymentStatus === PAYMENT.SUBMITTED ? ` <button class="btn btn-sm btn-link p-0" data-hat-open="${esc(p.id)}">${esc(EX.hatSeeProof)}</button>` : ""}</td>` : ""}
              <td class="num ev-muted">${p.rating.selfScore !== undefined ? Math.round(p.rating.selfScore) : "—"}</td>
              <td class="num"><input class="form-control form-control-sm hat-org-score" type="number" min="0" max="100" step="1" data-hat-score="${esc(p.uid)}" value="${esc(p.rating.organizerScore ?? "")}" placeholder="—" aria-label="${esc(EX.hatColOrg)}" /></td>
              <td class="num fw-bold">${p.score ?? "—"}</td>
              <td class="text-nowrap">
                ${statusCell(p)}
                ${otherDivs.length && p.status !== HAT_STATUS.ASSIGNED ? `
                  <select class="form-select form-select-sm d-inline-block w-auto" data-hat-move="${esc(p.id)}" aria-label="${esc(EX.hatMoveTo)}">
                    <option value="">${esc(EX.hatMoveTo)}</option>
                    ${otherDivs.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join("")}
                  </select>` : ""}
              </td>
            </tr>
            ${hs.open === p.id ? `<tr class="hat-detail"><td colspan="${fee ? 11 : 10}">${detailHtml(p)}</td></tr>` : ""}`).join("")}
          </tbody>
        </table>
      </div>` : `<div class="p-3 ev-muted">${esc(EX.hatPoolEmpty)}</div>`}
    </section>`;
}

// detalle del jugador: respuestas, notas y comprobante de pago
function detailHtml(p) {
  const answers = p.rating.answers || {};
  const pay = hs.payments.get(p.id);
  return `
    <div class="row g-3">
      <div class="col-12 col-lg-6">
        <div class="small fw-bold mb-1">${esc(EX.hatAnswers)}</div>
        ${p.rated ? `<ul class="small mb-0 ps-3">${HAT_QUESTIONS.map((q) => `<li><span class="ev-muted">${esc(q.label)}</span> ${esc(q.options.find((o) => o.id === answers[q.id])?.label || "—")}</li>`).join("")}</ul>` : `<div class="small ev-muted">${esc(EX.hatNoAnswers)}</div>`}
        <label class="form-label small fw-bold mt-2 mb-1" for="hatNotes">${esc(EX.hatNotes)}</label>
        <textarea class="form-control form-control-sm" id="hatNotes" data-hat-notes="${esc(p.uid)}" rows="2">${esc(p.rating.notes || "")}</textarea>
      </div>
      <div class="col-12 col-lg-6">
        ${pay?.proof ? `
          <div class="small fw-bold mb-1">${esc(EX.payProof)}</div>
          <img class="tn-proof__img mb-2" src="${esc(pay.proof)}" alt="${esc(EX.payProof)}" />` : ""}
        ${feeFor(divById(p.divisionId)) ? `
          <div class="d-flex gap-2 flex-wrap">
            ${p.paymentStatus !== PAYMENT.APPROVED ? `<button class="btn btn-sm btn-success" data-hat-pay="${esc(p.id)}" data-ok="1"><i class="bi bi-check-lg me-1"></i>${esc(pay?.proof ? EX.payApprove : EX.hatMarkPaid)}</button>` : ""}
            ${pay?.proof && p.paymentStatus === PAYMENT.SUBMITTED ? `<button class="btn btn-sm btn-outline-danger" data-hat-pay="${esc(p.id)}">${esc(EX.payReject)}</button>` : ""}
            ${p.paymentStatus === PAYMENT.APPROVED ? `<button class="btn btn-sm btn-light" data-hat-unpay="${esc(p.id)}">${esc(EX.hatUnmarkPaid)}</button>` : ""}
          </div>` : ""}
      </div>
    </div>`;
}

// camisetas: por talla y corte, en la división y en todo el torneo (sin la lista de espera)
function jerseysHtml(div) {
  const table = (rows) => {
    const totals = jerseyTotals(rows);
    if (!totals.length) return `<div class="small ev-muted">—</div>`;
    return `
      <table class="table table-sm mb-0 hat-jerseys">
        <tbody>${totals.map((t) => `<tr><td>${esc(t.size)}</td><td>${esc(cutLabel(t.cut))}</td><td class="text-end fw-bold">${t.n}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td colspan="2">${esc(EX.hatTotal)}</td><td class="text-end fw-bold">${rows.length}</td></tr></tfoot>
      </table>`;
  };
  const inDiv = activeOf(hs.pool.filter((p) => p.divisionId === div.id));
  const all = activeOf(hs.pool);
  return `
    <section class="ev-card mt-3">
      <h2 class="h6 mb-2"><i class="bi bi-shirt me-1"></i>${esc(EX.hatJerseys)}</h2>
      <div class="row g-3">
        <div class="col-12 col-md-6"><div class="small fw-bold mb-1">${esc(div.name)}</div>${table(inDiv)}</div>
        ${divisions().length > 1 ? `<div class="col-12 col-md-6"><div class="small fw-bold mb-1">${esc(EX.hatWholeEvent)}</div>${table(all)}</div>` : ""}
      </div>
    </section>`;
}

/* =========================
   Acciones
========================= */
const act = (fn, msg = EX.saved) => C.run(async () => {
  await fn();
  await load();
  if (msg) C.alertBox(msg);
  paint();
});

function bind() {
  TAB.onclick = (e) => {
    const t = e.target;
    const d = t.closest("[data-hat-div]");
    if (d) {
      saveDraftNow();
      hs.divisionId = d.dataset.hatDiv;
      hs.open = "";
      hs.sel = "";
      return C.run(async () => {
        await loadDraft();
        paint();
      });
    }
    const v = t.closest("[data-hat-view]");
    if (v) {
      hs.view = v.dataset.hatView;
      hs.sel = "";
      return paint();
    }
    // armado de equipos: generar, publicar, camisetas, tocar jugador → tocar destino
    const gen = t.closest("[data-hat-gen]");
    if (gen) {
      if (gen.dataset.hatGen === "new" && !confirm(EX.hatRegenerateConfirm)) return;
      return generate(gen.dataset.hatGen === "new" ? Math.floor(Math.random() * 1e9) : 1);
    }
    if (t.closest("[data-hat-publish]")) return publish();
    if (t.closest("[data-hat-jcopy]") || t.closest("[data-hat-jxlsx]")) {
      const div = divById(hs.divisionId);
      const { teams } = boardTeams(draftOf(), boardPlayers());
      if (t.closest("[data-hat-jxlsx]")) {
        const { filename, sheets } = jerseySheets(div, teams);
        return C.run(() => exportSheets(filename, sheets));
      }
      return navigator.clipboard.writeText(jerseyText(div, teams)).then(() => C.alertBox(EX.hatCopied), () => C.alertBox(EX.error, "danger"));
    }
    const chip = t.closest("[data-hat-chip]");
    if (chip) {
      const uid = chip.dataset.hatChip;
      if (hs.sel && hs.sel !== uid) return place(hs.sel, { swap: uid });
      hs.sel = hs.sel === uid ? "" : uid;
      return paint();
    }
    const team = t.closest("[data-hat-team]");
    if (team && hs.sel && !t.closest("input")) return place(hs.sel, { to: team.dataset.hatTeam });
    const s = t.closest("[data-hat-sort]");
    if (s) {
      hs.sort = s.dataset.hatSort;
      return paint();
    }
    const o = t.closest("[data-hat-open]");
    if (o) {
      hs.open = hs.open === o.dataset.hatOpen ? "" : o.dataset.hatOpen;
      return paint();
    }
    const st = t.closest("[data-hat-status]");
    if (st) return act(() => setHatStatus(ev().id, st.dataset.hatStatus, st.dataset.to));
    const pay = t.closest("[data-hat-pay]");
    if (pay) {
      const entry = hs.pool.find((p) => p.id === pay.dataset.hatPay);
      const ok = !!pay.dataset.ok;
      const note = ok ? "" : prompt(EX.payRejectNote, "");
      if (note === null) return;
      // sin comprobante (efectivo, transferencia avisada): solo se marca pagado
      if (ok && !hs.payments.get(entry.id)?.proof) return act(() => setHatPaymentStatus(ev().id, entry, PAYMENT.APPROVED));
      return act(() => decideHatPayment(ev().id, entry, ok, note || ""));
    }
    const unpay = t.closest("[data-hat-unpay]");
    if (unpay) {
      const entry = hs.pool.find((p) => p.id === unpay.dataset.hatUnpay);
      return act(() => setHatPaymentStatus(ev().id, entry, hs.payments.get(entry.id)?.proof ? PAYMENT.SUBMITTED : PAYMENT.NONE));
    }
    if (t.id === "hatTeamCountSave") {
      const n = Math.max(0, Math.round(Number(TAB.querySelector("#hatTeamCount").value) || 0));
      const divs = divisions().map((x) => (x.id === hs.divisionId ? { ...x, hat: { ...(x.hat || {}), teamCount: n || null } } : x));
      return act(async () => {
        await saveEvent(ev().id, { divisions: divs });
        ev().divisions = divs;
      });
    }
  };
  TAB.onchange = (e) => {
    const t = e.target;
    if (t.dataset.hatScore !== undefined) {
      const raw = t.value.trim();
      const score = raw === "" ? null : Math.min(100, Math.max(0, Number(raw) || 0));
      return act(() => setHatOrganizerScore(ev().id, t.dataset.hatScore, score), "");
    }
    if (t.dataset.hatNotes !== undefined) return act(() => setHatNotes(ev().id, t.dataset.hatNotes, t.value), "");
    if (t.dataset.hatTname !== undefined || t.dataset.hatTcolor !== undefined) {
      const d = draftOf();
      const key = t.dataset.hatTname ?? t.dataset.hatTcolor;
      const team = d?.teams.find((x) => x.key === key);
      if (!team) return;
      if (t.dataset.hatTname !== undefined) team.name = t.value.trim() || team.name;
      else team.color = t.value;
      d.dirty = true;
      queueSave();
      return paint();
    }
    if (t.dataset.hatMove !== undefined && t.value) {
      const entry = hs.pool.find((p) => p.id === t.dataset.hatMove);
      const to = divById(t.value);
      if (!confirm(exf(EX.hatMoveConfirm, { name: entry.name, div: to.name }))) {
        t.value = "";
        return;
      }
      return act(() => moveHatDivision(ev().id, entry, to.id));
    }
  };
  TAB.oninput = (e) => {
    if (e.target.id !== "hatQ") return;
    hs.q = e.target.value;
    const pos = e.target.selectionStart;
    paint();
    const input = TAB.querySelector("#hatQ");
    input.focus();
    input.setSelectionRange(pos, pos);
  };
  // arrastrar (escritorio): soltar sobre un jugador intercambia, sobre un equipo mueve
  TAB.ondragstart = (e) => {
    const chip = e.target.closest?.("[data-hat-chip]");
    if (!chip) return;
    hs.drag = chip.dataset.hatChip;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", hs.drag);
  };
  TAB.ondragover = (e) => {
    const team = e.target.closest?.("[data-hat-team]");
    if (!hs.drag || !team) return;
    e.preventDefault();
    TAB.querySelectorAll(".hat-team.is-over").forEach((x) => x !== team && x.classList.remove("is-over"));
    team.classList.add("is-over");
  };
  TAB.ondragend = () => {
    hs.drag = "";
    TAB.querySelectorAll(".hat-team.is-over").forEach((x) => x.classList.remove("is-over"));
  };
  TAB.ondrop = (e) => {
    const team = e.target.closest?.("[data-hat-team]");
    const uid = hs.drag;
    hs.drag = "";
    if (!uid || !team) return;
    e.preventDefault();
    const over = e.target.closest("[data-hat-chip]");
    if (over && over.dataset.hatChip !== uid) return place(uid, { swap: over.dataset.hatChip });
    place(uid, { to: team.dataset.hatTeam });
  };

}

/* =========================
   Armado de equipos (borrador privado → publicar por división)
========================= */
const COLORS = ["#19473f", "#c0392b", "#2563eb", "#f59e0b", "#7c3aed", "#0891b2", "#db2777", "#65a30d", "#111827", "#ea580c", "#0d9488", "#9333ea"];
const draftOf = () => hs.drafts.get(hs.divisionId) || null;
// los del armado: todos menos la lista de espera
const boardPlayers = (divId = hs.divisionId) => activeOf(divPlayers(divId));

// el borrador al día con el pool: saca a quien se fue y deja a los nuevos en "Sin equipo"
function boardTeams(draft, players) {
  const byUid = new Map(players.map((p) => [p.uid, p]));
  const used = new Set();
  const teams = draft.teams.map((t) => ({
    ...t,
    players: t.uids.filter((u) => byUid.has(u) && !used.has(u) && used.add(u)).map((u) => byUid.get(u)),
  }));
  return { teams, loose: players.filter((p) => !used.has(p.uid)) };
}

// borrador limpio (solo uids vigentes) para guardar o publicar
function cleanDraft(d, players) {
  const { teams } = boardTeams(d, players);
  return {
    seed: d.seed,
    teams: teams.map((t) => ({ key: t.key, name: t.name, color: t.color, uids: t.players.map((p) => p.uid) })),
    teamIds: d.teamIds || {},
    publishedAt: d.publishedAt || null,
    dirty: !!d.dirty,
  };
}

let saveTimer = 0;
function saveDraftNow(divId = hs.divisionId) {
  clearTimeout(saveTimer);
  const d = hs.drafts.get(divId);
  if (!d) return Promise.resolve();
  return saveHatDraft(ev().id, divId, cleanDraft(d, boardPlayers(divId))).catch((err) => {
    console.error(err);
    C.alertBox(`${EX.error} ${err?.code || err?.message || ""}`, "danger");
  });
}
// guardado automático (con pausa) mientras el organizador hace cambios
function queueSave() {
  clearTimeout(saveTimer);
  const divId = hs.divisionId;
  saveTimer = setTimeout(() => saveDraftNow(divId), 800);
}

function generate(seed) {
  const div = divById(hs.divisionId);
  const players = boardPlayers();
  const count = teamCountOf(div, players.length);
  // balance F/M en mixto, y en open solo si hay de los dos
  const mixed = players.some((p) => p.gender === "F") && players.some((p) => p.gender === "M");
  const teams = generateTeams(players, count, { mixed, seed });
  const prev = draftOf();
  hs.drafts.set(hs.divisionId, {
    seed,
    teams: teams.map((t, i) => {
      const key = `t${i + 1}`;
      const old = prev?.teams.find((x) => x.key === key);
      return { key, name: old?.name || exf(EX.hatTeamN, { n: i + 1 }), color: old?.color || COLORS[i % COLORS.length], uids: t.map((p) => p.uid) };
    }),
    teamIds: prev?.teamIds || {},
    publishedAt: prev?.publishedAt || null,
    dirty: true,
  });
  hs.sel = "";
  saveDraftNow();
  paint();
}

// mover a un equipo (to "" = sin equipo) o intercambiar con otro jugador
function place(uid, { to = null, swap = "" } = {}) {
  const d = draftOf();
  hs.sel = "";
  if (!d || !uid) return paint();
  const ta = d.teams.find((t) => t.uids.includes(uid));
  if (swap) {
    const tb = d.teams.find((t) => t.uids.includes(swap));
    if (swap === uid || ta === tb) return paint();
    if (ta) ta.uids[ta.uids.indexOf(uid)] = swap;
    if (tb) tb.uids[tb.uids.indexOf(swap)] = uid;
  } else {
    if ((ta?.key || "") === to) return paint();
    if (ta) ta.uids = ta.uids.filter((u) => u !== uid);
    if (to) d.teams.find((t) => t.key === to)?.uids.push(uid);
  }
  d.dirty = true;
  queueSave();
  paint();
}

function boardHtml(div) {
  const players = boardPlayers();
  if (!players.length) return `<div class="ev-card ev-muted">${esc(EX.hatPoolEmpty)}</div>`;
  const d = draftOf();
  if (!d) {
    const n = teamCountOf(div, players.length);
    return `
      <section class="ev-card text-center py-4">
        <p class="mb-3">${esc(exf(EX.hatBoardIntro, { players: players.length, n }))}</p>
        <button class="btn btn-primary" type="button" data-hat-gen><i class="bi bi-shuffle me-1"></i>${esc(EX.hatGenerate)}</button>
        <div class="small ev-muted mt-2">${esc(EX.hatBoardPrivate)}</div>
      </section>`;
  }
  const { teams, loose } = boardTeams(d, players);
  const teamOf = new Map(teams.flatMap((t) => t.players.map((p) => [p.uid, t.key])));
  const gap = balanceGap(teams.map((t) => t.players));
  const gapKind = gap <= 3 ? "ok" : gap <= 8 ? "warn" : "alert";
  const isSplit = (p) => p.pairUid && teamOf.get(p.pairUid) !== teamOf.get(p.uid);
  const splits = players.filter(isSplit).length / 2;
  const published = !!d.publishedAt;
  const chip = (p) => `
      <button type="button" class="hat-chip hat-chip--${p.gender === "F" ? "f" : "m"} ${hs.sel === p.uid ? "is-sel" : ""}" draggable="true" data-hat-chip="${esc(p.uid)}">
        <span class="hat-chip__g">${esc(p.gender || "?")}</span>
        <span class="hat-chip__name">${esc(p.name)}</span>
        ${p.position === "handler" ? `<i class="bi bi-disc" title="${esc(POS.handler || "")}"></i>` : p.position === "both" ? `<i class="bi bi-disc opacity-50" title="${esc(POS.both || "")}"></i>` : ""}
        ${p.pairUid ? `<i class="bi ${isSplit(p) ? "bi-exclamation-triangle-fill text-warning" : "bi-link-45deg"}" title="${esc(exf(isSplit(p) ? EX.hatPairSplit : EX.hatPairWith, { mate: p.mate?.name || "" }))}"></i>` : ""}
        ${!p.el.ok ? `<i class="bi bi-exclamation-circle text-danger" title="${esc(EX.hatIneligible)}"></i>` : ""}
        <span class="hat-chip__score">${p.score ?? "—"}</span>
      </button>`;
  const statsLine = (list) => {
    const s = teamStats(list);
    return [
      `${s.n} ${esc(EX.hatPlayersShort)}`,
      `${s.f}F · ${s.m}M`,
      `${esc(EX.hatAvg)} <b>${s.avg}</b>`,
      `Σ ${s.total}`,
      s.avgAge !== null ? `${s.avgAge} ${esc(EX.hatYears)}` : "",
      `${s.handlers} H`,
    ].filter(Boolean).join(" · ");
  };
  return `
    <section class="ev-card mb-3">
      <div class="d-flex flex-wrap align-items-center gap-2">
        <span class="ev-chip ev-chip--${gapKind}" title="${esc(EX.hatGapHint)}"><i class="bi bi-bar-chart me-1"></i>${esc(exf(EX.hatGap, { gap }))}</span>
        ${splits ? `<span class="ev-chip ev-chip--alert"><i class="bi bi-exclamation-triangle me-1"></i>${esc(exf(EX.hatSplits, { n: splits }))}</span>` : ""}
        ${loose.length ? `<span class="ev-chip ev-chip--alert">${esc(exf(EX.hatLoose, { n: loose.length }))}</span>` : ""}
        <span class="small ev-muted">${esc(!published ? EX.hatDraftNotPublished : d.dirty ? EX.hatDraftDirty : EX.hatDraftPublished)}</span>
        <div class="ms-auto d-flex gap-2 flex-wrap">
          <button class="btn btn-sm btn-outline-secondary" type="button" data-hat-gen="new"><i class="bi bi-shuffle me-1"></i>${esc(EX.hatRegenerate)}</button>
          <button class="btn btn-sm btn-primary" type="button" data-hat-publish ${published && !d.dirty ? "disabled" : ""}><i class="bi bi-megaphone me-1"></i>${esc(exf(EX.hatPublish, { div: div.name }))}</button>
        </div>
      </div>
      <div class="small ev-muted mt-2">${esc(hs.sel ? EX.hatTapTarget : EX.hatBoardHelp)}</div>
    </section>
    <div class="hat-board ${hs.sel ? "is-picking" : ""}">
      ${teams.map((t) => `
        <section class="hat-team" data-hat-team="${esc(t.key)}" style="--team:${esc(t.color || "#19473f")}">
          <header class="hat-team__head">
            <input class="form-control form-control-color hat-team__color" type="color" data-hat-tcolor="${esc(t.key)}" value="${esc(t.color || "#19473f")}" aria-label="${esc(EX.teamColor)}" />
            <input class="form-control form-control-sm fw-bold" data-hat-tname="${esc(t.key)}" value="${esc(t.name)}" aria-label="${esc(EX.teamName)}" />
          </header>
          <div class="hat-team__stats">${statsLine(t.players)}</div>
          <div class="hat-team__list">${t.players.map(chip).join("")}</div>
        </section>`).join("")}
      ${loose.length || hs.sel ? `
        <section class="hat-team hat-team--loose" data-hat-team="">
          <header class="hat-team__head"><span class="fw-bold small">${esc(EX.hatNoTeam)}</span></header>
          <div class="hat-team__list">${loose.map(chip).join("") || `<div class="small ev-muted p-2">${esc(EX.hatDropHere)}</div>`}</div>
        </section>` : ""}
    </div>
    ${teamJerseysHtml(teams)}`;
}

// camisetas por equipo: totales por talla/corte (copiar o Excel con la lista completa)
function teamJerseysHtml(teams) {
  return `
    <section class="ev-card mt-3">
      <div class="d-flex align-items-center gap-2 mb-2 flex-wrap">
        <h2 class="h6 mb-0 me-auto"><i class="bi bi-shirt me-1"></i>${esc(EX.hatTeamJerseys)}</h2>
        <button class="btn btn-sm btn-light" type="button" data-hat-jcopy><i class="bi bi-clipboard me-1"></i>${esc(EX.hatCopy)}</button>
        <button class="btn btn-sm btn-light" type="button" data-hat-jxlsx><i class="bi bi-file-earmark-excel me-1"></i>Excel</button>
      </div>
      <div class="row g-3">
        ${teams.map((t) => `
          <div class="col-12 col-sm-6 col-lg-4">
            <div class="small fw-bold mb-1"><span class="hat-dot" style="background:${esc(t.color)}"></span>${esc(t.name)} · ${t.players.length}</div>
            <div class="small">${jerseyTotals(t.players).map((j) => `${esc(j.size)} ${esc(cutLabel(j.cut))}: <b>${j.n}</b>`).join(" · ") || "—"}</div>
          </div>`).join("")}
      </div>
    </section>`;
}

const hasNumber = (p) => p.number !== null && p.number !== undefined && p.number !== "";

function jerseyText(div, teams) {
  return [
    `${ev().name} · ${div.name}`,
    ...teams.map((t) => [
      "",
      `${t.name} (${t.players.length})`,
      ...jerseyTotals(t.players).map((j) => `  ${j.size} ${cutLabel(j.cut)}: ${j.n}`),
      ...t.players.map((p) => `  - ${p.name}${hasNumber(p) ? ` #${p.number}` : ""}: ${p.jersey?.size || "?"} ${cutLabel(p.jersey?.cut)}`),
    ].join("\n")),
  ].join("\n");
}

function jerseySheets(div, teams) {
  const slug = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return {
    filename: `${slug(ev().name)}-${slug(div.name)}-camisetas`,
    sheets: [
      {
        name: EX.hatJerseys,
        head: [EX.teamName, EX.hatColPlayer, "#", EX.hatJerseySize, EX.hatJerseyCut],
        rows: teams.flatMap((t) => t.players.map((p) => [t.name, p.name, hasNumber(p) ? p.number : "", p.jersey?.size || "", cutLabel(p.jersey?.cut)])),
      },
      {
        name: EX.hatTotal,
        head: [EX.teamName, EX.hatJerseySize, EX.hatJerseyCut, EX.hatTotal],
        rows: teams.flatMap((t) => jerseyTotals(t.players).map((j) => [t.name, j.size, cutLabel(j.cut), j.n])),
      },
    ],
  };
}

async function publish() {
  const div = divById(hs.divisionId);
  const d = draftOf();
  const players = boardPlayers();
  const { teams, loose } = boardTeams(d, players);
  // equipos publicados antes que ya no están (se regeneró con menos): se borran, salvo que tengan partidos
  const keys = new Set(d.teams.map((t) => t.key));
  const removed = Object.entries(d.teamIds || {}).filter(([k]) => !keys.has(k)).map(([, id]) => id);
  if (removed.some((id) => C.state.games.some((g) => g.teamA?.id === id || g.teamB?.id === id))) return C.alertBox(EX.hatPublishHasGames, "danger");
  const msg = [exf(EX.hatPublishConfirm, { n: teams.length, div: div.name }), loose.length ? exf(EX.hatPublishLoose, { n: loose.length }) : ""].filter(Boolean).join("\n\n");
  if (!confirm(msg)) return;
  clearTimeout(saveTimer);
  await C.run(async () => {
    const clean = { ...cleanDraft(d, players), dirty: false };
    const teamIds = await publishHatDivision(ev().id, div.id, clean, hs.pool.filter((p) => p.divisionId === div.id), removed);
    hs.drafts.set(div.id, { ...clean, teamIds, publishedAt: new Date() });
    await C.reloadData();
    C.renderEvent();
    C.alertBox(exf(EX.hatPublished, { div: div.name }));
  });
}
