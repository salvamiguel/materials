# Variable Playground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an interactive HCL playground where students define Terraform variables, see real-time type validation, and view resolved resources + simulated plan output.

**Architecture:** Two files — `hclParser.ts` (pure logic: tokenize → parse → validate → evaluate) and `VariablePlayground.tsx` (React UI with editor, diagnostics, and output panels). Parser is split into 4 internal phases: tokenizer, parser, validator, evaluator.

**Tech Stack:** React 19, TypeScript, inline styles (one-dark palette), DemoWrapper component

**Spec:** `docs/superpowers/specs/2026-03-30-variable-playground-design.md`

---

## File Map

| File | Responsibility |
|------|---------------|
| `src/components/demos/terraform/hclParser.ts` | Tokenizer, parser, validator, evaluator — all pure functions. ~500 lines. Exports: `parse()`, `validate()`, `evaluate()`, and all type definitions. |
| `src/components/demos/terraform/VariablePlayground.tsx` | Editor with line numbers, diagnostics panel, output tabs (Resuelto/Plan), presets dropdown, debounced validation. ~400 lines. |

---

## Task 1: HCL Parser — Types and Tokenizer

**Files:**
- Create: `src/components/demos/terraform/hclParser.ts`

- [ ] **Step 1: Create the file with all exported types and the tokenizer**

```typescript
// src/components/demos/terraform/hclParser.ts

// ══════════════════════════════════════════
// Types
// ══════════════════════════════════════════

export type HclType =
  | { kind: 'primitive'; name: 'string' | 'number' | 'bool' }
  | { kind: 'list'; element: HclType }
  | { kind: 'map'; element: HclType }
  | { kind: 'object'; fields: Record<string, HclType> };

export interface VariableBlock {
  blockType: 'variable';
  name: string;
  type?: HclType;
  default?: HclValue;
  description?: string;
  line: number;
}

export interface LocalsBlock {
  blockType: 'locals';
  assignments: Record<string, HclExpr>;
  line: number;
}

export interface ResourceBlock {
  blockType: 'resource';
  resourceType: string;
  name: string;
  attributes: Record<string, HclExpr>;
  line: number;
}

export interface OutputBlock {
  blockType: 'output';
  name: string;
  value: HclExpr;
  line: number;
}

export type HclBlock = VariableBlock | LocalsBlock | ResourceBlock | OutputBlock;

export type HclExpr =
  | { kind: 'literal'; value: HclValue }
  | { kind: 'ref'; path: string[] }
  | { kind: 'interpolation'; parts: (string | HclExpr)[] }
  | { kind: 'list'; elements: HclExpr[] }
  | { kind: 'map'; entries: Record<string, HclExpr> };

export type HclValue = string | number | boolean | HclValue[] | Record<string, HclValue>;

export interface Diagnostic {
  severity: 'error' | 'warning';
  message: string;
  line: number;
  column?: number;
}

export interface ResolvedResource {
  type: string;
  name: string;
  attributes: Record<string, HclValue>;
}

export interface EvalResult {
  resolvedResources: ResolvedResource[];
  outputs: Record<string, HclValue>;
  planText: string;
}

// ══════════════════════════════════════════
// Tokenizer
// ══════════════════════════════════════════

interface Token {
  type: 'keyword' | 'string' | 'number' | 'bool' | 'ident' | 'lbrace' | 'rbrace' |
        'lbracket' | 'rbracket' | 'lparen' | 'rparen' | 'equals' | 'dot' | 'comma' |
        'interpolation' | 'eof';
  value: string;
  line: number;
  col: number;
}

const KEYWORDS = new Set(['variable', 'locals', 'resource', 'output', 'type', 'default', 'description', 'value',
  'string', 'number', 'bool', 'list', 'map', 'object', 'true', 'false', 'var', 'local', 'sensitive', 'nullable']);

function tokenize(source: string): { tokens: Token[]; errors: Diagnostic[] } {
  const tokens: Token[] = [];
  const errors: Diagnostic[] = [];
  let i = 0;
  let line = 1;
  let col = 1;

  function advance(n = 1) {
    for (let j = 0; j < n; j++) {
      if (source[i] === '\n') { line++; col = 1; } else { col++; }
      i++;
    }
  }

  function peek() { return i < source.length ? source[i] : ''; }
  function peekAt(offset: number) { return i + offset < source.length ? source[i + offset] : ''; }

  while (i < source.length) {
    // Skip whitespace
    if (/\s/.test(peek())) { advance(); continue; }

    // Skip comments (# and //)
    if (peek() === '#' || (peek() === '/' && peekAt(1) === '/')) {
      while (i < source.length && peek() !== '\n') advance();
      continue;
    }

    // Skip block comments /* ... */
    if (peek() === '/' && peekAt(1) === '*') {
      advance(2);
      while (i < source.length && !(peek() === '*' && peekAt(1) === '/')) advance();
      if (i < source.length) advance(2);
      continue;
    }

    const startLine = line;
    const startCol = col;

    // String with interpolation
    if (peek() === '"') {
      advance(); // skip opening quote
      let str = '';
      let hasInterpolation = false;
      const parts: string[] = [];

      while (i < source.length && peek() !== '"') {
        if (peek() === '\\') {
          advance();
          if (peek() === 'n') { str += '\n'; advance(); }
          else if (peek() === 't') { str += '\t'; advance(); }
          else if (peek() === '"') { str += '"'; advance(); }
          else if (peek() === '\\') { str += '\\'; advance(); }
          else { str += peek(); advance(); }
        } else if (peek() === '$' && peekAt(1) === '{') {
          hasInterpolation = true;
          if (str) parts.push(JSON.stringify(str));
          str = '';
          advance(2); // skip ${
          let depth = 1;
          let expr = '';
          while (i < source.length && depth > 0) {
            if (peek() === '{') depth++;
            if (peek() === '}') { depth--; if (depth === 0) break; }
            expr += peek();
            advance();
          }
          if (peek() === '}') advance();
          parts.push('${' + expr + '}');
        } else {
          str += peek();
          advance();
        }
      }

      if (i < source.length) advance(); // skip closing quote

      if (hasInterpolation) {
        if (str) parts.push(JSON.stringify(str));
        tokens.push({ type: 'interpolation', value: parts.join('|||'), line: startLine, col: startCol });
      } else {
        tokens.push({ type: 'string', value: str, line: startLine, col: startCol });
      }
      continue;
    }

    // Numbers
    if (/[0-9]/.test(peek()) || (peek() === '-' && /[0-9]/.test(peekAt(1)))) {
      let num = '';
      if (peek() === '-') { num += '-'; advance(); }
      while (i < source.length && /[0-9.]/.test(peek())) { num += peek(); advance(); }
      tokens.push({ type: 'number', value: num, line: startLine, col: startCol });
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(peek())) {
      let ident = '';
      while (i < source.length && /[a-zA-Z0-9_]/.test(peek())) { ident += peek(); advance(); }
      if (ident === 'true' || ident === 'false') {
        tokens.push({ type: 'bool', value: ident, line: startLine, col: startCol });
      } else if (KEYWORDS.has(ident)) {
        tokens.push({ type: 'keyword', value: ident, line: startLine, col: startCol });
      } else {
        tokens.push({ type: 'ident', value: ident, line: startLine, col: startCol });
      }
      continue;
    }

    // Single-char tokens
    const charMap: Record<string, Token['type']> = {
      '{': 'lbrace', '}': 'rbrace', '[': 'lbracket', ']': 'rbracket',
      '(': 'lparen', ')': 'rparen', '=': 'equals', '.': 'dot', ',': 'comma',
    };
    if (charMap[peek()]) {
      tokens.push({ type: charMap[peek()], value: peek(), line: startLine, col: startCol });
      advance();
      continue;
    }

    errors.push({ severity: 'error', message: `Carácter inesperado: '${peek()}'`, line: startLine, column: startCol });
    advance();
  }

  tokens.push({ type: 'eof', value: '', line, col });
  return { tokens, errors };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/salva/Documents/WORKING/materials && npx tsc --noEmit src/components/demos/terraform/hclParser.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/demos/terraform/hclParser.ts
git commit -m "feat(playground): add HCL types and tokenizer"
```

