/**
 * Where things go in a sequence diagram. Pure functions, so the layout can be tested without a
 * browser: rows for messages, room for fragment headings and notes, boxes for fragments, and the
 * shape of one message.
 *
 * Everything is placed for the whole walkthrough at once. Messages, notes and fragments appear
 * later, but they never move what is already on screen.
 */
export const ROW = 46;
export const TOP = 30;
export const BOTTOM = 18;
export const CHAR = 7.25;
/** Room above the first message of a fragment: its tab and label. */
export const HEAD = 22;
/** Room above the first message of a branch: its divider and label. */
export const DIVIDER = 22;
/** Room below the last message of a fragment. */
export const TAIL = 8;
const NOTE_LINE = 14;
const NOTE_PAD = 10;
const NOTE_GAP = 4;
/** How far a message to self reaches to the right of its lane. */
export const LOOP = 26;

export type MessageStyle = 'call' | 'reply' | 'async' | 'lost';
export type FragmentKind = 'loop' | 'alt' | 'opt' | 'par';

export interface Message {
  id: string;
  from: string;
  to: string;
}

export interface Fragment {
  id: string;
  kind: FragmentKind;
  label: string;
  from: string;
  to: string;
  /** Where each further alternative (alt) or part (par) starts. */
  branches?: { at: string; label: string }[];
}

export interface Note {
  id: string;
  at: string;
  over: string | [string, string];
  text: string;
}

export interface Ground {
  /** Centre of a lane. */
  laneX(id: string): number;
  /** Distance between lane centres. */
  gap: number;
  total: number;
}

/** Text broken into lines of at most `max` characters, at spaces; a long word stays whole. */
export function wrapText(text: string, max: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line === '') line = word;
      else if (line.length + 1 + word.length <= max) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** The first and last message index a fragment covers, or undefined when it does not make sense. */
export function fragmentRange(
  fragment: Pick<Fragment, 'from' | 'to'>,
  index: ReadonlyMap<string, number>,
): [number, number] | undefined {
  const start = index.get(fragment.from);
  const end = index.get(fragment.to);
  if (start === undefined || end === undefined || end < start) return undefined;
  return [start, end];
}

/** Two ranges that overlap without one holding the other. */
export function crosses(a: readonly [number, number], b: readonly [number, number]): boolean {
  return (
    (a[0] < b[0] && b[0] <= a[1] && a[1] < b[1]) || (b[0] < a[0] && a[0] <= b[1] && b[1] < a[1])
  );
}

export interface NoteBox {
  id: string;
  /** Message the note belongs to. */
  at: string;
  x: number;
  y: number;
  width: number;
  height: number;
  lines: string[];
}

export interface FrameBox {
  id: string;
  kind: FragmentKind;
  label: string;
  /** Message that makes the frame appear. */
  first: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Width of the kind tab in the corner. */
  tab: number;
  /** How many frames hold this one. */
  depth: number;
  dividers: { at: string; label: string; y: number }[];
}

export interface SequenceLayout {
  /** Centre line of each message, by id. */
  ys: ReadonlyMap<string, number>;
  notes: NoteBox[];
  frames: FrameBox[];
  height: number;
}

