// /tournaments/js/organizer_hat.js
// Pestaña Hat del organizador: pool de jugadores por división, puntajes, pagos, camisetas,
// armado de equipos (hat.js), cambios y publicación por división.
import { EX } from "/tournaments/js/strings.js";
import { esc } from "/tournaments/js/ui.js";

export async function renderHat(tab) {
  tab.innerHTML = `<div class="ev-card ev-muted">${esc(EX.hatComingSoon)}</div>`;
}