---

## Task 2: HCL Parser — Block Parser

**Files:**
- Modify: `src/components/demos/terraform/hclParser.ts`

- [ ] **Step 1: Add the parser after the tokenizer**

Append this code at the end of `hclParser.ts`:

```typescript
// ══════════════════════════════════════════
// Parser
// ══════════════════════════════════════════

class Parser {
  private tokens: Token[];
  private pos = 0;
  private errors: Diagnostic[] = [];

  constructor(tokens: Token[]) { this.tokens = tokens; }

  private peek(): Token { return this.tokens[this.pos] ?? this.tokens[this.tokens.length - 1]; }
  private advance(): Token { return this.tokens[this.pos++]; }
  private expect(type: Token['type'], context: string): Token | null {
    const t = this.peek();
    if (t.type !== type) {
      this.errors.push({ severity: 'error', message: `Error de sintaxis en línea ${t.line}: se esperaba ${type} en ${context}`, line: t.line, column: t.col });
      return null;
    }
    return this.advance();
  }
  private match(type: Token['type']): Token | null {
    if (this.peek().type === type) return this.advance();
    return null;
  }

  parseAll(): { blocks: HclBlock[]; errors: Diagnostic[] } {
    const blocks: HclBlock[] = [];
    while (this.peek().type !== 'eof') {
      const block = this.parseBlock();
      if (block) blocks.push(block);
      else this.advance(); // skip bad token to avoid infinite loop
    }
    return { blocks, errors: this.errors };
  }

  private parseBlock(): HclBlock | null {
    const t = this.peek();
    if (t.type === 'keyword') {
      switch (t.value) {
        case 'variable': return this.parseVariable();
        case 'locals': return this.parseLocals();
        case 'resource': return this.parseResource();
        case 'output': return this.parseOutput();
      }
    }
    this.errors.push({ severity: 'error', message: `Error de sintaxis en línea ${t.line}: se esperaba variable, locals, resource u output`, line: t.line, column: t.col });
    return null;
  }

  private parseVariable(): VariableBlock {
    const kw = this.advance(); // 'variable'
    const nameToken = this.expect('string', 'nombre de variable');
    const name = nameToken?.value ?? 'unknown';
    this.expect('lbrace', 'bloque variable');

    let type: HclType | undefined;
    let defaultVal: HclValue | undefined;
    let description: string | undefined;

    while (this.peek().type !== 'rbrace' && this.peek().type !== 'eof') {
      const attr = this.peek();
      if (attr.type === 'keyword' && attr.value === 'type') {
        this.advance();
        this.expect('equals', 'asignación de type');
        type = this.parseHclType();
      } else if (attr.type === 'keyword' && attr.value === 'default') {
        this.advance();
        this.expect('equals', 'asignación de default');
        defaultVal = this.parseValueLiteral();
      } else if (attr.type === 'keyword' && attr.value === 'description') {
        this.advance();
        this.expect('equals', 'asignación de description');
        const s = this.expect('string', 'valor de description');
        description = s?.value;
      } else if (attr.type === 'keyword' && (attr.value === 'sensitive' || attr.value === 'nullable')) {
        this.advance();
        this.expect('equals', `asignación de ${attr.value}`);
        this.advance(); // skip the bool value
      } else {
        this.advance(); // skip unknown
      }
    }
    this.match('rbrace');
    return { blockType: 'variable', name, type, default: defaultVal, description, line: kw.line };
  }

  private parseLocals(): LocalsBlock {
    const kw = this.advance(); // 'locals'
    this.expect('lbrace', 'bloque locals');
    const assignments: Record<string, HclExpr> = {};

    while (this.peek().type !== 'rbrace' && this.peek().type !== 'eof') {
      const ident = this.peek();
      if (ident.type === 'ident' || ident.type === 'keyword') {
        const key = this.advance().value;
        this.expect('equals', 'asignación local');
        assignments[key] = this.parseExpr();
      } else {
        this.advance();
      }
    }
    this.match('rbrace');
    return { blockType: 'locals', assignments, line: kw.line };
  }

  private parseResource(): ResourceBlock {
    const kw = this.advance(); // 'resource'
    const typeToken = this.expect('string', 'tipo de resource');
    const nameToken = this.expect('string', 'nombre de resource');
    this.expect('lbrace', 'bloque resource');
    const attributes = this.parseAttributes();
    this.match('rbrace');
    return { blockType: 'resource', resourceType: typeToken?.value ?? 'unknown', name: nameToken?.value ?? 'unknown', attributes, line: kw.line };
  }

  private parseOutput(): OutputBlock {
    const kw = this.advance(); // 'output'
    const nameToken = this.expect('string', 'nombre de output');
    this.expect('lbrace', 'bloque output');
    let value: HclExpr = { kind: 'literal', value: '' };

    while (this.peek().type !== 'rbrace' && this.peek().type !== 'eof') {
      const attr = this.peek();
      if (attr.type === 'keyword' && attr.value === 'value') {
        this.advance();
        this.expect('equals', 'asignación de value');
        value = this.parseExpr();
      } else if (attr.type === 'keyword' && attr.value === 'description') {
        this.advance();
        this.expect('equals', 'asignación de description');
        this.advance(); // skip string value
      } else {
        this.advance();
      }
    }
    this.match('rbrace');
    return { blockType: 'output', name: nameToken?.value ?? 'unknown', value, line: kw.line };
  }

  private parseAttributes(): Record<string, HclExpr> {
    const attrs: Record<string, HclExpr> = {};
    while (this.peek().type !== 'rbrace' && this.peek().type !== 'eof') {
      const ident = this.peek();
      if (ident.type === 'ident' || ident.type === 'keyword') {
        const key = this.advance().value;
        this.expect('equals', `asignación de ${key}`);
        attrs[key] = this.parseExpr();
      } else {
        this.advance();
      }
    }
    return attrs;
  }

  private parseHclType(): HclType {
    const t = this.peek();
    if (t.type === 'keyword') {
      if (t.value === 'string' || t.value === 'number' || t.value === 'bool') {
        this.advance();
        return { kind: 'primitive', name: t.value };
      }
      if (t.value === 'list') {
        this.advance();
        this.expect('lparen', 'list(type)');
        const element = this.parseHclType();
        this.expect('rparen', 'list(type)');
        return { kind: 'list', element };
      }
      if (t.value === 'map') {
        this.advance();
        this.expect('lparen', 'map(type)');
        const element = this.parseHclType();
        this.expect('rparen', 'map(type)');
        return { kind: 'map', element };
      }
      if (t.value === 'object') {
        this.advance();
        this.expect('lparen', 'object({})');
        this.expect('lbrace', 'object({})');
        const fields: Record<string, HclType> = {};
        while (this.peek().type !== 'rbrace' && this.peek().type !== 'eof') {
          const key = this.peek();
          if (key.type === 'ident' || key.type === 'keyword') {
            const fieldName = this.advance().value;
            this.expect('equals', `campo ${fieldName}`);
            fields[fieldName] = this.parseHclType();
            this.match('comma');
          } else {
            this.advance();
          }
        }
        this.match('rbrace');
        this.expect('rparen', 'object({})');
        return { kind: 'object', fields };
      }
    }
    this.errors.push({ severity: 'error', message: `Error de sintaxis en línea ${t.line}: tipo no reconocido "${t.value}"`, line: t.line });
    this.advance();
    return { kind: 'primitive', name: 'string' };
  }

  private parseExpr(): HclExpr {
    const t = this.peek();

    // Interpolation string
    if (t.type === 'interpolation') {
      this.advance();
      const rawParts = t.value.split('|||');
      const parts: (string | HclExpr)[] = rawParts.map(part => {
        if (part.startsWith('${') && part.endsWith('}')) {
          const inner = part.slice(2, -1).trim();
          const segments = inner.split('.');
          return { kind: 'ref' as const, path: segments };
        }
        // It's a JSON-encoded string literal
        try { return JSON.parse(part) as string; }
        catch { return part; }
      });
      return { kind: 'interpolation', parts };
    }

    // Plain string
    if (t.type === 'string') {
      this.advance();
      return { kind: 'literal', value: t.value };
    }

    // Number
    if (t.type === 'number') {
      this.advance();
      return { kind: 'literal', value: parseFloat(t.value) };
    }

    // Bool
    if (t.type === 'bool') {
      this.advance();
      return { kind: 'literal', value: t.value === 'true' };
    }

    // Reference: var.name or local.name
    if ((t.type === 'keyword' && (t.value === 'var' || t.value === 'local')) || t.type === 'ident') {
      const path: string[] = [this.advance().value];
      while (this.peek().type === 'dot') {
        this.advance(); // skip dot
        const next = this.peek();
        if (next.type === 'ident' || next.type === 'keyword') {
          path.push(this.advance().value);
        }
      }
      if (path.length > 1) return { kind: 'ref', path };
      // Single ident — treat as string literal (e.g. bare keyword used as value)
      return { kind: 'literal', value: path[0] };
    }

    // List: [expr, expr]
    if (t.type === 'lbracket') {
      this.advance();
      const elements: HclExpr[] = [];
      while (this.peek().type !== 'rbracket' && this.peek().type !== 'eof') {
        elements.push(this.parseExpr());
        this.match('comma');
      }
      this.match('rbracket');
      return { kind: 'list', elements };
    }

    // Map: { key = expr, ... }
    if (t.type === 'lbrace') {
      this.advance();
      const entries: Record<string, HclExpr> = {};
      while (this.peek().type !== 'rbrace' && this.peek().type !== 'eof') {
        const key = this.peek();
        if (key.type === 'ident' || key.type === 'keyword' || key.type === 'string') {
          const keyName = this.advance().value;
          this.expect('equals', `campo ${keyName}`);
          entries[keyName] = this.parseExpr();
          this.match('comma');
        } else {
          this.advance();
        }
      }
      this.match('rbrace');
      return { kind: 'map', entries };
    }

    this.errors.push({ severity: 'error', message: `Error de sintaxis en línea ${t.line}: expresión inesperada "${t.value}"`, line: t.line });
    this.advance();
    return { kind: 'literal', value: '' };
  }

  private parseValueLiteral(): HclValue {
    const expr = this.parseExpr();
    return this.exprToValue(expr);
  }

  private exprToValue(expr: HclExpr): HclValue {
    switch (expr.kind) {
      case 'literal': return expr.value;
      case 'list': return expr.elements.map(e => this.exprToValue(e));
      case 'map': {
        const obj: Record<string, HclValue> = {};
        for (const [k, v] of Object.entries(expr.entries)) obj[k] = this.exprToValue(v);
        return obj;
      }
      default: return '';
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/salva/Documents/WORKING/materials && npx tsc --noEmit src/components/demos/terraform/hclParser.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/demos/terraform/hclParser.ts
git commit -m "feat(playground): add HCL block parser"
```

