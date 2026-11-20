// Event codes: six characters read off a projector and typed on a phone. Pure, tested
// in tests/team.mjs.
//
// No 0, O, 1, I or L, so nothing is ambiguous. The last character is a check, so a
// typo is caught on the phone before it reaches any backend.

export const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const LENGTH = 6;
const BASE = ALPHABET.length; // 31, a prime, which is what makes the check work

// Chosen so that the weighted sum of all six values is 0 mod 31. That catches every
// single wrong character and every swap of two neighbours.
function checkFor(body) {
  let s = 0;
  for (let i = 0; i < body.length; i++) s += (i + 1) * ALPHABET.indexOf(body[i]);
  const inv = [...Array(BASE).keys()].find((x) => (LENGTH * x) % BASE === 1);
  return ALPHABET[(((BASE - (s % BASE)) % BASE) * inv) % BASE];
}

function randomIndex() {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] % BASE;
}

export function makeCode(rand = randomIndex) {
  let body = '';
  for (let i = 0; i < LENGTH - 1; i++) body += ALPHABET[rand()];
  return body + checkFor(body);
}

/** What people actually type: lower case, spaces, a dash in the middle. */
export function normalizeCode(input) {
  return String(input ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export function isValidCode(input) {
  const c = normalizeCode(input);
  if (c.length !== LENGTH || [...c].some((ch) => !ALPHABET.includes(ch))) return false;
  return checkFor(c.slice(0, -1)) === c.at(-1);
}

export const formatCode = (code) => `${code.slice(0, 3)}-${code.slice(3)}`;
