// JSON that has not finished arriving, parsed as far as it has got.
//
// A tool's arguments stream in a few characters at a time (`tool-input`),
// and the reducer leaves `input` undefined until the text parses. A renderer
// that draws a call while it is being written, such as a generated UI growing
// under the user, wants the value so far.
//
// What "so far" means is chosen for drawing. An object has the members that
// have arrived, the last one as far as it has got, so a title grows as it is
// typed. An array has only the items that are finished: a list grows an item
// at a time, and a chart never plots a row whose numbers are not there yet.
// A number at the very end is left out, since "33" may be the start of "330".
// That is as lenient as it gets: text that is wrong, rather than short,
// answers `undefined`.

const INCOMPLETE = Symbol('incomplete');
type Parsed = unknown | typeof INCOMPLETE;

/**
 * The value a prefix of a JSON document stands for, for drawing it. An
 * object keeps the members that have arrived. Its last member is kept as far
 * as it has got, unless it is a key still being written, a value not yet
 * started, a number that may go on, or a `true`/`false`/`null` cut short. An
 * array keeps only its finished items. Complete text answers what
 * `JSON.parse` does; text no JSON document begins with answers `undefined`.
 */
export function parsePartialJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // short, or wrong: the parser below tells which
  }
  const parser = new Parser(text);
  try {
    const value = parser.value();
    parser.space();
    if (value === INCOMPLETE || parser.at < text.length) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

const ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

const NUMBER = /-?\d*(?:\.\d*)?(?:[eE][+-]?\d*)?/y;
const WHOLE_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

class Parser {
  at = 0;
  /** The text ended inside what was just parsed. Once set it stays set:
   *  everything still open around that point was cut too. */
  cut = false;
  constructor(private readonly text: string) {}

  private get done(): boolean {
    return this.at >= this.text.length;
  }

  space(): void {
    while (!this.done && ' \t\n\r'.includes(this.text[this.at]!)) this.at++;
  }

  value(): Parsed {
    this.space();
    if (this.done) return this.end(INCOMPLETE);
    const c = this.text[this.at]!;
    if (c === '{') return this.object();
    if (c === '[') return this.array();
    if (c === '"') return this.string()[0];
    if (c === '-' || (c >= '0' && c <= '9')) return this.number();
    if (c === 't') return this.literal('true', true);
    if (c === 'f') return this.literal('false', false);
    if (c === 'n') return this.literal('null', null);
    throw new SyntaxError(`unexpected ${c}`);
  }

  private object(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    this.at++;
    for (;;) {
      this.space();
      if (this.done) return this.end(out);
      if (this.text[this.at] === '}' && !Object.keys(out).length) {
        this.at++;
        return out;
      }
      if (this.text[this.at] !== '"') throw new SyntaxError('expected a key');
      const [key, closed] = this.string();
      if (!closed) return out;
      this.space();
      if (this.done) return this.end(out);
      if (this.text[this.at] !== ':') throw new SyntaxError('expected :');
      this.at++;
      const value = this.value();
      if (value === INCOMPLETE) return out;
      // an own property, as JSON.parse makes it, even for "__proto__"
      Object.defineProperty(out, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      this.space();
      if (this.done) return this.end(out);
      const next = this.text[this.at++];
      if (next === '}') return out;
      if (next !== ',') throw new SyntaxError('expected , or }');
    }
  }

  private array(): unknown[] {
    const out: unknown[] = [];
    this.at++;
    for (;;) {
      this.space();
      if (this.done) return this.end(out);
      if (this.text[this.at] === ']' && !out.length) {
        this.at++;
        return out;
      }
      const value = this.value();
      // only finished items: half a row is not a row
      if (value === INCOMPLETE || this.cut) return out;
      out.push(value);
      this.space();
      if (this.done) return this.end(out);
      const next = this.text[this.at++];
      if (next === ']') return out;
      if (next !== ',') throw new SyntaxError('expected , or ]');
    }
  }

  /** The string, and whether its closing quote arrived. */
  private string(): [string, boolean] {
    let out = '';
    this.at++;
    while (!this.done) {
      const c = this.text[this.at]!;
      if (c === '"') {
        this.at++;
        return [out, true];
      }
      if (c === '\\') {
        const e = this.text[this.at + 1];
        if (e === undefined) break; // the escape is still arriving
        if (e === 'u') {
          const hex = this.text.slice(this.at + 2, this.at + 6);
          if (hex.length < 4) break;
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new SyntaxError('bad \\u');
          out += String.fromCharCode(parseInt(hex, 16));
          this.at += 6;
          continue;
        }
        const char = ESCAPES[e];
        if (char === undefined) throw new SyntaxError(`bad escape \\${e}`);
        out += char;
        this.at += 2;
        continue;
      }
      out += c;
      this.at++;
    }
    this.at = this.text.length;
    this.cut = true;
    return [out, false];
  }

  /** What a container has, when the text ends inside it. */
  private end<T>(value: T): T {
    this.cut = true;
    return value;
  }

  private number(): Parsed {
    NUMBER.lastIndex = this.at;
    const token = NUMBER.exec(this.text)?.[0] ?? '';
    this.at += token.length;
    if (/^-?0\d/.test(token)) throw new SyntaxError(`bad number ${token}`);
    // at the very end the digits may go on: "33" may be the start of "330"
    if (this.done) {
      this.cut = true;
      return INCOMPLETE;
    }
    if (!WHOLE_NUMBER.test(token)) throw new SyntaxError(`bad number ${token}`);
    return Number(token);
  }

  private literal(word: string, value: unknown): Parsed {
    if (this.text.startsWith(word, this.at)) {
      this.at += word.length;
      return value;
    }
    const rest = this.text.slice(this.at);
    if (word.startsWith(rest)) {
      this.at = this.text.length;
      this.cut = true;
      return INCOMPLETE;
    }
    throw new SyntaxError(`unexpected ${rest.slice(0, 8)}`);
  }
}
