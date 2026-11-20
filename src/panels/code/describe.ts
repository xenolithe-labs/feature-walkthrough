/**
 * What a reader sees in a code pane, as text: for each source the call touches (or, when it
 * touches none, the source in front), the lines it marks with their text, the current-line
 * pointer and badge, and for a transcript how much is revealed.
 */
import { effectTarget, own, type Effect } from '../../core';
import { clip, elements } from '../_shared/describe';

interface CodeShape {
  sources: {
    id: string;
    title: string;
    lang?: string | undefined;
    text: string;
    base?: string | undefined;
    transcript?: unknown;
  }[];
}

/** Line numbers an effect names: `[3, [7, 9]]`, limited to `limit` so a wild range stays cheap. */
function lineNumbers(lines: unknown, limit: number): number[] {
  if (!Array.isArray(lines)) return [];
  const out: number[] = [];
  for (const item of lines) {
    const range =
      typeof item === 'number'
        ? [item, item]
        : Array.isArray(item) && typeof item[0] === 'number' && typeof item[1] === 'number'
          ? [item[0], item[1]]
          : undefined;
    if (range === undefined) continue;
    for (let line = Math.max(1, range[0]!); line <= Math.min(range[1]!, limit); line += 1) {
      out.push(line);
    }
  }
  return out;
}

const MOST_LINES = 8;

export function describeCode(state: unknown, content: CodeShape, current: Effect[]): string[] {
  const { patches, focus } = elements(state);
  const effects = new Map<string, Effect[]>();
  for (const effect of current) {
    const { verb, id } = effectTarget(effect);
    if (verb === 'focus') continue;
    effects.set(id, [...(effects.get(id) ?? []), effect]);
  }
  const touchedSources = content.sources.filter((source) => effects.has(source.id));
  const chosen =
    touchedSources.length > 0
      ? touchedSources
      : content.sources.filter((source) => source.id === (focus ?? content.sources[0]?.id));
  const lines: string[] = [];
  for (const source of chosen) {
    const patch = own(patches, source.id);
    const text = typeof patch?.text === 'string' ? patch.text : source.text;
    const rows = text.split('\n');
    const header = [`${source.title}${source.lang === undefined ? '' : ` (${source.lang})`}`];
    if (source.base !== undefined) header.push('shown as a diff');
    lines.push(`${header.join(', ')}: ${rows.length} lines`);

    const at = patch?.at;
    if (typeof at === 'number') {
      const badge = typeof patch?.badge === 'string' ? ` badge "${patch.badge}"` : '';
      lines.push(`  current line ${at}${badge}: ${clip(rows[at - 1] ?? '', 80)}`);
    }
    if (source.transcript !== undefined) {
      const upto =
        typeof patch?.upto === 'number' ? Math.max(0, Math.min(rows.length, patch.upto)) : 0;
      lines.push(
        `  transcript: ${upto} of ${rows.length} lines shown${upto > 0 ? `; last: ${clip(rows[upto - 1] ?? '', 70)}` : ''}`,
      );
    }

    const marked = new Map<number, string>();
    for (const effect of effects.get(source.id) ?? []) {
      const { verb } = effectTarget(effect);
      const word =
        verb === 'add'
          ? 'added'
          : verb === 'update'
            ? 'updated'
            : verb === 'remove'
              ? 'removed'
              : 'read';
      for (const line of lineNumbers(effect.lines, rows.length)) marked.set(line, word);
    }
    const shown = [...marked].sort(([a], [b]) => a - b);
    for (const [line, word] of shown.slice(0, MOST_LINES)) {
      lines.push(`  ${word} line ${line}: >${clip(rows[line - 1] ?? '', 80)}<`);
    }
    if (shown.length > MOST_LINES)
      lines.push(`  and ${shown.length - MOST_LINES} more marked lines`);
    const old = (effects.get(source.id) ?? []).flatMap((effect) => lineNumbers(effect.old, 10_000));
    if (old.length > 0) lines.push(`  marks lines ${old.slice(0, 12).join(', ')} of the old text`);
    if (shown.length === 0 && old.length === 0 && touchedSources.includes(source)) {
      lines.push('  touched, no lines marked');
    }
  }
  return lines;
}
