// Flag parsing shared by kubectl, helm and kustomize.

export interface Parsed {
  pos: string[];
  flags: Record<string, string | true>;
  /** Repeatable flags (-f a -f b, --from-literal, --set). */
  multi: Record<string, string[]>;
  /** Everything after `--`. */
  rest: string[];
}

export class UsageError extends Error {}

/**
 * valueFlags: long names (without --) that take a value; aliases map short → long.
 * Unknown flags are treated as booleans unless written --flag=value.
 */
export function parseArgs(args: string[], valueFlags: string[], aliases: Record<string, string> = {}, boolFlags: string[] = []): Parsed {
  const out: Parsed = { pos: [], flags: {}, multi: {}, rest: [] };
  const takes = new Set(valueFlags);
  const bools = new Set(boolFlags);
  const set = (k: string, v: string | true) => {
    out.flags[k] = v;
    if (typeof v === 'string') (out.multi[k] ??= []).push(v);
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      out.rest = args.slice(i + 1);
      break;
    }
    if (a.startsWith('--') && a.length > 2) {
      const eq = a.indexOf('=');
      const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (eq > 0) set(name, a.slice(eq + 1));
      else if (takes.has(name) && !bools.has(name)) {
        if (i + 1 >= args.length) throw new UsageError(`error: flag needs an argument: --${name}`);
        set(name, args[++i]);
      } else set(name, true);
      continue;
    }
    if (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) {
      const short = a.slice(1, 2);
      const long = aliases[short];
      const eq = a.indexOf('=');
      if (long && takes.has(long)) {
        if (eq === 2) set(long, a.slice(3));
        else if (a.length > 2) set(long, a.slice(2));
        else {
          if (i + 1 >= args.length) throw new UsageError(`error: flag needs an argument: '${short}' in -${short}`);
          set(long, args[++i]);
        }
        continue;
      }
      // Combined booleans: -it, -Ra…
      for (const ch of a.slice(1)) {
        if (ch === '=') break;
        set(aliases[ch] || ch, true);
      }
      continue;
    }
    out.pos.push(a);
  }
  return out;
}

export function flagStr(p: Parsed, name: string): string | undefined {
  const v = p.flags[name];
  return typeof v === 'string' ? v : undefined;
}

export function flagBool(p: Parsed, name: string): boolean {
  const v = p.flags[name];
  return v === true || v === 'true';
}
