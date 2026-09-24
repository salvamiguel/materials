// AWS CLI shorthand syntax, following awscli/shorthand.py:
//   parameter = keyval *("," keyval)
//   keyval    = key "=" [values]
//   values    = csv-list / explicit-list / hash-literal
// Example: ResourceType=instance,Tags=[{Key=Name,Value=web},{Key=env,Value=dev}]

export class ShorthandError extends Error {
  constructor(
    public expected: string,
    public received: string,
    public input: string,
    public index: number,
  ) {
    super(`Expected: '${expected}', received: '${received}' for input:\n${input}\n${' '.repeat(index)}^`);
  }
}

type Value = string | Value[] | { [k: string]: Value };

class Parser {
  i = 0;
  constructor(private s: string) {}

  private peek() {
    return this.s[this.i];
  }

  private eof() {
    return this.i >= this.s.length;
  }

  private skipWs() {
    while (this.s[this.i] === ' ') this.i++;
  }

  private expect(c: string) {
    this.skipWs();
    if (this.s[this.i] !== c) throw new ShorthandError(c, this.eof() ? 'EOF' : this.s[this.i], this.s, this.i);
    this.i++;
  }

  parameter(): { [k: string]: Value } {
    const obj = this.keyvals();
    if (!this.eof()) throw new ShorthandError(',', this.s[this.i], this.s, this.i);
    return obj;
  }

  private keyvals(): { [k: string]: Value } {
    const obj: { [k: string]: Value } = {};
    for (;;) {
      this.skipWs();
      const key = this.key();
      this.expect('=');
      obj[key] = this.values();
      this.skipWs();
      if (this.peek() !== ',') break;
      this.i++;
    }
    return obj;
  }

  private key(): string {
    const start = this.i;
    while (!this.eof() && /[A-Za-z0-9_.\-:/@*]/.test(this.s[this.i])) this.i++;
    if (start === this.i) throw new ShorthandError('=', this.eof() ? 'EOF' : this.s[this.i], this.s, this.i);
    return this.s.slice(start, this.i);
  }

  private values(): Value {
    this.skipWs();
    const c = this.peek();
    if (c === '[') return this.explicitList();
    if (c === '{') return this.hash();
    const first = this.simple();
    const list: string[] = [first];
    while (this.peek() === ',' && this.isContinuation()) {
      this.i++;
      list.push(this.simple());
    }
    return list.length > 1 ? list : first;
  }

  // After "Values=a," is "b" another value or the next key? It is a key
  // when an "=" shows up before the next ",".
  private isContinuation(): boolean {
    for (let j = this.i + 1; j < this.s.length; j++) {
      const c = this.s[j];
      if (c === '=') return false;
      if (c === ',' || c === ']' || c === '}') return true;
      if (c === '"' || c === "'") return true;
    }
    return true;
  }

  private simple(): string {
    this.skipWs();
    const q = this.peek();
    if (q === '"' || q === "'") {
      this.i++;
      let out = '';
      while (!this.eof() && this.s[this.i] !== q) {
        if (this.s[this.i] === '\\' && this.i + 1 < this.s.length) this.i++;
        out += this.s[this.i++];
      }
      this.expect(q);
      return out;
    }
    const start = this.i;
    while (!this.eof() && !',]}'.includes(this.s[this.i])) this.i++;
    return this.s.slice(start, this.i).trim();
  }

  private explicitList(): Value[] {
    this.expect('[');
    const out: Value[] = [];
    this.skipWs();
    if (this.peek() === ']') {
      this.i++;
      return out;
    }
    for (;;) {
      this.skipWs();
      out.push(this.peek() === '{' ? this.hash() : this.simple());
      this.skipWs();
      if (this.peek() === ',') {
        this.i++;
        continue;
      }
      this.expect(']');
      return out;
    }
  }

  private hash(): { [k: string]: Value } {
    this.expect('{');
    this.skipWs();
    if (this.peek() === '}') {
      this.i++;
      return {};
    }
    const obj = this.keyvals();
    this.expect('}');
    return obj;
  }
}

export function parseShorthand(input: string): { [k: string]: Value } {
  return new Parser(input).parameter();
}

/** Turns "true"/"false" and numeric strings into booleans and numbers. */
export function coerce(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(coerce);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, coerce(x)]));
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (typeof v === 'string' && /^-?\d+$/.test(v) && v.length < 10) return Number(v);
  return v;
}
