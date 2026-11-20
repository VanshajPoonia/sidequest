// Event codes: no model, no backend, runs in milliseconds.
import assert from 'node:assert/strict';
import { ALPHABET, LENGTH, makeCode, isValidCode, normalizeCode, formatCode } from '../src/team/code.js';

let n = 0;
const check = (name, fn) => { fn(); n++; console.log(`ok  ${name}`); };

check('codes are six characters from an alphabet with no 0, O, 1, I or L', () => {
  assert.equal(ALPHABET.length, 31);
  assert.ok(!/[01IOL]/.test(ALPHABET));
  for (let i = 0; i < 500; i++) {
    const c = makeCode();
    assert.equal(c.length, LENGTH);
    assert.ok([...c].every((ch) => ALPHABET.includes(ch)), c);
    assert.ok(isValidCode(c), c);
  }
});

check('2,000 random codes do not repeat', () => {
  const seen = new Set(Array.from({ length: 2000 }, () => makeCode()));
  assert.equal(seen.size, 2000);
});

check('every single wrong character is caught', () => {
  for (let k = 0; k < 50; k++) {
    const c = makeCode();
    for (let i = 0; i < LENGTH; i++) {
      for (const ch of ALPHABET) {
        if (ch === c[i]) continue;
        assert.ok(!isValidCode(c.slice(0, i) + ch + c.slice(i + 1)), `${c} -> ${ch} at ${i}`);
      }
    }
  }
});

check('every swap of two neighbouring characters is caught', () => {
  for (let k = 0; k < 200; k++) {
    const c = makeCode();
    for (let i = 0; i < LENGTH - 1; i++) {
      if (c[i] === c[i + 1]) continue;
      const swapped = c.slice(0, i) + c[i + 1] + c[i] + c.slice(i + 2);
      assert.ok(!isValidCode(swapped), `${c} -> ${swapped}`);
    }
  }
});

check('codes are typed loosely: lower case, spaces and a dash are fine', () => {
  const c = makeCode(() => 7);
  assert.equal(formatCode(c), `${c.slice(0, 3)}-${c.slice(3)}`);
  assert.equal(normalizeCode(` ${formatCode(c).toLowerCase()} `), c);
  assert.ok(isValidCode(formatCode(c).toLowerCase()));
  assert.ok(!isValidCode(c.slice(0, 5)));
  assert.ok(!isValidCode(`${c}X`));
  assert.ok(!isValidCode(null));
});

check('a seeded generator gives a fixed code', () => {
  let i = 0;
  const seq = [0, 1, 2, 3, 4];
  assert.equal(makeCode(() => seq[i++]).slice(0, 5), '23456');
});

console.log(`\n${n} event code checks passed\n`);
