// /tournaments/js/organizer_hat.js
// Pestaña Hat del organizador: pool de jugadores por división (puntajes, pagos, camisetas, lista de espera),
// cantidad de equipos sugerida y, después, armado de equipos (hat.js), cambios y publicación por división.
// Los puntajes son privados: se leen de hat_ratings y nunca se escriben en los equipos.
import { EX, exf } from "/tournaments/js/strings.js";
import { HAT_QUESTIONS } from "/tournaments/js/hat-config.js";
import { HAT_STATUS, ageOn, ageRefOf, eligibility, jerseyTotals, mutualPairs, normalize, rawScore, suggestTeamCount } from "/tournaments/js/hat.js";
import { JERSEY_CUTS } from "/tournaments/js/divisions-config.js";
import { eventRules } from "/tournaments/js/model.js";
import {
  PAYMENT,
  decideHatPayment,
  fmtMoney,
  listHatPayments,
  listHatPlayers,
  listHatRatings,
  moveHatDivision,
  saveEvent,
  setHatNotes,
  setHatOrganizerScore,
  setHatPaymentStatus,
  setHatStatus,
} from "/tournaments/js/services.js";
import { avatarHtml, esc, paymentChip } from "/tournaments/js/ui.js";

// estado de la pestaña (se conserva al cambiar de pestaña dentro del organizador)
const hs = { eventId: "", divisionId: "", pool: [], ratings: new Map(), payments: new Map(), q: "", sort: "score", open: "" };
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
  if (hs.eventId !== ev().id) Object.assign(hs, { eventId: ev().id, divisionId: "", q: "", open: "" });
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
    ${warningsHtml(s.rows)}
    ${teamCountHtml(div, s.total)}
    ${poolHtml(div, s.rows)}
    ${jerseysHtml(div)}`;
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
      hs.divisionId = d.dataset.hatDiv;
      hs.open = "";
      return paint();
    }
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
}
