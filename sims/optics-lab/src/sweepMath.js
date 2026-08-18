// Trial-function overlay evaluator (SweepPanel's SweepResultsPanel) -- a
// small hand-written parser/evaluator for a single-variable expression in
// `theta`, deliberately not `eval`/`new Function`: not for sandboxing an
// untrusted string (a student can only ever run this against their own
// browser), but so a typo produces a small, specific parse error instead of
// a raw JS SyntaxError/ReferenceError, and so the surface of what's callable
// is exactly the constants/functions listed below, nothing more -- no way
// to reach anything else in scope the way a bare `eval` would allow.
//
// `theta` (and every trig function's own argument) is in *degrees*,
// matching the sweep's own x-axis -- cos/sin/tan convert internally before
// calling the real Math functions, so a trial function can be typed exactly
// like the x-axis reads (`cos(2*theta)^2`) without the student having to
// convert to radians themselves; that conversion isn't the part of the
// exercise this overlay is for.

const FUNCTIONS = {
  sin: (x) => Math.sin((x * Math.PI) / 180),
  cos: (x) => Math.cos((x * Math.PI) / 180),
  tan: (x) => Math.tan((x * Math.PI) / 180),
  sqrt: Math.sqrt,
  abs: Math.abs,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
};
const CONSTANTS = { pi: Math.PI, e: Math.E };

// Scans a number starting at `start` (already known to begin with a digit
// or '.'), including an optional exponent (e.g. "1.5e-3") -- returns the
// index just past it.
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

// Recursive-descent parser, compiling directly to a closure tree (each node
// is a `(thetaDeg) => number` function) rather than a separate AST-then-
// evaluate pass -- one fewer data structure, and this expression is tiny.
// Standard precedence: + - lowest, then * /, then unary -, then ^ (right-
// associative), then primaries (numbers, theta, named constants, function
// calls, parens).
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
    let node = parseTerm();
    for (;;) {
      const t = peek();
      if (t && (t.type === '+' || t.type === '-')) {
        next();
        const rhs = parseTerm();
        const lhs = node;
        const op = t.type;
        node = (theta) => (op === '+' ? lhs(theta) + rhs(theta) : lhs(theta) - rhs(theta));
      } else break;
    }
    return node;
  }

  function parseTerm() {
    let node = parseUnary();
    for (;;) {
      const t = peek();
      if (t && (t.type === '*' || t.type === '/')) {
        next();
        const rhs = parseUnary();
        const lhs = node;
        const op = t.type;
        node = (theta) => (op === '*' ? lhs(theta) * rhs(theta) : lhs(theta) / rhs(theta));
      } else break;
    }
    return node;
  }

  function parseUnary() {
    const t = peek();
    if (t && t.type === '-') { next(); const inner = parseUnary(); return (theta) => -inner(theta); }
    if (t && t.type === '+') { next(); return parseUnary(); }
    return parsePower();
  }

  function parsePower() {
    const base = parsePrimary();
    const t = peek();
    if (t && t.type === '^') {
      next();
      const exponent = parseUnary(); // right-associative, and binds a leading unary minus (2^-1)
      return (theta) => Math.pow(base(theta), exponent(theta));
    }
    return base;
  }

  function parsePrimary() {
    const t = next();
    if (!t) throw new Error('Expression ended unexpectedly');
    if (t.type === 'num') { const v = t.value; return () => v; }
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
        return (theta) => fn(arg(theta));
      }
      if (name === 'theta') return (theta) => theta;
      if (name in CONSTANTS) { const v = CONSTANTS[name]; return () => v; }
      throw new Error(`Unknown name "${name}" (did you mean theta?)`);
    }
    throw new Error('Unexpected token in expression');
  }

  const result = parseExpr();
  if (pos !== tokens.length) throw new Error('Unexpected trailing input');
  return result;
}

// Compiles a trial-function string into { ok, evaluate, error }. An empty
// (or whitespace-only) source compiles to ok:false with a blank error --
// callers should treat that as "no overlay to draw" rather than a mistake
// worth flagging, since it's also the field's own resting state.
export function compileTrialFunction(source) {
  const trimmed = (source ?? '').trim();
  if (!trimmed) return { ok: false, error: '', evaluate: null };
  try {
    const evaluator = parseExpression(tokenize(trimmed));
    const probe = evaluator(0); // smoke-test once here, not mid-draw
    if (typeof probe !== 'number' || Number.isNaN(probe)) throw new Error('Doesn\'t evaluate to a number');
    return { ok: true, error: null, evaluate: (thetaDeg) => evaluator(thetaDeg) };
  } catch (err) {
    return { ok: false, error: err.message || 'Invalid expression', evaluate: null };
  }
}
