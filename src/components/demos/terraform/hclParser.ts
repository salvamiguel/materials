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

export type HclPrimitive = string | number | boolean;
export type HclValue = HclPrimitive | HclValue[] | { [key: string]: HclValue };

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
