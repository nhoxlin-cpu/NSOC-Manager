// HS labels: ten identifier characters and a two- or three-letter suffix.
// Keep unfamiliar legacy formats intact instead of guessing and losing evidence.
export function hsCode(value){
  const raw=String(value??'').trim().toUpperCase(),prefix=raw.split(/[-‐‑–—]/,1)[0].trim();
  if(/^[A-Z0-9]{10}[A-Z]{2,3}$/.test(prefix))return prefix;
  const match=/^([A-Z0-9]{10}[A-Z]{3}|[A-Z0-9]{10}[A-Z]{2})(?![A-Z])/.exec(raw);
  return match?match[1]:raw;
}