---

## Task 3: HCL Parser — Validator and Evaluator

**Files:**
- Modify: `src/components/demos/terraform/hclParser.ts`

- [ ] **Step 1: Add validator, evaluator, and public API**

Append this code at the end of `hclParser.ts`:

```typescript
// ══════════════════════════════════════════
// Validator
// ══════════════════════════════════════════

function inferValueType(value: HclValue): HclType {
  if (typeof value === 'string') return { kind: 'primitive', name: 'string' };
  if (typeof value === 'number') return { kind: 'primitive', name: 'number' };
  if (typeof value === 'boolean') return { kind: 'primitive', name: 'bool' };
  if (Array.isArray(value)) {
    if (value.length === 0) return { kind: 'list', element: { kind: 'primitive', name: 'string' } };
    return { kind: 'list', element: inferValueType(value[0]) };
  }
  if (typeof value === 'object' && value !== null) {
    const fields: Record<string, HclType> = {};
    for (const [k, v] of Object.entries(value)) fields[k] = inferValueType(v);
    return { kind: 'object', fields };
  }
  return { kind: 'primitive', name: 'string' };
}

function typeToString(t: HclType): string {
  switch (t.kind) {
    case 'primitive': return t.name;
    case 'list': return `list(${typeToString(t.element)})`;
    case 'map': return `map(${typeToString(t.element)})`;
    case 'object': {
      const fields = Object.entries(t.fields).map(([k, v]) => `${k} = ${typeToString(v)}`).join(', ');
      return `object({ ${fields} })`;
    }
  }
}

function typesMatch(expected: HclType, actual: HclType): boolean {
  if (expected.kind === 'primitive' && actual.kind === 'primitive') return expected.name === actual.name;
  if (expected.kind === 'list' && actual.kind === 'list') return typesMatch(expected.element, actual.element);
  if (expected.kind === 'map' && actual.kind === 'map') return typesMatch(expected.element, actual.element);
  if (expected.kind === 'object' && actual.kind === 'object') {
    for (const key of Object.keys(expected.fields)) {
      if (!(key in actual.fields)) return false;
      if (!typesMatch(expected.fields[key], actual.fields[key])) return false;
    }
    return true;
  }
  return false;
}

function validateBlocks(blocks: HclBlock[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const variables = new Map<string, VariableBlock>();
  const locals = new Map<string, HclExpr>();

  // Collect declarations
  for (const block of blocks) {
    if (block.blockType === 'variable') variables.set(block.name, block);
    if (block.blockType === 'locals') {
      for (const [k, v] of Object.entries(block.assignments)) locals.set(k, v);
    }
  }

  // Validate variables
  for (const block of blocks) {
    if (block.blockType === 'variable') {
      if (!block.type) {
        diagnostics.push({ severity: 'warning', message: `Variable "${block.name}" no tiene tipo definido`, line: block.line });
      }
      if (block.type && block.default !== undefined) {
        const actualType = inferValueType(block.default);
        if (!typesMatch(block.type, actualType)) {
          diagnostics.push({
            severity: 'error',
            message: `El default de "${block.name}" es ${typeToString(actualType)} pero se espera ${typeToString(block.type)}`,
            line: block.line,
          });
        }
      }
    }
  }

  // Validate references in expressions
  function checkExpr(expr: HclExpr, line: number) {
    if (expr.kind === 'ref') {
      if (expr.path[0] === 'var' && expr.path.length >= 2) {
        const varName = expr.path[1];
        if (!variables.has(varName)) {
          diagnostics.push({ severity: 'error', message: `Variable "${varName}" no está definida`, line });
        }
      }
      if (expr.path[0] === 'local' && expr.path.length >= 2) {
        const localName = expr.path[1];
        if (!locals.has(localName)) {
          diagnostics.push({ severity: 'error', message: `Local "${localName}" no está definido`, line });
        }
      }
    }
    if (expr.kind === 'interpolation') {
      for (const part of expr.parts) {
        if (typeof part !== 'string') checkExpr(part, line);
      }
    }
    if (expr.kind === 'list') {
      for (const el of expr.elements) checkExpr(el, line);
    }
    if (expr.kind === 'map') {
      for (const val of Object.values(expr.entries)) checkExpr(val, line);
    }
  }

  for (const block of blocks) {
    if (block.blockType === 'resource') {
      for (const expr of Object.values(block.attributes)) checkExpr(expr, block.line);
    }
    if (block.blockType === 'output') {
      checkExpr(block.value, block.line);
    }
    if (block.blockType === 'locals') {
      for (const expr of Object.values(block.assignments)) checkExpr(expr, block.line);
    }
  }

  return diagnostics;
}

// ══════════════════════════════════════════
// Evaluator
// ══════════════════════════════════════════

function evaluateBlocks(blocks: HclBlock[]): EvalResult {
  // Build scope
  const scope: Record<string, HclValue> = {};

  // Variables: use default values
  for (const block of blocks) {
    if (block.blockType === 'variable' && block.default !== undefined) {
      scope[`var.${block.name}`] = block.default;
    }
  }

  // Locals
  for (const block of blocks) {
    if (block.blockType === 'locals') {
      for (const [k, expr] of Object.entries(block.assignments)) {
        scope[`local.${k}`] = resolveExpr(expr, scope);
      }
    }
  }

  // Resolve resources
  const resolvedResources: ResolvedResource[] = [];
  for (const block of blocks) {
    if (block.blockType === 'resource') {
      const attrs: Record<string, HclValue> = {};
      for (const [k, expr] of Object.entries(block.attributes)) {
        attrs[k] = resolveExpr(expr, scope);
      }
      resolvedResources.push({ type: block.resourceType, name: block.name, attributes: attrs });
    }
  }

  // Resolve outputs
  const outputs: Record<string, HclValue> = {};
  for (const block of blocks) {
    if (block.blockType === 'output') {
      outputs[block.name] = resolveExpr(block.value, scope);
    }
  }

  // Generate plan text
  const planText = generatePlan(resolvedResources, outputs);

  return { resolvedResources, outputs, planText };
}

function resolveExpr(expr: HclExpr, scope: Record<string, HclValue>): HclValue {
  switch (expr.kind) {
    case 'literal':
      return expr.value;
    case 'ref': {
      const key = expr.path.join('.');
      return scope[key] ?? `<${key}>`;
    }
    case 'interpolation': {
      let result = '';
      for (const part of expr.parts) {
        if (typeof part === 'string') {
          result += part;
        } else {
          const val = resolveExpr(part, scope);
          result += String(val);
        }
      }
      return result;
    }
    case 'list':
      return expr.elements.map(e => resolveExpr(e, scope));
    case 'map': {
      const obj: Record<string, HclValue> = {};
      for (const [k, v] of Object.entries(expr.entries)) obj[k] = resolveExpr(v, scope);
      return obj;
    }
  }
}

function formatValue(value: HclValue, indent = 0): string {
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map(v => `${' '.repeat(indent + 2)}${formatValue(v, indent + 2)}`).join(',\n');
    return `[\n${items}\n${' '.repeat(indent)}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    const lines = entries.map(([k, v]) => `${' '.repeat(indent + 2)}${k} = ${formatValue(v, indent + 2)}`).join('\n');
    return `{\n${lines}\n${' '.repeat(indent)}}`;
  }
  return String(value);
}

