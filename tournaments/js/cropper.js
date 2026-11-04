// /tournaments/js/cropper.js
// Recorte de imágenes antes de subirlas (logo, foto de perfil, imagen del torneo).
// Arrastrar para mover, rueda/pellizco/slider para zoom. Devuelve una data URL chica (webp o png).
import { EX } from "/tournaments/js/strings.js";

let modalEl = null;

function ensureModal() {
  if (modalEl) return modalEl;
  modalEl = document.createElement("div");
  modalEl.className = "modal";
  modalEl.tabIndex = -1;
  modalEl.innerHTML = `
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header py-2">
          <h2 class="modal-title h6 fw-bold" data-crop="title"></h2>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="${EX.cancel}"></button>
        </div>
        <div class="modal-body">
          <div class="tn-crop" data-crop="stage">
            <img alt="" data-crop="img" draggable="false" />
            <div class="tn-crop__frame" data-crop="frame"></div>
          </div>
          <div class="d-flex align-items-center gap-2 mt-3">
            <i class="bi bi-zoom-out ev-muted"></i>
            <input type="range" class="form-range" min="0" max="1000" value="0" data-crop="zoom" aria-label="${EX.cropZoom}" />
            <i class="bi bi-zoom-in ev-muted"></i>
          </div>
          <div class="d-flex flex-wrap gap-2 justify-content-center mt-2">
            <button type="button" class="btn btn-sm btn-light" data-crop="fit"><i class="bi bi-arrows-angle-contract me-1"></i>${EX.cropFit}</button>
            <button type="button" class="btn btn-sm btn-light" data-crop="fill"><i class="bi bi-arrows-angle-expand me-1"></i>${EX.cropFill}</button>
          </div>
          <div class="form-text text-center mt-2">${EX.cropHint}</div>
        </div>
        <div class="modal-footer py-2">
          <button type="button" class="btn btn-light" data-bs-dismiss="modal">${EX.cancel}</button>
          <button type="button" class="btn btn-primary" data-crop="ok"><i class="bi bi-check-lg me-1"></i>${EX.cropUse}</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modalEl);
  return modalEl;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("bad-image"));
    };
    img.src = url;
  });
}

function encode(canvas, maxChars) {
  for (const q of [0.88, 0.8, 0.7, 0.6, 0.5]) {
    const webp = canvas.toDataURL("image/webp", q);
    const out = webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
    if (out.length <= maxChars || !webp.startsWith("data:image/webp")) return out;
  }
  return canvas.toDataURL("image/jpeg", 0.6);
}

/**
 * Abre el recorte y devuelve la imagen recortada (data URL) o null si se cancela.
 * @param {File} file
 * @param {{ aspect?: number, round?: boolean, width?: number, title?: string, maxChars?: number }} opts
 *   aspect: ancho/alto del recorte (1 = cuadrado). round: guía circular (fotos de cara).
 *   width: ancho de salida en px. maxChars: tamaño máximo de la data URL.
 */
export async function cropImage(file, { aspect = 1, round = false, width = 512, title = EX.cropTitle, maxChars = 250000 } = {}) {
  const { img, url } = await loadImage(file);
  const el = ensureModal();
  const $ = (k) => el.querySelector(`[data-crop="${k}"]`);
  const stage = $("stage");
  const imgEl = $("img");
  const zoom = $("zoom");
  $("title").textContent = title;
  stage.style.aspectRatio = String(aspect);
  $("frame").classList.toggle("is-round", round);
  imgEl.src = url;

  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  let W = 0;
  let H = 0;
  let minS = 1;
  let maxS = 1;
  let s = 1;
  let x = 0;
  let y = 0;

  const clampAxis = (pos, size, box) => (size >= box ? Math.min(0, Math.max(box - size, pos)) : Math.max(0, Math.min(box - size, pos)));
  const apply = () => {
    x = clampAxis(x, iw * s, W);
    y = clampAxis(y, ih * s, H);
    imgEl.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    zoom.value = String(Math.round(((Math.log(s) - Math.log(minS)) / (Math.log(maxS) - Math.log(minS) || 1)) * 1000));
  };
  const zoomTo = (next, cx = W / 2, cy = H / 2) => {
    const ns = Math.min(maxS, Math.max(minS, next));
    x = cx - (cx - x) * (ns / s);
    y = cy - (cy - y) * (ns / s);
    s = ns;
    apply();
  };
  const fit = (cover) => {
    s = cover ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih);
    x = (W - iw * s) / 2;
    y = (H - ih * s) / 2;
    apply();
  };
  const layout = () => {
    const r = stage.getBoundingClientRect();
    W = r.width;
    H = r.height;
    minS = Math.min(W / iw, H / ih); // se ve la imagen completa
    maxS = Math.max(W / iw, H / ih) * 6;
    fit(true); // por defecto llena el recorte
  };

  // arrastre y pellizco
  const pointers = new Map();
  let pinch = null;
  const onDown = (ev) => {
    stage.setPointerCapture(ev.pointerId);
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s };
    }
  };
  const onMove = (ev) => {
    const prev = pointers.get(ev.pointerId);
    if (!prev) return;
    const cur = { x: ev.clientX, y: ev.clientY };
    pointers.set(ev.pointerId, cur);
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const r = stage.getBoundingClientRect();
      zoomTo(pinch.s * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
    } else if (pointers.size === 1) {
      x += cur.x - prev.x;
      y += cur.y - prev.y;
      apply();
    }
  };
  const onUp = (ev) => {
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) pinch = null;
  };
  const onWheel = (ev) => {
    ev.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomTo(s * (ev.deltaY < 0 ? 1.08 : 1 / 1.08), ev.clientX - r.left, ev.clientY - r.top);
  };
  const onZoom = () => {
    const t = Number(zoom.value) / 1000;
    zoomTo(Math.exp(Math.log(minS) + t * (Math.log(maxS) - Math.log(minS))));
  };
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("wheel", onWheel, { passive: false });
  zoom.addEventListener("input", onZoom);
  $("fit").onclick = () => fit(false);
  $("fill").onclick = () => fit(true);

  const modal = bootstrap.Modal.getOrCreateInstance(el);
  return new Promise((resolve) => {
    let result = null;
    const onShown = () => layout();
    $("ok").onclick = () => {
      const height = Math.round(width / aspect);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const k = width / W;
      canvas.getContext("2d").drawImage(img, x * k, y * k, iw * s * k, ih * s * k);
      result = encode(canvas, maxChars);
      modal.hide();
    };
    const onHidden = () => {
      el.removeEventListener("shown.bs.modal", onShown);
      el.removeEventListener("hidden.bs.modal", onHidden);
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      stage.removeEventListener("wheel", onWheel);
      zoom.removeEventListener("input", onZoom);
      URL.revokeObjectURL(url);
      imgEl.removeAttribute("src");
      resolve(result);
    };
    el.addEventListener("shown.bs.modal", onShown);
    el.addEventListener("hidden.bs.modal", onHidden);
    modal.show();
  });
}

// Atajo para <input type="file">: recorta el archivo elegido y limpia el input
export async function cropFromInput(input, opts) {
  const file = input.files?.[0];
  input.value = "";
  if (!file) return null;
  return cropImage(file, opts);
}
