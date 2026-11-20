/**
 * bytes: the bit and byte layout of a packet header, a frame, a token or a stored page.
 *
 * `content.frames` lists frames made of fields, each with a size. A field's element id is
 * `<frame>.<field>`; a frame may have a parser cursor, `<frame>.cursor`. Three units:
 *   - `bits`: rows of `width` bits (32 by default, the way RFCs draw headers) with a bit ruler;
 *   - `bytes`: rows of 8 or 16 bytes as a hex dump, with an optional ASCII gutter;
 *   - `segments`: text pieces joined by a separator, such as the dot-separated parts of a JWT.
 *
 * A call marks fields (`read`), changes `value` or `decoded` (`update`), tones them, and adds or
 * removes whole frames. Offsets, rows, the pieces of a field that straddles a row, lengths and
 * the sums that lint checks are all derived, never written.
 */
import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import {
  initElements,
  markOf,
  own,
  reduceElements,
  touched,
  type CardSection,
  type ElementsState,
  type PanelContext,
  type PanelType,
  type Touched,
} from '../../core';
import { changesSection, text, toneOf, uniqueLabels } from '../_shared/changes';
import { useWidth } from '../_shared/hooks';
import { TOUCHED_SELECTOR, revealScroll } from '../_shared/reveal';
import { bytesLint } from './lint';
import {
  BytesContent,
  bytesOfField,
  childrenOf,
  cursorAt,
  cursorId,
  decodedOf,
  describeSize,
  describeTotal,
  entitiesOf,
  fieldId,
  fitWidth,
  layout,
  measure,
  placeCursor,
  rowWidth,
  valueOf,
  whereIs,
  type FieldDecl,
  type FrameDecl,
  type Piece,
} from './model';
import './bytes.css';

interface BytesState extends ElementsState {
  /** The element ids that belong to each frame, so that removing a frame drops their changes. */
  children: Readonly<Record<string, readonly string[]>>;
}

const init = (content: BytesContent): BytesState => ({
  ...initElements(entitiesOf(content)),
  children: childrenOf(content),
});

/** Removing a frame drops what was changed on its fields, so adding it again starts clean. */
function reduce(state: BytesState, effect: Parameters<typeof reduceElements>[1]): BytesState {
  const next = { ...state, ...reduceElements(state, effect) };
  const id = effect.remove;
  if (id === undefined || !state.present.includes(id)) return next;
  const gone = new Set(own(state.children, id) ?? []);
  return {
    ...next,
    patches: Object.fromEntries(Object.entries(next.patches).filter(([name]) => !gone.has(name))),
  };
}

/** The minimum width of a column before the row is halved, and the room beside the columns. */
const MIN_COLUMN = { bits: 11, bytes: 22 } as const;

interface Shared {
  state: BytesState;
  current: Touched;
  selected: string | undefined;
  toggle(id: string): void;
  /** The width of the pane's content, or 0 before it is measured. */
  room: number;
}

/** How a call marks something of a frame: a touched field, else what the frame itself had done. */
function markFor(shared: Shared, frame: FrameDecl, id: string) {
  const mark = markOf(id, shared.current);
  if (mark !== 'faded') return mark;
  const framed = markOf(frame.id, shared.current);
  if (framed === 'added' || framed === 'read' || framed === 'removed') return framed;
  if (framed === 'updated') return 'idle';
  return 'faded';
}

function frameMark(shared: Shared, frame: FrameDecl) {
  const mark = markOf(frame.id, shared.current);
  if (mark !== 'faded') return mark;
  // A call that touches fields of the frame is about the frame: it does not fade.
  const inside = shared.state.children[frame.id] ?? [];
  const busy = inside.some((id) => markOf(id, shared.current) !== 'faded');
  return busy ? 'idle' : 'faded';
}

const hex = (byte: number) => byte.toString(16).padStart(2, '0');
const printable = (byte: number) => (byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '·');