function generatePlan(resources: ResolvedResource[], outputs: Record<string, HclValue>): string {
  const lines: string[] = [];
  lines.push('Terraform will perform the following actions:');
  lines.push('');

  for (const res of resources) {
    lines.push(`  # ${res.type}.${res.name} will be created`);
    lines.push(`  + resource "${res.type}" "${res.name}" {`);
    for (const [k, v] of Object.entries(res.attributes)) {
      const formatted = formatValue(v, 6);
      lines.push(`      + ${k} = ${formatted}`);
    }
    lines.push('    }');
    lines.push('');
  }

  lines.push(`Plan: ${resources.length} to add, 0 to change, 0 to destroy.`);

  if (Object.keys(outputs).length > 0) {
    lines.push('');
    lines.push('Outputs:');
    for (const [k, v] of Object.entries(outputs)) {
      lines.push(`  ${k} = ${formatValue(v)}`);
    }
  }

  return lines.join('\n');
}

// ══════════════════════════════════════════
// Public API
// ══════════════════════════════════════════

export function parse(source: string): { blocks: HclBlock[]; errors: Diagnostic[] } {
  const { tokens, errors: tokenErrors } = tokenize(source);
  if (tokenErrors.length > 0) return { blocks: [], errors: tokenErrors };
  const parser = new Parser(tokens);
  const { blocks, errors: parseErrors } = parser.parseAll();
  return { blocks, errors: [...tokenErrors, ...parseErrors] };
}