export function layoutSequence(
  messages: readonly Message[],
  fragments: readonly Fragment[],
  notes: readonly Note[],
  ground: Ground,
): SequenceLayout {
  const index = new Map(messages.map((message, position) => [message.id, position]));
  const { laneX, gap, total } = ground;

  // Fragments that make sense, outermost first.
  const frames = fragments
    .flatMap((fragment, order) => {
      const range = fragmentRange(fragment, index);
      return range === undefined ? [] : [{ fragment, range, order }];
    })
    .sort((a, b) => a.range[0] - b.range[0] || b.range[1] - a.range[1] || a.order - b.order);
  const inside = (outer: (typeof frames)[number], inner: (typeof frames)[number]) =>
    outer !== inner &&
    frames.indexOf(outer) < frames.indexOf(inner) &&
    outer.range[0] <= inner.range[0] &&
    inner.range[1] <= outer.range[1];

  // How many frames nest inside this one, at most.
  const depthBelow = (of: (typeof frames)[number]): number =>
    frames.reduce(
      (most, other) => (inside(of, other) ? Math.max(most, depthBelow(other) + 1) : most),
      0,
    );

  // Notes, each in the row after its message.
  const noteBoxes = new Map<string, NoteBox & { row: number }>();
  for (const note of notes) {
    const row = index.get(note.at);
    const ends = (Array.isArray(note.over) ? note.over : [note.over]).map((lane) => laneX(lane));
    if (row === undefined || ends.some((x) => !Number.isFinite(x))) continue;
    const left = Math.min(...ends);
    const right = Math.max(...ends);
    const span = right - left;
    const room = span > 0 ? span + gap - 12 : Math.max(gap - 12, Math.min(2 * gap - 12, 240));
    const wrapped = wrapText(
      note.text,
      Math.max(6, Math.floor((Math.min(room, total - 8) - 16) / CHAR)),
    );
    const longest = Math.max(...wrapped.map((line) => line.length));
    const width = Math.min(
      total - 8,
      span > 0 ? room : Math.max(gap - 12, Math.ceil(longest * CHAR) + 16),
    );
    const x = Math.min(Math.max((left + right) / 2 - width / 2, 4), total - 4 - width);
    noteBoxes.set(note.id, {
      id: note.id,
      at: note.at,
      x,
      y: 0,
      width,
      height: wrapped.length * NOTE_LINE + NOTE_PAD,
      lines: wrapped,
      row,
    });
  }

  const ys = new Map<string, number>();
  const frameY = new Map<(typeof frames)[number], { top: number; bottom: number }>();
  const dividerY = new Map<string, number>();
  let y = TOP;
  messages.forEach((message, row) => {
    // Dividers of branches that start here, then the headings of fragments that start here.
    for (const frame of frames) {
      for (const branch of frame.fragment.branches ?? []) {
        if (branch.at !== message.id) continue;
        dividerY.set(`${frame.fragment.id}\u0000${branch.at}`, y + 2);
        y += DIVIDER;
      }
    }
    for (const frame of frames) {
      if (frame.range[0] !== row) continue;
      frameY.set(frame, { top: y, bottom: 0 });
      y += HEAD;
    }
    ys.set(message.id, y + ROW / 2);
    y += ROW;
    for (const box of noteBoxes.values()) {
      if (box.row !== row) continue;
      box.y = y + NOTE_GAP;
      y += NOTE_GAP + box.height + NOTE_GAP;
    }
    for (const frame of [...frames].reverse()) {
      if (frame.range[1] !== row) continue;
      y += TAIL;
      frameY.get(frame)!.bottom = y;
    }
  });
  const height = y + BOTTOM;

  const selfReach = (message: Message) =>
    message.from === message.to ? laneX(message.from) + LOOP + 14 : -Infinity;
  const boxes: FrameBox[] = frames.map((frame) => {
    const [start, end] = frame.range;
    let left = Infinity;
    let right = -Infinity;
    for (const message of messages.slice(start, end + 1)) {
      left = Math.min(left, laneX(message.from), laneX(message.to));
      right = Math.max(right, laneX(message.from), laneX(message.to), selfReach(message));
    }
    for (const note of noteBoxes.values()) {
      if (note.row < start || note.row > end) continue;
      left = Math.min(left, note.x);
      right = Math.max(right, note.x + note.width);
    }
    // One step wider than anything it holds, so nested frames show as nested.
    const below = depthBelow(frame);
    const pad = 12 + 8 * below;
    const tab = frame.fragment.kind.length * CHAR + 14;
    const heading = tab + (frame.fragment.label.length + 2) * CHAR + 10;
    let x = Math.max(2, left - pad);
    let width = Math.max(right + pad, x + heading) - x;
    if (x + width > total - 2) {
      width = Math.min(width, total - 4);
      x = total - 2 - width;
    }
    const where = frameY.get(frame)!;
    return {
      id: frame.fragment.id,
      kind: frame.fragment.kind,
      label: frame.fragment.label,
      first: frame.fragment.from,
      x,
      y: where.top,
      width,
      height: where.bottom - where.top,
      tab,
      depth: frames.filter((other) => inside(other, frame)).length,
      dividers: (frame.fragment.branches ?? []).flatMap((branch) => {
        const at = dividerY.get(`${frame.fragment.id}\u0000${branch.at}`);
        return at === undefined ? [] : [{ at: branch.at, label: branch.label, y: at }];
      }),
    };
  });

  return {
    ys,
    notes: [...noteBoxes.values()].map(({ row: _row, ...box }) => box),
    frames: boxes,
    height,
  };
}