/** A field's value as it is shown: as written, or hex bytes in a bytes frame. */
function shownValue(frame: FrameDecl, field: FieldDecl, value: string | number | undefined) {
  if (value === undefined) return undefined;
  if (frame.unit === 'bytes') {
    const bytes = bytesOfField(field, value);
    return bytes === undefined ? String(value) : bytes.map(hex).join(' ');
  }
  return String(value);
}

function describeField(frame: FrameDecl, field: FieldDecl, shared: Shared) {
  const geometry = measure(frame, (item) => {
    const value = valueOf(frame, item, shared.state.patches);
    return typeof value === 'string' ? value : undefined;
  }).fields.find((item) => item.id === field.id)!;
  const value = shownValue(frame, field, valueOf(frame, field, shared.state.patches));
  const decoded = decodedOf(frame, field, shared.state.patches);
  return {
    where: whereIs(frame.unit, geometry.offset, geometry.size),
    size: describeSize(frame.unit, geometry.size),
    value,
    decoded,
    words: [
      field.label ?? field.id,
      whereIs(frame.unit, geometry.offset, geometry.size),
      value === undefined ? undefined : `value ${value === '' ? 'empty' : value}`,
      decoded,
    ]
      .filter((part): part is string => part !== undefined)
      .join(', '),
  };
}

function FieldBox({
  frame,
  field,
  piece,
  shared,
  style,
  children,
  narrow,
}: {
  frame: FrameDecl;
  field: FieldDecl;
  piece?: Piece;
  shared: Shared;
  style?: CSSProperties;
  children: React.ReactNode;
  narrow?: boolean;
}) {
  const id = fieldId(frame.id, field.id);
  const shown = shared.state.present.includes(frame.id) || shared.current.removed.has(frame.id);
  const mark = markFor(shared, frame, id);
  const patch = own(shared.state.patches, id);
  const first = piece === undefined || piece.part === 0;
  const { words } = describeField(frame, field, shared);
  const link = field.link;
  return (
    <div
      className={`fw-by-field is-${mark}${shared.selected === id ? ' is-selected' : ''}${narrow ? ' is-narrow' : ''}${piece !== undefined && piece.parts > 1 ? ` is-part is-part-${piece.part === 0 ? 'first' : piece.part === piece.parts - 1 ? 'last' : 'middle'}` : ''}${piece?.kind === 'open' ? ' is-open' : ''}${piece?.kind === 'gap' ? ' is-gap' : ''}`}
      style={style}
      data-entity={id}
      data-mark={mark}
      data-tone={toneOf(patch?.tone, field.tone)}
      data-part={piece === undefined ? undefined : `${piece.part + 1}/${piece.parts}`}
    >
      <button
        type="button"
        className="fw-by-select"
        aria-pressed={shared.selected === id}
        aria-label={first ? words : `${field.label ?? field.id}, continued`}
        tabIndex={shown && first ? 0 : -1}
        aria-hidden={first ? undefined : true}
        onClick={() => shared.toggle(id)}
      >
        {children}
      </button>
      {link !== undefined && first && !narrow && (
        <button
          type="button"
          className={`fw-by-link${shared.selected === link.$ref ? ' is-selected' : ''}`}
          data-ref={link.$ref}
          aria-label={`Show ${link.text ?? link.$ref}`}
          aria-pressed={shared.selected === link.$ref}
          title={link.text ?? link.$ref}
          onClick={() => shared.toggle(link.$ref)}
        >
          ↗
        </button>
      )}
    </div>
  );
}

