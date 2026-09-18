// Complex-valued constant-expression parser/evaluator for the Quantum
// Custom State amplitude fields (App.jsx) -- lets a field read something
// like "1/sqrt(2)" or "e^(i*pi/4)" instead of only a plain real number, so
// a custom state's own a/b/c/d amplitudes can actually reach an arbitrary
// complex value rather than just a real one.
//
// The tokenizer and recursive-descent parser shape are lifted from the
// optics-lab sim's own hand-written trial-function interpreter
// (sweepMath.js) -- same reasoning for not using eval/new Function here:
// not sandboxing untrusted input (a student can only ever run this against
// their own browser), but turning a typo into one specific parse error
// instead of a raw SyntaxError/ReferenceError, and keeping the callable
// surface to exactly the names listed below. The one structural difference
// from sweepMath.js is that an amplitude expression has no free variable
// (sweepMath.js's trial functions are all in terms of `theta`) -- with
// nothing to defer evaluation *of*, each parse function below can just
// return the { re, im } value it computes directly, rather than compiling
// to a closure tree the way sweepMath.js's own parser has to.
//
// Complex add/multiply/scale/modulus reuse physics.js's own primitives, so
// this file isn't a second, independently-implemented notion of complex
// arithmetic -- it only adds subtraction, negation, division, and general
// exponentiation, none of which the rest of this sim's physics has ever
// needed before now.

import { cAdd, cMul, cScale, cExp, cAbs2 } from './physics';

function cSub(z1, z2) { return { re: z1.re - z2.re, im: z1.im - z2.im }; }
function cNeg(z) { return { re: -z.re, im: -z.im }; }
function cDiv(z1, z2) {
  const denom = cAbs2(z2);
  return { re: (z1.re * z2.re + z1.im * z2.im) / denom, im: (z1.im * z2.re - z1.re * z2.im) / denom };
}

// e^z for a general complex z, built from physics.js's own cExp -- that
// function is really just e^{i*theta} for a *real* theta (a unit-modulus
// point on the circle); scaling it by e^{re(z)} extends it to the full
// complex exponential via e^z = e^{re(z)} * e^{i*im(z)}.
function cExpFull(z) {
  return cScale(cExp(z.im), Math.exp(z.re));
}

// Principal value of base^exponent for complex base and exponent, via the
// standard identity b^p = e^{p * ln(b)}, where ln(b) = ln|b| + i*arg(b).
// One formula this way covers a real power of a complex base (i^2), a
// complex power of a real base (e^(i*pi)), and everything in between.
// ln(0) is undefined, so base 0 is special-cased rather than left to come
// out as NaN/Infinity: 0^0 is 1 (the usual convention), any other power of
// 0 is just 0.
function cPow(base, exponent) {
  if (base.re === 0 && base.im === 0) {
    return (exponent.re === 0 && exponent.im === 0) ? { re: 1, im: 0 } : { re: 0, im: 0 };
  }
  const modulus = Math.sqrt(cAbs2(base));
  // Math.atan2 treats +0 and -0 as different angles for a negative real
  // base (atan2(-0, -1) is -pi, not +pi) -- and cNeg (unary minus) produces
  // exactly that -0 for, e.g., -1's own im. Without this, sqrt(-1) comes
  // out -i instead of the conventional principal value +i. Normalizing a
  // zero imaginary part to +0 first keeps the principal branch the usual
  // (-pi, pi] with every negative real landing on +pi, regardless of which
  // signed zero it happened to arrive with.
  const argument = Math.atan2(base.im === 0 ? 0 : base.im, base.re);
  const lnBase = { re: Math.log(modulus), im: argument };
  return cExpFull(cMul(exponent, lnBase));
}

const I = { re: 0, im: 1 };
const TWO_I = { re: 0, im: 2 };

// sin/cos/tan via their standard complex-exponential definitions (the same
// identities that make these entire functions on the whole complex plane,
// not just the real line); sqrt via cPow at exponent 1/2, whose principal
// branch is exactly the usual complex square root.
function cSin(z) {
  const iz = cMul(I, z);
  return cDiv(cSub(cExpFull(iz), cExpFull(cNeg(iz))), TWO_I);
}
function cCos(z) {
  const iz = cMul(I, z);
  return cScale(cAdd(cExpFull(iz), cExpFull(cNeg(iz))), 0.5);
}
function cTan(z) {
  return cDiv(cSin(z), cCos(z));
}
function cSqrt(z) {
  return cPow(z, { re: 0.5, im: 0 });
}

const CONSTANTS = { i: I, e: { re: Math.E, im: 0 }, pi: { re: Math.PI, im: 0 } };
const FUNCTIONS = { sin: cSin, cos: cCos, tan: cTan, sqrt: cSqrt };

