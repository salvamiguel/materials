// Snippets of completion items: $1, $2… are tab stops, ${1:text} a stop with
// default text (selected, so typing replaces it) and $0 the final cursor.

export interface Stop {
  start: number;
  end: number;
}

export interface Expanded {
  text: string;
  /** Tab stops in visiting order ($1, $2…, then $0), relative to the text. */
  stops: Stop[];
}

/** Expands a snippet; continuation lines get the indentation of the first one. */
export function expandSnippet(snippet: string, indent = ''): Expanded {
  let text = '';
  const found: { index: number; start: number; end: number }[] = [];
  for (let i = 0; i < snippet.length; i++) {
    const c = snippet[i];
    if (c === '\\' && snippet[i + 1] === '$') {
      text += '$';
      i++;
      continue;
    }
    if (c === '\n') {
      text += '\n' + indent;
      continue;
    }
    if (c === '$') {
      const simple = /^\$(\d+)/.exec(snippet.slice(i));
      if (simple) {
        found.push({ index: Number(simple[1]), start: text.length, end: text.length });
        i += simple[0].length - 1;
        continue;
      }
      const withText = /^\$\{(\d+):([^}]*)\}/.exec(snippet.slice(i));
      if (withText) {
        const start = text.length;
        text += withText[2];
        found.push({ index: Number(withText[1]), start, end: text.length });
        i += withText[0].length - 1;
        continue;
      }
    }
    text += c;
  }
  const order = (n: number) => (n === 0 ? Infinity : n);
  found.sort((a, b) => order(a.index) - order(b.index));
  const stops = found.map(({ start, end }) => ({ start, end }));
  if (!found.some((s) => s.index === 0)) stops.push({ start: text.length, end: text.length });
  return { text, stops };
}