export function validate(blocks: HclBlock[]): Diagnostic[] {
  return validateBlocks(blocks);
}

export function evaluate(blocks: HclBlock[]): EvalResult {
  return evaluateBlocks(blocks);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/salva/Documents/WORKING/materials && npx tsc --noEmit src/components/demos/terraform/hclParser.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/demos/terraform/hclParser.ts
git commit -m "feat(playground): add HCL validator, evaluator, and public API"
```

---

## Task 4: VariablePlayground — UI Component

**Files:**
- Create: `src/components/demos/terraform/VariablePlayground.tsx`

- [ ] **Step 1: Create the playground component**

```tsx
// src/components/demos/terraform/VariablePlayground.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import DemoWrapper from '../../shared/DemoWrapper';
import { parse, validate, evaluate } from './hclParser';
import type { Diagnostic, EvalResult } from './hclParser';

const FONT = "'JetBrains Mono', 'Fira Code', monospace";

// ── Presets ──
const PRESETS: Record<string, { label: string; code: string }> = {
  basic: {
    label: 'Tipos básicos',
    code: `variable "nombre" {
  type    = string
  default = "servidor-web"
}

variable "puerto" {
  type    = number
  default = 8080
}

variable "activo" {
  type    = bool
  default = true
}

resource "local_file" "config" {
  filename = "/tmp/config.txt"
  content  = var.nombre
}

output "resumen" {
  value = "Servidor: \${var.nombre}, puerto: \${var.puerto}"
}`,
  },
  lists: {
    label: 'Listas y maps',
    code: `variable "entornos" {
  type    = list(string)
  default = ["dev", "staging", "prod"]
}

variable "puertos" {
  type    = map(number)
  default = {
    http  = 80
    https = 443
    ssh   = 22
  }
}

resource "local_file" "lista" {
  filename = "/tmp/entornos.txt"
  content  = var.entornos
}

output "puertos_config" {
  value = var.puertos
}`,
  },
  object: {
    label: 'Object',
    code: `variable "app" {
  type = object({
    name = string,
    port = number,
    debug = bool
  })
  default = {
    name  = "mi-api"
    port  = 3000
    debug = false
  }
}

resource "local_file" "app_config" {
  filename = "/tmp/app.json"
  content  = var.app
}

output "app_name" {
  value = var.app
}`,
  },
  interpolation: {
    label: 'Interpolación',
    code: `variable "proyecto" {
  type    = string
  default = "terraform-lab"
}

variable "entorno" {
  type    = string
  default = "produccion"
}

locals {
  nombre_completo = "\${var.proyecto}-\${var.entorno}"
  bucket_name     = "s3-\${var.proyecto}-\${var.entorno}-assets"
}

resource "local_file" "readme" {
  filename = "/tmp/\${var.proyecto}/README.md"
  content  = "Proyecto: \${local.nombre_completo}"
}

output "bucket" {
  value = local.bucket_name
}`,
  },
  error: {
    label: 'Error de tipo',
    code: `variable "puerto" {
  type    = number
  default = "no-soy-un-numero"
}

variable "tags" {
  type = map(string)
  default = {
    Name = "web"
    Port = 8080
  }
}

resource "local_file" "broken" {
  filename = var.indefinida
  content  = "test"
}`,
  },
  empty: {
    label: 'Vacío',
    code: '',
  },
};

// ── Styles ──
const colors = {
  bg: '#282c34',
  bgLight: '#2c313a',
  text: '#abb2bf',
  green: '#98c379',
  red: '#e06c75',
  yellow: '#e5c07b',
  blue: '#61afef',
  purple: '#c678dd',
  cyan: '#56b6c2',
  gutter: '#4b5263',
  border: '#3e4451',
  selection: '#3e4451',
};

const panelStyle: React.CSSProperties = {
  background: colors.bg,
  borderRadius: 8,
  border: `1px solid ${colors.border}`,
  overflow: 'hidden',
};

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: '6px 16px',
  fontFamily: FONT,
  fontSize: '0.75rem',
  fontWeight: 500,
  cursor: 'pointer',
  border: 'none',
  background: active ? colors.bg : 'transparent',
  color: active ? 'var(--ifm-color-primary)' : colors.gutter,
  borderBottom: active ? '2px solid var(--ifm-color-primary)' : '2px solid transparent',
  transition: 'all 0.15s ease',
});

