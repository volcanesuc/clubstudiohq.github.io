// /tournaments/js/pickups_raffle.js
// Rifa de un pickup: tarjeta con el estado (condición, ganador) y la animación del sorteo.
// La lógica (quién entra, cuándo se puede) está en pickups.js; el sorteo se guarda antes de animar,
// así recargar la página nunca cambia el ganador.
import { PK, pkf } from "/tournaments/js/pickups_strings.js";
import { RAFFLE, drawIndex } from "/tournaments/js/pickups.js";
import { esc, fmtWhen } from "/tournaments/js/ui.js";

/** Número al azar en [0, 1) con crypto (Math.random si el navegador no lo tiene). */
export function secureRandom() {
  try {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] / 2 ** 32;
  } catch {
    return Math.random();
  }
}

/** Elige el ganador entre los confirmados. @returns {object|null} el jugador */
export function pickWinner(pool) {
  const i = drawIndex(pool.length, secureRandom);
  return i < 0 ? null : pool[i];
}

/**
 * Tarjeta de la rifa.
 * @param {object} rs raffleState(...)
 * @param {{ pickup: object, admin?: boolean, meId?: string, locked?: boolean }} opts
 */
export function raffleCard(rs, { pickup, admin = false, meId = "", locked = false } = {}) {
  if (rs.status === RAFFLE.OFF) return "";
  const head = `<div class="pk-raffle__head"><span class="pk-raffle__icon"><i class="bi bi-ticket-perforated-fill"></i></span><b>${esc(PK.rfTitle)}</b></div>`;
  const rule = pkf(PK.rfRule, { min: rs.min });
  let body = "";
  if (rs.status === RAFFLE.DRAWN) {
    const mine = meId && rs.winnerId === meId;
    body = `
      <div class="pk-raffle__winner">${esc(mine ? PK.rfYouWon : pkf(PK.rfWinner, { name: rs.winnerName }))}</div>
      <div class="small">${esc(PK.rfFree)}</div>
      <button class="btn btn-sm btn-light mt-2" data-raffle="replay"><i class="bi bi-play-circle me-1"></i>${esc(PK.rfReplay)}</button>`;
  } else if (rs.status === RAFFLE.WAITING) {
    const reached = rs.count >= rs.min;
    body = `
      <div class="small">${esc(rule)}</div>
      <div class="small mt-1">${esc(pkf(PK.rfWhen, { when: fmtWhen(pickup.leaveDeadlineAt) }))}</div>
      <div class="pk-raffle__count ${reached ? "is-ok" : ""}">${esc(pkf(PK.rfCount, { n: rs.count, min: rs.min }))}${reached ? ` <i class="bi bi-check-circle-fill"></i>` : ""}</div>`;
  } else if (rs.status === RAFFLE.READY) {
    body = admin && !locked
      ? `<div class="small">${esc(pkf(PK.rfReadyAdmin, { n: rs.count }))}</div>
         <button class="btn tn-btn-grad mt-2" data-raffle="draw"><i class="bi bi-shuffle me-1"></i>${esc(PK.rfDraw)}</button>`
      : `<div class="small">${esc(pkf(PK.rfReady, { n: rs.count }))}</div>`;
  } else if (rs.status === RAFFLE.SHORT) {
    body = `<div class="small">${esc(pkf(PK.rfShort, { n: rs.count, min: rs.min }))}</div>${admin ? `<div class="small ev-muted mt-1">${esc(PK.rfShortAdmin)}</div>` : ""}`;
  } else {
    body = `<div class="small">${esc(PK.rfVoid)}</div>`;
  }
  return `<div class="pk-raffle ${rs.status === RAFFLE.DRAWN ? "is-drawn" : ""} mb-3">${head}${body}</div>`;
}

/**
 * Animación del sorteo: los nombres pasan como una tragamonedas, frenan en el ganador y sale confeti.
 * @param {string[]} names nombres de los que entraron (en orden)
 * @param {number} winner índice del ganador en `names`
 * @returns {Promise<void>} cuando se cierra
 */
export function playRaffle(names, winner, { title = PK.rfTitle } = {}) {
  return new Promise((resolve) => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const ITEM = 64;
    const laps = Math.max(4, Math.ceil(40 / Math.max(1, names.length)));
    const reel = [];
    for (let l = 0; l < laps; l++) reel.push(...names);
    const target = (laps - 1) * names.length + winner; // el ganador en la última vuelta
    reel.push(...names.slice(0, 3)); // relleno para que abajo no quede vacío
    const wrap = document.createElement("div");
    wrap.className = "pk-rf-overlay";
    wrap.innerHTML = `
      <div class="pk-rf-box" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="pk-rf-title"><i class="bi bi-ticket-perforated-fill me-1"></i>${esc(title)}</div>
        <div class="pk-rf-sub">${esc(pkf(PK.rfAmong, { n: names.length }))}</div>
        <div class="pk-rf-window">
          <div class="pk-rf-reel">${reel.map((n) => `<div class="pk-rf-item">${esc(n)}</div>`).join("")}</div>
          <div class="pk-rf-marker"></div>
        </div>
        <div class="pk-rf-result" aria-live="polite"></div>
        <button class="btn btn-light mt-3 pk-rf-close" disabled>${esc(PK.rfClose)}</button>
      </div>`;
    document.body.appendChild(wrap);
    const reelEl = wrap.querySelector(".pk-rf-reel");
    const close = wrap.querySelector(".pk-rf-close");
    const result = wrap.querySelector(".pk-rf-result");
    // la ventana muestra 3 nombres: el del medio es el elegido
    const offset = (i) => -(i - 1) * ITEM;
    reelEl.style.transform = `translateY(${offset(1)}px)`;
    const finish = () => {
      const items = reelEl.querySelectorAll(".pk-rf-item");
      items[target]?.classList.add("is-winner");
      result.innerHTML = `<div class="pk-rf-name">${esc(names[winner])}</div><div class="small">${esc(PK.rfFree)}</div>`;
      confetti(wrap.querySelector(".pk-rf-box"));
      close.disabled = false;
      close.focus();
    };
    const ms = reduce ? 600 : 5200;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      reelEl.style.transition = `transform ${ms}ms cubic-bezier(.12,.75,.15,1)`;
      reelEl.style.transform = `translateY(${offset(target)}px)`;
    }));
    let done = false;
    const end = () => { if (!done) { done = true; finish(); } };
    reelEl.addEventListener("transitionend", end, { once: true });
    setTimeout(end, ms + 400); // por si el navegador no dispara transitionend
    const shut = () => { wrap.remove(); resolve(); };
    close.addEventListener("click", shut);
    wrap.addEventListener("keydown", (e) => { if (e.key === "Escape" && !close.disabled) shut(); });
  });
}

function confetti(box) {
  const colors = ["#7c3aed", "#f59e0b", "#10b981", "#ef4444", "#3b82f6", "#ec4899"];
  const layer = document.createElement("div");
  layer.className = "pk-rf-confetti";
  layer.innerHTML = Array.from({ length: 60 }, (_, i) => {
    const left = Math.round(secureRandom() * 100);
    const delay = (secureRandom() * 0.4).toFixed(2);
    const dur = (1.6 + secureRandom() * 1.2).toFixed(2);
    const rot = Math.round(secureRandom() * 360);
    return `<i style="left:${left}%;background:${colors[i % colors.length]};animation-delay:${delay}s;animation-duration:${dur}s;transform:rotate(${rot}deg)"></i>`;
  }).join("");
  box.appendChild(layer);
  setTimeout(() => layer.remove(), 3500);
}
