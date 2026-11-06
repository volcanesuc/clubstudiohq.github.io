// /assets/lang.js — idioma de las páginas de texto (documentación, privacidad).
// Usa la misma preferencia que la plataforma de torneos (localStorage "tn_lang", ?lang=en o el navegador).
// Cada bloque trae data-lang="es" o data-lang="en"; el CSS oculta el que no corresponde.
(function () {
  var KEY = "tn_lang";
  function detect() {
    try {
      var q = new URLSearchParams(location.search).get("lang");
      if (q === "es" || q === "en") {
        localStorage.setItem(KEY, q);
        return q;
      }
      var saved = localStorage.getItem(KEY);
      if (saved === "es" || saved === "en") return saved;
    } catch (e) {}
    var langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "es"];
    if (langs.some(function (l) { return /^es\b/i.test(l); })) return "es";
    return langs.some(function (l) { return /^en\b/i.test(l); }) ? "en" : "es";
  }
  var root = document.documentElement;
  var lang = detect();
  root.lang = lang;
  if (lang === "en" && root.dataset.titleEn) document.title = root.dataset.titleEn;

  document.addEventListener("DOMContentLoaded", function () {
    var year = document.getElementById("lpYear");
    if (year) year.textContent = new Date().getFullYear();
    document.querySelectorAll("[data-wa]").forEach(function (a) {
      a.href = "https://wa.me/50670567463?text=" + encodeURIComponent(a.getAttribute("data-wa"));
      a.target = "_blank";
      a.rel = "noopener";
    });
    document.querySelectorAll("[data-set-lang]").forEach(function (b) {
      b.addEventListener("click", function () {
        try { localStorage.setItem(KEY, lang === "en" ? "es" : "en"); } catch (e) {}
        var url = new URL(location.href);
        url.searchParams.delete("lang");
        history.replaceState(null, "", url.toString());
        location.reload();
      });
    });
  });
})();