/** The text inside a piece of a field: label, value and meaning, as much as there is room for. */
function PieceText({
  frame,
  field,
  piece,
  shared,
  compact,
}: {
  frame: FrameDecl;
  field: FieldDecl;
  piece: Piece;
  shared: Shared;
  compact: boolean;
}) {
  const label = compact ? (field.short ?? field.label ?? field.id) : (field.label ?? field.id);
  const value = valueOf(frame, field, shared.state.patches);
  const decoded = decodedOf(frame, field, shared.state.patches);
  if (piece.kind === 'gap') {
    const unit = frame.unit === 'bits' ? 'bits' : 'bytes';
    return (
      <>
        <span className="fw-by-label">⋮ {label}</span>
        <span className="fw-by-decoded">
          {piece.hidden} {unit} not drawn
        </span>
      </>
    );
  }
  if (piece.part > 0) {
    return <span className="fw-by-label is-cont">{label} (continued)</span>;
  }
  if (frame.unit === 'bytes' && piece.kind === 'cells') {
    const bytes = bytesOfField(field, value)?.slice(piece.skip, piece.skip + piece.span);
    return (
      <>
        <span className="fw-by-label">{label}</span>
        {bytes !== undefined && (
          <span
            className="fw-by-bytes"
            style={{ gridTemplateColumns: `repeat(${piece.span}, 1fr)` }}
          >
            {bytes.map((byte, index) => (
              <span key={index}>{hex(byte)}</span>
            ))}
          </span>
        )}
        {decoded !== undefined && !compact && <span className="fw-by-decoded">{decoded}</span>}
      </>
    );
  }
  return (
    <>
      <span className="fw-by-label">{label}</span>
      {value !== undefined && <span className="fw-by-value">{String(value)}</span>}
      {piece.kind === 'open' && value === undefined && (
        <span className="fw-by-decoded">variable length</span>
      )}
      {decoded !== undefined && !compact && <span className="fw-by-decoded">{decoded}</span>}
    </>
  );
}

function NarrowText({
  frame,
  field,
  shared,
}: {
  frame: FrameDecl;
  field: FieldDecl;
  shared: Shared;
}) {
  const value = valueOf(frame, field, shared.state.patches);
  return (
    <>
      <span className="fw-by-vertical">{field.short ?? field.label ?? field.id}</span>
      {value !== undefined && <span className="fw-by-value">{String(value)}</span>}
    </>
  );
}