export default function VariablePlayground() {
  const [code, setCode] = useState(PRESETS.basic.code);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [activeTab, setActiveTab] = useState<'resolved' | 'plan'>('plan');
  const [visiblePlanLines, setVisiblePlanLines] = useState<string[]>([]);
  const [planAnimating, setPlanAnimating] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const planRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced parse + validate + evaluate
  const processCode = useCallback((source: string) => {
    const { blocks, errors: parseErrors } = parse(source);
    const validationErrors = parseErrors.length === 0 ? validate(blocks) : [];
    const allDiagnostics = [...parseErrors, ...validationErrors];
    setDiagnostics(allDiagnostics);

    const hasErrors = allDiagnostics.some(d => d.severity === 'error');
    if (!hasErrors && blocks.length > 0) {
      const result = evaluate(blocks);
      setEvalResult(result);
      // Trigger plan animation
      setPlanAnimating(true);
      setVisiblePlanLines([]);
    } else {
      setEvalResult(null);
      setVisiblePlanLines([]);
      setPlanAnimating(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => processCode(code), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [code, processCode]);

  // Plan line-by-line animation
  useEffect(() => {
    if (!planAnimating || !evalResult) return;
    const allLines = evalResult.planText.split('\n');
    let idx = 0;
    const interval = setInterval(() => {
      if (idx < allLines.length) {
        setVisiblePlanLines(prev => [...prev, allLines[idx]]);
        idx++;
        if (planRef.current) planRef.current.scrollTop = planRef.current.scrollHeight;
      } else {
        clearInterval(interval);
        setPlanAnimating(false);
      }
    }, 60);
    return () => clearInterval(interval);
  }, [planAnimating, evalResult]);

  const handlePresetChange = (key: string) => {
    setCode(PRESETS[key].code);
  };

  const errorLines = new Set(diagnostics.map(d => d.line));
  const codeLines = code.split('\n');

  // Format resolved resources for display
  const resolvedText = evalResult ? evalResult.resolvedResources.map(res => {
    const attrs = Object.entries(res.attributes).map(([k, v]) => {
      const formatted = typeof v === 'string' ? `"${v}"` :
        typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
      return `  ${k} = ${formatted}`;
    }).join('\n');
    return `resource "${res.type}" "${res.name}" {\n${attrs}\n}`;
  }).join('\n\n') + (Object.keys(evalResult.outputs).length > 0 ? '\n\n' + Object.entries(evalResult.outputs).map(([k, v]) => {
    const formatted = typeof v === 'string' ? `"${v}"` : JSON.stringify(v, null, 2);
    return `output "${k}" = ${formatted}`;
  }).join('\n') : '') : '';

  return (
    <DemoWrapper title="Playground de Variables" description="Define variables HCL y observa cómo se resuelven en recursos y plan">
      {/* Preset selector */}
      <div style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ fontFamily: FONT, fontSize: '0.72rem', color: colors.gutter, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Ejemplo:
        </span>
        <select
          onChange={e => handlePresetChange(e.target.value)}
          style={{
            fontFamily: FONT, fontSize: '0.8rem', padding: '4px 8px', borderRadius: 4,
            border: `1px solid ${colors.border}`, background: colors.bgLight, color: colors.text,
            cursor: 'pointer',
          }}
        >
          {Object.entries(PRESETS).map(([key, { label }]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {/* Two-panel layout */}
      <div style={{ display: 'flex', gap: '0.75rem', minHeight: 400 }}>
        {/* Left panel: Editor */}
        <div style={{ flex: '0 0 60%', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ ...panelStyle, flex: 1, display: 'flex', overflow: 'auto' }}>
            {/* Line numbers */}
            <div style={{
              padding: '12px 8px 12px 12px', fontFamily: FONT, fontSize: '0.8rem', lineHeight: '1.5',
              color: colors.gutter, textAlign: 'right', userSelect: 'none', minWidth: 36, flexShrink: 0,
              background: colors.bg, borderRight: `1px solid ${colors.border}`,
            }}>
              {codeLines.map((_, i) => (
                <div key={i} style={{ color: errorLines.has(i + 1) ? colors.red : colors.gutter }}>
                  {i + 1}
                </div>
              ))}
            </div>
            {/* Textarea */}
            <textarea
              ref={editorRef}
              value={code}
              onChange={e => setCode(e.target.value)}
              spellCheck={false}
              style={{
                flex: 1, padding: '12px', fontFamily: FONT, fontSize: '0.8rem', lineHeight: '1.5',
                color: colors.text, background: 'transparent', border: 'none', outline: 'none',
                resize: 'none', minHeight: 300, whiteSpace: 'pre', overflowWrap: 'normal', overflowX: 'auto',
              }}
            />
          </div>

          {/* Diagnostics panel */}
          {diagnostics.length > 0 && (
            <div style={{ ...panelStyle, padding: '8px 12px', maxHeight: 120, overflowY: 'auto' }}>
              {diagnostics.map((d, i) => (
                <div key={i} style={{
                  fontFamily: FONT, fontSize: '0.75rem', lineHeight: '1.6',
                  color: d.severity === 'error' ? colors.red : colors.yellow,
                  cursor: 'pointer',
                }} onClick={() => {
                  if (editorRef.current) {
                    const lines = code.split('\n');
                    let charIndex = 0;
                    for (let l = 0; l < d.line - 1 && l < lines.length; l++) charIndex += lines[l].length + 1;
                    editorRef.current.focus();
                    editorRef.current.setSelectionRange(charIndex, charIndex);
                  }
                }}>
                  {d.severity === 'error' ? '✗' : '⚠'} Línea {d.line}: {d.message}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right panel: Output */}
        <div style={{ flex: 1, ...panelStyle, display: 'flex', flexDirection: 'column' }}>
          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: `1px solid ${colors.border}` }}>
            <button style={tabStyle(activeTab === 'resolved')} onClick={() => setActiveTab('resolved')}>Resuelto</button>
            <button style={tabStyle(activeTab === 'plan')} onClick={() => setActiveTab('plan')}>Plan</button>
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflow: 'auto', padding: '12px', fontFamily: FONT, fontSize: '0.78rem', lineHeight: '1.6' }}>
            {activeTab === 'resolved' && (
              <pre style={{ margin: 0, color: colors.text, whiteSpace: 'pre-wrap' }}>
                {evalResult ? resolvedText : (
                  <span style={{ color: colors.gutter, fontStyle: 'italic' }}>
                    {diagnostics.some(d => d.severity === 'error')
                      ? 'Corrige los errores para ver el resultado'
                      : 'Escribe código HCL para comenzar'}
                  </span>
                )}
              </pre>
            )}

            {activeTab === 'plan' && (
              <div ref={planRef} style={{ margin: 0 }}>
                {visiblePlanLines.length > 0 ? visiblePlanLines.map((line, i) => (
                  <div key={i} style={{
                    color: line.trim().startsWith('+') ? colors.green :
                           line.trim().startsWith('#') ? colors.gutter :
                           line.startsWith('Plan:') ? colors.cyan :
                           line.startsWith('Outputs:') ? colors.blue :
                           colors.text,
                    whiteSpace: 'pre',
                  }}>
                    {line || '\u00A0'}
                  </div>
                )) : (
                  <span style={{ color: colors.gutter, fontStyle: 'italic' }}>
                    {diagnostics.some(d => d.severity === 'error')
                      ? 'Corrige los errores para ver el plan'
                      : 'Escribe código HCL para comenzar'}
                  </span>
                )}
                {planAnimating && (
                  <span style={{ color: 'var(--ifm-color-primary)', animation: 'planPulse 0.8s infinite' }}>▋</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes planPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @media (max-width: 768px) {
          .variable-playground-panels {
            flex-direction: column !important;
          }
          .variable-playground-panels > div:first-child {
            flex: 1 !important;
          }
        }
      `}</style>
    </DemoWrapper>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/salva/Documents/WORKING/materials && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/demos/terraform/VariablePlayground.tsx
git commit -m "feat(playground): add VariablePlayground UI component"
```

---

## Task 5: MDX Integration

**Files:**
- Modify: `docs/terraform/teoria/variables.mdx`

- [ ] **Step 1: Add the playground import and component to variables.mdx**

Read the file first, then add the import after the frontmatter and the component at a suitable location (after the introductory section, before the detailed variable syntax). Add this import near the top of the file (after any existing imports):

```mdx
import VariablePlayground from '@site/src/components/demos/terraform/VariablePlayground';
```

And add this block after the introductory text about variables (before the detailed syntax section):

```mdx
<VariablePlayground />
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/salva/Documents/WORKING/materials && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add docs/terraform/teoria/variables.mdx
git commit -m "feat(playground): integrate VariablePlayground in variables.mdx"
```

---

## Task 6: Responsive fix and polish

- [ ] **Step 1: Add responsive class to the two-panel div in VariablePlayground.tsx**

In the two-panel layout div, add `className="variable-playground-panels"` so the CSS media query works:

Change:
```tsx
<div style={{ display: 'flex', gap: '0.75rem', minHeight: 400 }}>
```
To:
```tsx
<div className="variable-playground-panels" style={{ display: 'flex', gap: '0.75rem', minHeight: 400 }}>
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/salva/Documents/WORKING/materials && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/demos/terraform/VariablePlayground.tsx
git commit -m "fix(playground): add responsive class for mobile layout"
```
