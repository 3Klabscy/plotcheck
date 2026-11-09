// Minimal, safe evaluator for OZFS Python-syntax expressions and conditions.
// Supports: numbers, identifiers, + - * / %, unary -, parentheses, comparisons
// (< <= > >= == !=), `and` / `or` / `not`, True / False, and min(...) / max(...).
// Anything else throws ExprError, which callers treat as "unencodable" -> "maybe".

export class ExprError extends Error {}

type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?/.exec(src.slice(i));
      if (!m) throw new ExprError(`bad number at ${i}`);
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0] });
      i += m[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["<=", ">=", "==", "!="].includes(two)) { out.push({ t: "op", v: two }); i += 2; continue; }
    if ("+-*/%()<>,".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    throw new ExprError(`unexpected '${c}' at ${i}`);
  }
  return out;
}

export type Vars = Record<string, number | boolean | undefined>;

export function evaluate(src: string | number | boolean, vars: Vars = {}): number | boolean {
  if (typeof src === "number" || typeof src === "boolean") return src;
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => { const t = peek(); return t?.t === "op" && t.v === v; };
  const isId = (v: string) => { const t = peek(); return t?.t === "id" && t.v === v; };
  const num = (x: number | boolean): number => (typeof x === "boolean" ? (x ? 1 : 0) : x);

  function primary(): number | boolean {
    const t = toks[p++];
    if (!t) throw new ExprError("unexpected end");
    if (t.t === "num") return t.v;
    if (t.t === "op" && t.v === "(") { const v = orExpr(); if (!isOp(")")) throw new ExprError("missing )"); p++; return v; }
    if (t.t === "op" && t.v === "-") return -num(primary());
    if (t.t === "id") {
      if (t.v === "True" || t.v === "true") return true;
      if (t.v === "False" || t.v === "false") return false;
      if ((t.v === "min" || t.v === "max") && isOp("(")) {
        p++;
        const args: number[] = [num(orExpr())];
        while (isOp(",")) { p++; args.push(num(orExpr())); }
        if (!isOp(")")) throw new ExprError("missing )");
        p++;
        return t.v === "min" ? Math.min(...args) : Math.max(...args);
      }
      const v = vars[t.v];
      if (v === undefined) throw new ExprError(`unknown variable '${t.v}'`);
      return v;
    }
    throw new ExprError(`unexpected token '${t.v}'`);
  }
  function mul(): number | boolean {
    let l = primary();
    while (isOp("*") || isOp("/") || isOp("%")) {
      const op = (toks[p++] as Tok).v; const r = num(primary());
      l = op === "*" ? num(l) * r : op === "/" ? num(l) / r : ((num(l) % r) + r) % r; // Python floor-modulo
    }
    return l;
  }
  function add(): number | boolean {
    let l = mul();
    while (isOp("+") || isOp("-")) { const op = (toks[p++] as Tok).v; const r = num(mul()); l = op === "+" ? num(l) + r : num(l) - r; }
    return l;
  }
  function cmp(): number | boolean {
    const l = add();
    for (const op of ["<=", ">=", "==", "!=", "<", ">"]) {
      if (isOp(op)) {
        p++; const r = num(add()); const a = num(l);
        return op === "<=" ? a <= r : op === ">=" ? a >= r : op === "==" ? a === r : op === "!=" ? a !== r : op === "<" ? a < r : a > r;
      }
    }
    return l;
  }
  function notExpr(): number | boolean { if (isId("not")) { p++; return !notExpr(); } return cmp(); }
  function andExpr(): number | boolean { let l = notExpr(); while (isId("and")) { p++; const r = notExpr(); l = Boolean(l) && Boolean(r); } return l; }
  function orExpr(): number | boolean { let l = andExpr(); while (isId("or")) { p++; const r = andExpr(); l = Boolean(l) || Boolean(r); } return l; }

  const v = orExpr();
  if (p !== toks.length) throw new ExprError("trailing input");
  return v;
}
