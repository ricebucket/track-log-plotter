// Reading values straight out of a file's text, without cutting it into
// pieces first. The readers call these for nearly every field of every line,
// so they allocate nothing in the usual cases, and fall back to the built-in
// conversions for anything unusual, so the results are exactly the same.

/** The characters String.prototype.trim and the regex \s count as space. */
export function isSpace(c: number): boolean {
  return c === 32 || (c >= 9 && c <= 13) || (c >= 0xa0 && wideSpace(c));
}

function wideSpace(c: number): boolean {
  return c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029
    || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;
}

const POW10 = [1, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15];

/**
 * Number(s.slice(a, b)), without making the slice for plain decimals; a field
 * of nothing but space gives `blank`, which is 0 for Number() itself. With at
 * most 15 digits, the digits read as a whole number are exact, and so is the
 * power of ten, so the one division rounds correctly: the same double that
 * Number() gives. Anything else (exponents, hex, more digits) goes to Number().
 */
export function numAt(s: string, a: number, b: number, blank = 0): number {
  let i = a, e = b;
  while (i < e && isSpace(s.charCodeAt(i))) i++;
  while (e > i && isSpace(s.charCodeAt(e - 1))) e--;
  if (i === e) return blank; // Number('') and Number('  ') are 0
  let c = s.charCodeAt(i), neg = false;
  if (c === 45 || c === 43) { neg = c === 45; i++; }
  let m = 0, digits = 0, frac = -1;
  for (; i < e; i++) {
    c = s.charCodeAt(i);
    if (c >= 48 && c <= 57) { m = m * 10 + (c - 48); digits++; if (frac >= 0) frac++; }
    else if (c === 46 && frac < 0) frac = 0;
    else return Number(s.slice(a, b));
  }
  if (digits === 0 || digits > 15) return Number(s.slice(a, b));
  const v = frac > 0 ? m / POW10[frac] : m;
  return neg ? -v : v;
}

/** True when s[a..b) holds nothing but space. */
export function blankAt(s: string, a: number, b: number): boolean {
  for (let i = a; i < b; i++) if (!isSpace(s.charCodeAt(i))) return false;
  return true;
}

/** Index of the last character that isn't space, or -1. */
export function lastNonSpace(s: string): number {
  let i = s.length - 1;
  while (i >= 0 && isSpace(s.charCodeAt(i))) i--;
  return i;
}
