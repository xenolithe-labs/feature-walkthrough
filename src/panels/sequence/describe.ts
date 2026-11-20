/**
 * What a reader sees in a sequence pane, as text: the message the current call draws, the frames
 * that are open around the messages so far, and the notes the call brings along.
 */
import type { Call, Effect } from '../../core';
import { clip, elements, hitOf } from '../_shared/describe';

interface SequenceShape {
  lanes?: string[] | undefined;
  styles?: Record<string, string> | undefined;
  fragments?: { id: string; kind: string; label: string }[] | undefined;
  notes?: { id: string; text: string; over: string | readonly string[] }[] | undefined;
}

export function describeSequence(
  state: unknown,
  content: SequenceShape,
  current: Effect[],
  call?: Call,
): string[] {
  const present = new Set(elements(state).present);
  const hit = hitOf(current);
  const lines: string[] = [];
  const inLanes = (lane: string) => content.lanes === undefined || content.lanes.includes(lane);
  if (call === undefined) {
    // Without the call the message is not known; say what can be said.
  } else if (
    call.from !== undefined &&
    call.to !== undefined &&
    inLanes(call.from) &&
    inLanes(call.to)
  ) {
    const style = Object.hasOwn(content.styles ?? {}, call.id) ? content.styles![call.id] : 'call';
    const self = call.from === call.to ? ' (a loop on the lane)' : '';
    lines.push(`message "${call.label}": ${call.from} -> ${call.to}, drawn as ${style}${self}`);
  } else {
    lines.push('no message at this call (it has no from and to, or its lanes are not shown)');
  }
  const frames = (content.fragments ?? []).filter((fragment) => present.has(fragment.id));
  if (frames.length > 0) {
    lines.push(
      `frames so far: ${frames
        .map(
          (fragment) =>
            `${fragment.kind} [${fragment.label}]${hit.added.has(fragment.id) ? '*' : ''}`,
        )
        .join(', ')}`,
    );
  }
  for (const note of content.notes ?? []) {
    if (!hit.added.has(note.id)) continue;
    const over = typeof note.over === 'string' ? note.over : note.over.join(' to ');
    lines.push(`note over ${over}*: ${clip(note.text, 90)}`);
  }
  return lines;
}