export interface MessageShape {
  style: MessageStyle;
  /** Path of the line, or loop for a message to self. */
  line: string;
  dashed: boolean;
  /** The arrowhead as a closed shape (filled) or an open stroke; none for a lost message. */
  head: { kind: 'filled' | 'open'; d: string } | undefined;
  /** The cross at the end of a lost message. */
  cross: string | undefined;
  label: { text: string; x: number; y: number; anchor: 'start' | 'middle' | 'end' };
}

/** The label cut to `room` characters, ending in an ellipsis when it was cut. */
function fit(label: string, room: number): string {
  const most = Math.max(4, Math.floor(room));
  return label.length > most ? `${label.slice(0, most - 1)}…` : label;
}

/**
 * The drawing of one message. A reply is dashed, an asynchronous message has an open head, a
 * lost message ends in a cross before it reaches the lane. A message to self is a loop on the
 * lane, with its label on the side that has room.
 */
export function messageShape(
  style: MessageStyle,
  x1: number,
  x2: number,
  y: number,
  label: string,
  total: number,
): MessageShape {
  const dashed = style === 'reply';
  if (x1 === x2) {
    // A message to self. A lost one makes no sense (it has nowhere to go): drawn as a plain call.
    const kind = style === 'async' || style === 'reply' ? 'open' : 'filled';
    const tip = x1 + 2;
    const head =
      kind === 'open'
        ? `M ${tip + 9} ${y + 3.5} L ${tip} ${y + 8} L ${tip + 9} ${y + 12.5}`
        : `M ${tip} ${y + 8} L ${tip + 9} ${y + 3.5} L ${tip + 9} ${y + 12.5} Z`;
    const side = 34;
    const rightRoom = total - 6 - (x1 + side);
    const leftRoom = x1 - 10 - 6;
    const need = label.length * CHAR;
    const onRight = need <= rightRoom || rightRoom >= leftRoom;
    const text = fit(label, (onRight ? rightRoom : leftRoom) / CHAR);
    return {
      style,
      line: `M ${x1} ${y - 8} H ${x1 + LOOP} V ${y + 8} H ${kind === 'open' ? tip : x1 + 4}`,
      dashed,
      head: { kind, d: head },
      cross: undefined,
      label: onRight
        ? { text, x: x1 + side, y: y + 4, anchor: 'start' }
        : { text, x: x1 - 10, y: y + 4, anchor: 'end' },
    };
  }
  const direction = x2 > x1 ? 1 : -1;
  const half =
    ((label.length > 0 ? Math.min(label.length, Math.floor((total - 12) / CHAR)) : 0) * CHAR) / 2;
  const centre = Math.min(Math.max((x1 + x2) / 2, half + 6), total - half - 6);
  const text = fit(label, (total - 12) / CHAR);
  const labelAt = { text, x: centre, y: y - 8, anchor: 'middle' as const };
  if (style === 'lost') {
    const distance = Math.abs(x2 - x1);
    const reach = Math.max(Math.min(distance * 0.6, distance - 16), distance / 2);
    const end = x1 + direction * reach;
    return {
      style,
      line: `M ${x1} ${y} H ${end}`,
      dashed: false,
      head: undefined,
      cross: `M ${end - 5} ${y - 5} L ${end + 5} ${y + 5} M ${end - 5} ${y + 5} L ${end + 5} ${y - 5}`,
      label: labelAt,
    };
  }
  const tip = x2 - direction * 2;
  if (style === 'call') {
    return {
      style,
      line: `M ${x1} ${y} H ${x2 - direction * 6}`,
      dashed,
      head: {
        kind: 'filled',
        d: `M ${tip} ${y} L ${tip - direction * 9} ${y - 4.5} L ${tip - direction * 9} ${y + 4.5} Z`,
      },
      cross: undefined,
      label: labelAt,
    };
  }
  return {
    style,
    line: `M ${x1} ${y} H ${tip}`,
    dashed,
    head: {
      kind: 'open',
      d: `M ${tip - direction * 9} ${y - 4.5} L ${tip} ${y} L ${tip - direction * 9} ${y + 4.5}`,
    },
    cross: undefined,
    label: labelAt,
  };
}