function BitsFrame({ frame, shared }: { frame: FrameDecl; shared: Shared }) {
  const declared = rowWidth(frame);
  const isBits = frame.unit === 'bits';
  const gutter = isBits ? 40 : 46 + (frame.ascii ? Math.min(declared, 16) * 8 + 10 : 0);
  // The pane's padding and the frame's own come off the room before the columns are counted.
  const width = fitWidth(
    declared,
    shared.room - 50 - gutter,
    MIN_COLUMN[frame.unit === 'bits' ? 'bits' : 'bytes'],
  );
  const drawn = useMemo(() => layout(frame, width), [frame, width]);
  const geometry = measure(frame);
  const base = isBits && frame.ruler ? 2 : 0;
  const at = cursorAt(frame, shared.state.patches);
  const cursorHere =
    frame.cursor === undefined || at === null ? undefined : placeCursor(drawn, at, geometry.total);
  const fields = new Map(frame.fields.map((field) => [field.id, field]));

  // Where each row starts, for its label on the left.
  const starts = new Map<number, { from: number; gap: boolean }>();
  for (const piece of drawn.pieces) {
    const from = piece.kind === 'gap' ? piece.from : piece.from - piece.col;
    const old = starts.get(piece.row);
    if (old === undefined || from < old.from)
      starts.set(piece.row, { from, gap: piece.kind === 'gap' });
  }
  const cursorStyle = cursorHere === undefined ? undefined : cursorHere;
  const cursorMark = markOf(cursorId(frame.id), shared.current);

  const columns = `${gutter}px repeat(${width}, minmax(0, 1fr))${frame.ascii && !isBits ? ' auto' : ''}`;
  return (
    <div
      className={`fw-by-grid is-${frame.unit}${frame.cursor === undefined ? '' : ' has-cursor'}`}
      style={{ gridTemplateColumns: columns }}
      role="group"
      aria-label={`${frame.title}, ${width} ${frame.unit} to a row`}
      data-width={width}
    >
      {base > 0 &&
        Array.from({ length: width }, (_, col) => (
          <span
            key={`t${col}`}
            className="fw-by-ruler is-tens"
            style={{ gridColumn: col + 2, gridRow: 1 }}
            aria-hidden="true"
          >
            {col % 10 === 0 ? col / 10 : ''}
          </span>
        ))}
      {base > 0 &&
        Array.from({ length: width }, (_, col) => (
          <span
            key={`o${col}`}
            className="fw-by-ruler"
            style={{ gridColumn: col + 2, gridRow: 2 }}
            aria-hidden="true"
          >
            {col % 10}
          </span>
        ))}
      {Array.from({ length: drawn.rows }, (_, row) => {
        const start = starts.get(row);
        const label =
          start === undefined
            ? ''
            : start.gap
              ? '⋮'
              : isBits
                ? String(start.from)
                : start.from.toString(16).padStart(4, '0');
        return (
          <span
            key={`r${row}`}
            className="fw-by-offset"
            style={{ gridColumn: 1, gridRow: base + row + 1 }}
            aria-hidden="true"
          >
            {label}
          </span>
        );
      })}
      {drawn.pieces.map((piece) => {
        const field = fields.get(piece.field)!;
        const narrow = isBits && piece.kind === 'cells' && piece.span <= 2;
        return (
          <FieldBox
            key={`${piece.field}-${piece.part}`}
            frame={frame}
            field={field}
            piece={piece}
            shared={shared}
            narrow={narrow}
            style={{
              gridColumn: `${piece.col + 2} / span ${piece.span}`,
              gridRow: base + piece.row + 1,
            }}
          >
            {narrow && piece.part === 0 ? (
              <NarrowText frame={frame} field={field} shared={shared} />
            ) : (
              <PieceText
                frame={frame}
                field={field}
                piece={piece}
                shared={shared}
                compact={isBits && piece.kind === 'cells' && piece.span <= 4}
              />
            )}
          </FieldBox>
        );
      })}
      {frame.ascii &&
        !isBits &&
        Array.from({ length: drawn.rows }, (_, row) => {
          const cells = drawn.pieces.filter((piece) => piece.row === row && piece.kind === 'cells');
          return (
            <span
              key={`a${row}`}
              className="fw-by-ascii"
              style={{ gridColumn: width + 2, gridRow: base + row + 1 }}
              aria-hidden="true"
            >
              {Array.from({ length: width }, (_, col) => {
                const piece = cells.find((item) => col >= item.col && col < item.col + item.span);
                if (piece === undefined) return <span key={col}> </span>;
                const field = fields.get(piece.field)!;
                const bytes = bytesOfField(field, valueOf(frame, field, shared.state.patches));
                const byte = bytes?.[piece.skip + (col - piece.col)];
                const id = fieldId(frame.id, field.id);
                return (
                  <span
                    key={col}
                    data-mark={markFor(shared, frame, id)}
                    className={shared.selected === id ? 'is-selected' : undefined}
                  >
                    {byte === undefined ? '·' : printable(byte)}
                  </span>
                );
              })}
            </span>
          );
        })}
      {cursorStyle !== undefined && frame.cursor !== undefined && (
        <div
          className={`fw-by-cursor is-${cursorMark === 'faded' ? 'idle' : cursorMark}${shared.selected === cursorId(frame.id) ? ' is-selected' : ''}`}
          style={{ gridColumn: cursorStyle.col + 2, gridRow: base + cursorStyle.row + 1 }}
          data-entity={cursorId(frame.id)}
          data-mark={cursorMark === 'faded' ? 'idle' : cursorMark}
          data-edge={cursorStyle.edge}
          data-tone={toneOf(own(shared.state.patches, cursorId(frame.id))?.tone, frame.cursor.tone)}
        >
          <button
            type="button"
            aria-pressed={shared.selected === cursorId(frame.id)}
            aria-label={`${text(own(shared.state.patches, cursorId(frame.id))?.label) ?? frame.cursor.label} at ${whereIs(frame.unit, at!, 1)}`}
            onClick={() => shared.toggle(cursorId(frame.id))}
          >
            {text(own(shared.state.patches, cursorId(frame.id))?.label) ?? frame.cursor.label}
          </button>
        </div>
      )}
    </div>
  );
}

