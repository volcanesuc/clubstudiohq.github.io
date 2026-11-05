// /tournaments/js/countries.js
// Países para los clubes: código ISO (se guarda en squads/{id}.country), nombre en español y bandera.
const CODES = [
  // América (primero, es donde más se usa)
  "CR", "PA", "NI", "HN", "SV", "GT", "BZ", "MX", "CU", "DO", "PR", "JM",
  "CO", "VE", "EC", "PE", "BO", "CL", "AR", "UY", "PY", "BR", "US", "CA",
  // Europa
  "ES", "PT", "FR", "IT", "DE", "AT", "CH", "BE", "NL", "GB", "IE", "DK", "SE", "NO", "FI",
  "PL", "CZ", "SK", "HU", "SI", "HR", "RO", "LV", "LT", "EE",
  // Asia y Oceanía
  "JP", "CN", "TW", "KR", "PH", "SG", "MY", "TH", "IN", "AE", "AU", "NZ",
  // África
  "ZA", "KE", "UG",
];

let names = null;
function nameOf(code) {
  try {
    names = names || new Intl.DisplayNames(["es"], { type: "region" });
    return names.of(code) || code;
  } catch {
    return code;
  }
}

// Bandera a partir del código ISO (letras regionales de Unicode)
export const flagOf = (code) => (/^[A-Z]{2}$/.test(code || "") ? String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "");

export const countryName = (code) => (code ? nameOf(code) : "");
export const countryLabel = (code) => (code ? `${flagOf(code)} ${nameOf(code)}` : "");

// <option>s ordenados por nombre; el seleccionado (o "" para "elegí")
export function countryOptions(selected = "", placeholder = "") {
  const list = CODES.map((c) => ({ c, n: nameOf(c) })).sort((a, b) => a.n.localeCompare(b.n, "es"));
  if (selected && !CODES.includes(selected)) list.unshift({ c: selected, n: nameOf(selected) });
  return `<option value="">${placeholder}</option>` + list.map(({ c, n }) => `<option value="${c}" ${c === selected ? "selected" : ""}>${flagOf(c)} ${n}</option>`).join("");
}