// Scans a number starting at `start` (already known to begin with a digit
// or '.'), including an optional exponent (e.g. "1.5e-3") -- returns the
// index just past it. Identical to sweepMath.js's own scanNumber: the
// lexical grammar for a number doesn't change just because this file
// evaluates to a complex value instead of a real one.
function scanNumber(src, start) {
  let i = start;
  while (i < src.length && /[0-9]/.test(src[i])) i++;
  if (src[i] === '.') {
    i++;
    while (i < src.length && /[0-9]/.test(src[i])) i++;
  }
  if (src[i] === 'e' || src[i] === 'E') {
    let j = i + 1;
    if (src[j] === '+' || src[j] === '-') j++;
    if (/[0-9]/.test(src[j] || '')) {
      i = j;
      while (i < src.length && /[0-9]/.test(src[i])) i++;
    }
  }
  return i;
}

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const end = scanNumber(src, i);
      const raw = src.slice(i, end);
      const value = parseFloat(raw);
      if (end === i || Number.isNaN(value)) throw new Error(`Bad number near "${src.slice(i, i + 6)}"`);
      tokens.push({ type: 'num', value });
      i = end;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z_0-9]/.test(src[j])) j++;
      tokens.push({ type: 'ident', value: src.slice(i, j) });
      i = j;
      continue;
    }
    if ('+-*/^()'.includes(c)) {
      tokens.push({ type: c });
      i++;
      continue;
    }
    throw new Error(`Unexpected character "${c}"`);
  }
  return tokens;
}

// Recursive-descent parser, same precedence as sweepMath.js's (+ - lowest,
// then * /, then unary -, then ^ right-associative, then primaries), but
// evaluating eagerly to a { re, im } value at each step rather than
// compiling a closure tree -- see the file comment above for why that's
// possible here and isn't in sweepMath.js.
function parseExpression(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expect = (type) => {
    const t = next();
    if (!t || t.type !== type) throw new Error(`Expected "${type}"`);
    return t;
  };

  function parseExpr() {
    let value = parseTerm();
    for (;;) {
      const t = peek();
      if (t && (t.type === '+' || t.type === '-')) {
        next();
        const rhs = parseTerm();
        value = t.type === '+' ? cAdd(value, rhs) : cSub(value, rhs);
      } else break;
    }
    return value;
  }

  function parseTerm() {
    let value = parseUnary();
    for (;;) {
      const t = peek();
      if (t && (t.type === '*' || t.type === '/')) {
        next();
        const rhs = parseUnary();
        value = t.type === '*' ? cMul(value, rhs) : cDiv(value, rhs);
      } else break;
    }
    return value;
  }

  function parseUnary() {
    const t = peek();
    if (t && t.type === '-') { next(); return cNeg(parseUnary()); }
    if (t && t.type === '+') { next(); return parseUnary(); }
    return parsePower();
  }

  function parsePower() {
    const base = parsePrimary();
    const t = peek();
    if (t && t.type === '^') {
      next();
      const exponent = parseUnary(); // right-associative, and binds a leading unary minus (2^-1)
      return cPow(base, exponent);
    }
    return base;
  }

  function parsePrimary() {
    const t = next();
    if (!t) throw new Error('Expression ended unexpectedly');
    if (t.type === 'num') return { re: t.value, im: 0 };
    if (t.type === '(') {
      const inner = parseExpr();
      expect(')');
      return inner;
    }
    if (t.type === 'ident') {
      const name = t.value;
      if (peek() && peek().type === '(') {
        next();
        const arg = parseExpr();
        expect(')');
        const fn = FUNCTIONS[name];
        if (!fn) throw new Error(`Unknown function "${name}"`);
        return fn(arg);
      }
      if (name in CONSTANTS) return CONSTANTS[name];
      throw new Error(`Unknown name "${name}" (expected a number, i, e, pi, or sin/cos/tan/sqrt(...))`);
    }
    throw new Error('Unexpected token in expression');
  }

  const result = parseExpr();
  if (pos !== tokens.length) throw new Error('Unexpected trailing input');
  return result;
}

// Compiles an amplitude expression into { ok, value, error }. Unlike
// sweepMath.js's compileTrialFunction, an empty field isn't a valid resting
// state here -- every amplitude needs an actual value -- so it comes back
// as an ordinary error rather than a silent ok:false.
export function compileComplexExpression(source) {
  const trimmed = (source ?? '').trim();
  if (!trimmed) return { ok: false, error: 'Enter a number or expression', value: null };
  try {
    const value = parseExpression(tokenize(trimmed));
    if (Number.isNaN(value.re) || Number.isNaN(value.im)) throw new Error("Doesn't evaluate to a number");
    return { ok: true, error: null, value };
  } catch (err) {
    return { ok: false, error: err.message || 'Invalid expression', value: null };
  }
}