function SegmentsFrame({ frame, shared }: { frame: FrameDecl; shared: Shared }) {
  const geometry = measure(frame, (field) => {
    const value = valueOf(frame, field, shared.state.patches);
    return typeof value === 'string' ? value : undefined;
  });
  const at = cursorAt(frame, shared.state.patches);
  const cursorMark = markOf(cursorId(frame.id), shared.current);
  // The segment the cursor is in: the last one that starts at or before it.
  let holder = -1;
  if (at !== null) {
    geometry.fields.forEach((placed, index) => {
      if (at >= placed.offset) holder = index;
    });
  }
  const label =
    frame.cursor === undefined
      ? ''
      : (text(own(shared.state.patches, cursorId(frame.id))?.label) ?? frame.cursor.label);
  return (
    <div
      className={`fw-by-segments${frame.cursor === undefined ? '' : ' has-cursor'}`}
      role="group"
      aria-label={frame.title}
    >
      {frame.fields.map((field, index) => {
        const value = valueOf(frame, field, shared.state.patches);
        const decoded = decodedOf(frame, field, shared.state.patches);
        const placed = geometry.fields[index]!;
        const textValue = typeof value === 'string' ? value : '';
        const caret =
          holder === index ? Math.min((at ?? 0) - placed.offset, textValue.length) : undefined;
        return (
          <span key={field.id} className="fw-by-seg">
            <FieldBox frame={frame} field={field} shared={shared}>
              <span className="fw-by-label">
                {index + 1}. {field.label ?? field.id}
              </span>
              <span className={`fw-by-value${textValue === '' ? ' is-empty' : ''}`}>
                {textValue === '' ? (
                  caret === undefined ? (
                    '(empty)'
                  ) : (
                    <span className="fw-by-caret" />
                  )
                ) : caret === undefined ? (
                  textValue
                ) : (
                  <>
                    {textValue.slice(0, caret)}
                    <span className="fw-by-caret" />
                    {textValue.slice(caret)}
                  </>
                )}
              </span>
              {decoded !== undefined && <span className="fw-by-decoded">{decoded}</span>}
            </FieldBox>
            {caret !== undefined && frame.cursor !== undefined && (
              <span
                className={`fw-by-cursor is-${cursorMark === 'faded' ? 'idle' : cursorMark}${shared.selected === cursorId(frame.id) ? ' is-selected' : ''}`}
                data-entity={cursorId(frame.id)}
                data-mark={cursorMark === 'faded' ? 'idle' : cursorMark}
              >
                <button
                  type="button"
                  aria-pressed={shared.selected === cursorId(frame.id)}
                  aria-label={`${label} at ${whereIs('segments', at!, 1)}`}
                  onClick={() => shared.toggle(cursorId(frame.id))}
                >
                  {label}
                </button>
              </span>
            )}
            {index < frame.fields.length - 1 && (
              <span className="fw-by-sep" aria-hidden="true">
                {frame.separator}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

/** The fields this call marks in a frame, and the one the reader chose, with what each holds. */
function Detail({ frame, shared }: { frame: FrameDecl; shared: Shared }) {
  const framed = markOf(frame.id, shared.current);
  const chosen = frame.fields.filter((field) => {
    const id = fieldId(frame.id, field.id);
    const mark = markOf(id, shared.current);
    return (mark !== 'faded' && mark !== 'idle') || shared.selected === id;
  });
  const whole = framed === 'added' || framed === 'read' || framed === 'removed';
  const marked = chosen.length > 0 || !whole ? chosen : frame.fields;
  const list = marked.slice(0, 3);
  if (list.length === 0) {
    return (
      <p className="fw-by-detail is-hint">Choose a field to read its place, size and meaning.</p>
    );
  }
  return (
    <div className="fw-by-detail">
      {list.map((field) => {
        const info = describeField(frame, field, shared);
        const link = field.link;
        return (
          <p key={field.id} className="fw-by-note" data-field={fieldId(frame.id, field.id)}>
            <strong>{field.label ?? field.id}</strong>
            <span className="fw-by-where">
              {info.where} · {info.size}
            </span>
            {info.value !== undefined && <code>{info.value === '' ? '(empty)' : info.value}</code>}
            {info.decoded !== undefined && <span className="fw-by-meaning">{info.decoded}</span>}
            {link !== undefined && (
              <button
                type="button"
                className="fw-by-note-link"
                aria-pressed={shared.selected === link.$ref}
                onClick={() => shared.toggle(link.$ref)}
              >
                {link.text ?? link.$ref} ↗
              </button>
            )}
          </p>
        );
      })}
      {marked.length > list.length && (
        <p className="fw-by-more">and {marked.length - list.length} more marked</p>
      )}
    </div>
  );
}

function FrameView({
  frame,
  shared,
  content,
}: {
  frame: FrameDecl;
  shared: Shared;
  content: BytesContent;
}) {
  const shown = shared.state.present.includes(frame.id) || shared.current.removed.has(frame.id);
  const mark = frameMark(shared, frame);
  const geometry = measure(frame, (field) => {
    const value = valueOf(frame, field, shared.state.patches);
    return typeof value === 'string' ? value : undefined;
  });
  const patch = own(shared.state.patches, frame.id);
  const title = text(patch?.title) ?? frame.title;
  const sub = text(patch?.sub) ?? frame.sub;
  const outer = frame.inside === undefined ? undefined : frame.inside;
  const outerFrame =
    outer === undefined
      ? undefined
      : content.frames.find((item) => outer === item.id || outer.startsWith(`${item.id}.`));
  const depth = (() => {
    let steps = 0;
    for (let next = outerFrame; next !== undefined && steps < 8; steps += 1) {
      const up: string | undefined = next.inside;
      next =
        up === undefined
          ? undefined
          : content.frames.find((item) => up === item.id || up.startsWith(`${item.id}.`));
    }
    return steps;
  })();
  return (
    <section
      className={`fw-by-frame is-${shown ? mark : 'absent'}${shared.selected === frame.id ? ' is-selected' : ''}`}
      style={{ marginLeft: depth * 14 }}
      data-entity={frame.id}
      data-mark={shown ? (mark === 'updated' ? 'idle' : mark) : 'absent'}
      data-tone={toneOf(patch?.tone, frame.tone)}
      data-unit={frame.unit}
      aria-hidden={shown ? undefined : true}
    >
      <header className="fw-by-head">
        <button
          type="button"
          className="fw-by-title"
          aria-pressed={shared.selected === frame.id}
          onClick={() => shared.toggle(frame.id)}
        >
          {title}
        </button>
        {sub !== undefined && <span className="fw-by-sub">{sub}</span>}
        <span className="fw-by-total">
          {describeTotal(frame.unit, geometry.total, frame.fields.length)}
        </span>
        {outer !== undefined && (
          <button
            type="button"
            className="fw-by-inside"
            aria-pressed={shared.selected === outer}
            onClick={() => shared.toggle(outer)}
          >
            inside {outer}
          </button>
        )}
      </header>
      {frame.unit === 'segments' ? (
        <SegmentsFrame frame={frame} shared={shared} />
      ) : (
        <BitsFrame frame={frame} shared={shared} />
      )}
      <Detail frame={frame} shared={shared} />
    </section>
  );
}

function BytesView({
  state,
  content,
  ctx,
}: {
  state: BytesState;
  content: BytesContent;
  ctx: PanelContext;
}) {
  const [widthRef, room] = useWidth<HTMLDivElement>();
  const scroller = useRef<HTMLDivElement | null>(null);
  const callId = ctx.call.id;
  // Bring what the call is about into view: a frame it adds first, else the first field it marks.
  useEffect(() => {
    const box = scroller.current;
    if (box === null) return;
    const target =
      box.querySelector<HTMLElement>('[data-mark="added"]') ??
      box.querySelector<HTMLElement>(TOUCHED_SELECTOR);
    if (target === null) return;
    const frame = box.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    const y = revealScroll(
      { scroll: box.scrollTop, size: box.clientHeight },
      { start: rect.top - frame.top + box.scrollTop, size: rect.height },
    );
    if (y !== undefined) box.scrollTop = y;
  }, [callId]);
  const effects = ctx.current;
  const current = useMemo(() => touched(effects), [effects]);
  const selected = ctx.selection.id;
  const shared: Shared = {
    state,
    current,
    selected,
    room,
    toggle: (id) => ctx.selection.select(selected === id ? undefined : id),
  };
  return (
    <div className="fw-bytes" ref={scroller}>
      <div className="fw-by-inner" ref={widthRef}>
        {content.frames.map((frame) => (
          <FrameView key={frame.id} frame={frame} shared={shared} content={content} />
        ))}
      </div>
    </div>
  );
}

function cardSections({
  state,
  content,
  current,
  pane,
}: {
  state: BytesState;
  content: BytesContent;
  current: Parameters<typeof touched>[0];
  pane: { title: string };
}): CardSection[] {
  const labels = uniqueLabels(entitiesOf(content));
  const mark = touched(current);
  const rows: { key: string; value: string }[] = [];
  for (const frame of content.frames) {
    if (!state.present.includes(frame.id)) continue;
    const shared = { state, current: mark } as Shared;
    const geometry = measure(frame, (field) => {
      const value = valueOf(frame, field, state.patches);
      return typeof value === 'string' ? value : undefined;
    });
    for (const field of frame.fields) {
      const id = fieldId(frame.id, field.id);
      if (!mark.added.has(id) && !mark.updated.has(id) && !mark.read.has(id)) continue;
      const info = describeField(frame, field, shared);
      rows.push({
        key: labels.get(id) ?? id,
        value: [
          info.where,
          info.value === undefined
            ? undefined
            : `= ${info.value.length > 32 ? `${info.value.slice(0, 29)}…` : info.value}`,
          info.decoded,
        ]
          .filter((part): part is string => part !== undefined)
          .join(' · '),
      });
    }
    const at = cursorAt(frame, state.patches);
    if (frame.cursor !== undefined && at !== null) {
      const next = geometry.fields.find(
        (placed) => placed.size !== null && at >= placed.offset && at < placed.offset + placed.size,
      );
      const name =
        next === undefined ? undefined : frame.fields.find((field) => field.id === next.id);
      rows.push({
        key: `${frame.title}: ${text(own(state.patches, cursorId(frame.id))?.label) ?? frame.cursor.label}`,
        value: `${whereIs(frame.unit, at, 1)}${name === undefined ? ', the end' : `, in ${name.label ?? name.id}`}`,
      });
    }
  }
  return [
    ...changesSection(pane.title, labels, current),
    ...(rows.length === 0
      ? []
      : [{ id: 'now', title: `${pane.title}: now`, kind: 'fields' as const, rows }]),
  ];
}

export const bytesPanel: PanelType<BytesContent, BytesState> = {
  id: 'bytes',
  schema: { content: BytesContent },
  entities: entitiesOf,
  init,
  reduce,
  Component: BytesView,
  cardSections,
  lint: bytesLint,
};
