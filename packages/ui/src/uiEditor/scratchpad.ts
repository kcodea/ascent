import type { Scope } from './selector';

export interface EditEntry {
  selector: string;
  scope: Scope;
  props: Record<string, string>;
  assetPath?: string;
}
export type Scratchpad = Record<string, EditEntry>;

function ensure(sp: Scratchpad, selector: string, scope: Scope): EditEntry {
  return sp[selector] ?? { selector, scope, props: {} };
}

export function upsertProp(
  sp: Scratchpad, selector: string, scope: Scope, prop: string, value: string,
): Scratchpad {
  const entry = ensure(sp, selector, scope);
  return { ...sp, [selector]: { ...entry, scope, props: { ...entry.props, [prop]: value } } };
}

export function setAsset(sp: Scratchpad, selector: string, scope: Scope, assetPath: string): Scratchpad {
  const entry = ensure(sp, selector, scope);
  return { ...sp, [selector]: { ...entry, scope, assetPath } };
}

export function removeEntry(sp: Scratchpad, selector: string): Scratchpad {
  const next = { ...sp };
  delete next[selector];
  return next;
}

/** Ordered declaration list for an entry — props first, then the asset as a background-image. */
function declarations(entry: EditEntry): string[] {
  const decls = Object.entries(entry.props).map(([k, v]) => `${k}: ${v};`);
  if (entry.assetPath) decls.push(`background-image: url('${entry.assetPath}');`);
  return decls;
}

export function ruleText(entry: EditEntry): string {
  return `${entry.selector} { ${declarations(entry).join(' ')} }`;
}

export function toSummary(sp: Scratchpad, counts: Record<string, number>): string {
  const blocks = Object.values(sp).map((entry) => {
    const count = counts[entry.selector] ?? 0;
    const lines = [
      `  selector: ${entry.selector}   (matches ${count})`,
      `  scope: ${entry.scope}`,
      ...Object.entries(entry.props).map(([k, v]) => `  ${k}: ${v}`),
    ];
    if (entry.assetPath) lines.push(`  background-image: url('${entry.assetPath}')   [uploaded]`);
    return lines.join('\n');
  });
  return ['UI-EDIT', blocks.join('\n--\n')].join('\n');
}

export function serialize(sp: Scratchpad): string {
  return JSON.stringify(sp);
}

export function deserialize(raw: string | null): Scratchpad {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Scratchpad) : {};
  } catch {
    return {};
  }
}
