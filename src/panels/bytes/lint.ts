/**
 * Lint for the bytes panel. Everything a frame says about itself has to add up: the sizes make
 * the length, a value fits its size, a field that counts something holds the right count, a
 * frame that sits inside another fits in it. Values are checked as they stand at every call,
 * because an `update` may change them.
 */
import {
  effectTarget,
  writtenEffects,
  type Problem,
  type ResolvedPane,
  type Walkthrough,
} from '../../core';
import { fieldProblems } from '../_shared/fields';
import {
  CURSOR_FIELDS,
  CURSOR,
  FIELD_FIELDS,
  FRAME_FIELDS,
  countedSlots,
  cursorId,
  expectedCount,
  fieldId,
  judgeValue,
  layout,
  measure,
  numeric,
  rowWidth,
  type BytesContent,
  type FieldDecl,
  type FrameDecl,
} from './model';

const EFFECT_KEYS = ['add', 'update', 'read', 'remove', 'focus', 'fields'];
/** A fixed field that would draw more rows than this should say it is `variable`. */
const LONG_FIELD_ROWS = 16;

type Path = (string | number)[];

interface Target {
  frame: FrameDecl;
  kind: 'frame' | 'field' | 'cursor';
  field?: FieldDecl;
}

/** Every element id of the pane and what it is. */
function targetsOf(content: BytesContent): Map<string, Target> {
  const targets = new Map<string, Target>();
  for (const frame of content.frames) {
    targets.set(frame.id, { frame, kind: 'frame' });
    for (const field of frame.fields) {
      targets.set(fieldId(frame.id, field.id), { frame, kind: 'field', field });
    }
    if (frame.cursor !== undefined) targets.set(cursorId(frame.id), { frame, kind: 'cursor' });
  }
  return targets;
}

/** The size of a frame in bytes where that is known, for comparing a frame with its container. */
function bytesIn(frame: FrameDecl, size: number | null): number | undefined {
  if (size === null) return undefined;
  if (frame.unit === 'bits') return size / 8;
  if (frame.unit === 'bytes') return size;
  return undefined;
}

export function bytesLint(
  pane: ResolvedPane,
  walkthrough: Walkthrough,
  known: ReadonlySet<string>,
): Problem[] {
  const content = pane.content as BytesContent;
  const paneIndex = walkthrough.layout.panes.findIndex((item) => item.id === pane.id);
  const where: Path = ['layout', 'panes', paneIndex, 'content'];
  const problems: Problem[] = [];
  const error = (
    rule: string,
    path: Path,
    message: string,
    severity: Problem['severity'] = 'error',
  ) => problems.push({ severity, rule: `bytes/${rule}`, path, message });

  const targets = targetsOf(content);
  const frames = new Map<string, number>();
  content.frames.forEach((frame, position) => {
    const at: Path = [...where, 'frames', position];
    if (frames.has(frame.id)) {
      error('duplicate-frame', [...at, 'id'], `frame "${frame.id}" is declared twice`);
    }
    frames.set(frame.id, position);

    const seen = new Set<string>();
    frame.fields.forEach((field, index) => {
      const here: Path = [...at, 'fields', index];
      if (seen.has(field.id)) {
        error(
          'duplicate-field',
          [...here, 'id'],
          `frame "${frame.id}" has two fields called "${field.id}"`,
        );
      }
      seen.add(field.id);
      if (field.id === CURSOR) {
        error(
          'reserved-field',
          [...here, 'id'],
          `"${CURSOR}" names the frame's parser cursor, so a field cannot have it`,
        );
      }
    });

    // Sizes.
    const sizes = measure(frame);
    if (frame.unit === 'segments') {
      if (frame.width !== undefined) {
        error(
          'unused-option',
          [...at, 'width'],
          'a segments frame has no rows, so "width" is ignored',
          'warning',
        );
      }
      frame.fields.forEach((field, index) => {
        const text = typeof field.value === 'string' ? field.value : '';
        if (field.size !== undefined && field.size !== text.length) {
          error(
            'size-mismatch',
            [...at, 'fields', index, 'size'],
            `"${field.id}" says it is ${field.size} characters but its text is ${text.length}`,
          );
        }
        if (typeof field.value === 'number') {
          error('bad-value', [...at, 'fields', index, 'value'], 'the value of a segment is text');
        }
      });
    } else {
      if (
        frame.unit === 'bytes' &&
        frame.width !== undefined &&
        frame.width !== 8 &&
        frame.width !== 16
      ) {
        error('bad-width', [...at, 'width'], `bytes go 8 or 16 to a row; got ${frame.width}`);
      }
      if (frame.unit === 'bits' && frame.ascii) {
        error('unused-option', [...at, 'ascii'], 'an ASCII gutter is for bytes frames', 'warning');
      }
      if (frame.unit === 'bytes' && frame.separator !== '.') {
        error(
          'unused-option',
          [...at, 'separator'],
          'a separator is for segments frames',
          'warning',
        );
      }
      frame.fields.forEach((field, index) => {
        const here: Path = [...at, 'fields', index];
        if (field.size === undefined && !field.variable) {
          error(
            'size-missing',
            here,
            `"${field.id}" needs a size, or "variable": true if its length varies`,
          );
        }
        if (field.size === undefined && field.variable && index < frame.fields.length - 1) {
          error(
            'unsized-not-last',
            here,
            `"${field.id}" has no size, so nothing after it could have an offset; give it a size or move it last`,
          );
        }
        if (field.variable && field.size === undefined && field.value !== undefined) {
          error(
            'bad-value',
            [...here, 'value'],
            `"${field.id}" has no size to check its value against`,
            'warning',
          );
        }
      });
      const rows = layout(frame, rowWidth(frame));
      frame.fields.forEach((field, index) => {
        const drawn = rows.pieces.filter((piece) => piece.field === field.id).length;
        if (!field.variable && drawn > LONG_FIELD_ROWS) {
          error(
            'long-field',
            [...at, 'fields', index],
            `"${field.id}" fills ${drawn} rows. Mark it "variable": true to draw its ends and a gap`,
            'warning',
          );
        }
      });
    }

    // The declared length against the sum of the sizes.
    if (frame.length !== undefined && sizes.total !== null && frame.length !== sizes.total) {
      error(
        'length-mismatch',
        [...at, 'length'],
        `frame "${frame.id}" says it is ${frame.length} ${frame.unit === 'bits' ? 'bits' : frame.unit === 'bytes' ? 'bytes' : 'characters'} long but its fields add up to ${sizes.total}`,
      );
    } else if (frame.length !== undefined && sizes.total === null) {
      error(
        'length-unknown',
        [...at, 'length'],
        `frame "${frame.id}" says how long it is but its last field has no size, so it cannot be checked`,
        'warning',
      );
    }

    // Values that are numbers fit their size.
    frame.fields.forEach((field, index) => {
      if (field.value === undefined) return;
      const message = judgeValue(frame.unit, field.size, field.value, `the value of "${field.id}"`);
      if (message !== null) error('bad-value', [...at, 'fields', index, 'value'], message);
    });

    // A cursor that starts past the end.
    if (frame.cursor !== undefined && frame.cursor.at !== null && sizes.total !== null) {
      if (frame.cursor.at > sizes.total) {
        error(
          'cursor-range',
          [...at, 'cursor', 'at'],
          `the cursor starts at ${frame.cursor.at}, past the end of a frame that is ${sizes.total} long`,
        );
      }
    }

    // Fields that count.
    frame.fields.forEach((field, index) => {
      if (field.counts === undefined) return;
      const here: Path = [...at, 'fields', index, 'counts'];
      if (frame.unit === 'segments') {
        error(
          'bad-counts',
          here,
          'a field counts slots of bits or bytes, so a segments frame cannot use "counts"',
        );
        return;
      }
      const ids = frame.fields.map((item) => item.id);
      const refs =
        typeof field.counts.of === 'string'
          ? [field.counts.of]
          : [field.counts.of.from, field.counts.of.to];
      const missing = refs.filter((id) => !ids.includes(id));
      if (missing.length > 0) {
        error(
          'bad-counts',
          [...here, 'of'],
          `"${field.id}" counts "${missing[0]}", which is not a field of frame "${frame.id}"`,
        );
        return;
      }
      if (
        typeof field.counts.of !== 'string' &&
        ids.indexOf(field.counts.of.from) > ids.indexOf(field.counts.of.to)
      ) {
        error(
          'bad-counts',
          [...here, 'of'],
          `"${field.id}" counts from "${field.counts.of.from}" to "${field.counts.of.to}", which is backwards`,
        );
        return;
      }
      const slots = countedSlots(frame, field.counts.of);
      if (slots === undefined) {
        error(
          'bad-counts',
          [...here, 'of'],
          `"${field.id}" counts fields that have no size, so the count cannot be checked`,
          'warning',
        );
      } else if (slots % field.counts.per !== 0) {
        error(
          'count-mismatch',
          here,
          `"${field.id}" counts in units of ${field.counts.per}, but the fields it counts are ${slots} ${frame.unit} and that is not a whole number of them`,
        );
      }
    });
  });

  // Frames inside frames.
  content.frames.forEach((frame, position) => {
    if (frame.inside === undefined) return;
    const at: Path = [...where, 'frames', position, 'inside'];
    const target = targets.get(frame.inside);
    if (target === undefined || target.kind === 'cursor') {
      error(
        'unknown-inside',
        at,
        `"${frame.inside}" is not a frame or a field of a frame in this pane`,
      );
      return;
    }
    const outer = target.frame;
    if (outer.id === frame.id) {
      error('inside-cycle', at, `frame "${frame.id}" cannot be inside itself`);
      return;
    }
    // Following the chain outwards: a frame that is eventually inside itself is a cycle.
    const chain = new Set([frame.id]);
    for (let next: FrameDecl | undefined = outer; next !== undefined;) {
      if (chain.has(next.id)) {
        error('inside-cycle', at, `frame "${frame.id}" is inside frames that are inside it`);
        return;
      }
      chain.add(next.id);
      next = next.inside === undefined ? undefined : targets.get(next.inside)?.frame;
    }
    if ((frames.get(outer.id) ?? 0) > position) {
      error(
        'inside-order',
        at,
        `frame "${outer.id}" holds "${frame.id}", so it must be listed before it`,
      );
    }
    // The inner frame has to fit the field that carries it.
    if (target.kind === 'field' && target.field !== undefined) {
      const inner = bytesIn(frame, measure(frame).total);
      const room = target.field.size === undefined ? undefined : bytesIn(outer, target.field.size);
      if (inner !== undefined && room !== undefined && inner > room) {
        error(
          'inside-size',
          at,
          `frame "${frame.id}" is ${inner} bytes but "${frame.inside}" holds only ${room}`,
        );
      }
      if (!target.field.variable && target.field.size === undefined) {
        error('inside-size', at, `"${frame.inside}" is not a field with a size`, 'warning');
      }
    }
  });

  // Links to elements of other panes.
  content.frames.forEach((frame, position) => {
    frame.fields.forEach((field, index) => {
      if (field.link !== undefined && !known.has(field.link.$ref)) {
        error(
          'unknown-ref',
          [...where, 'frames', position, 'fields', index, 'link', '$ref'],
          `the link names "${field.link.$ref}", which is not an element in any pane`,
        );
      }
    });
  });

  // Updates: which fields an element takes, and whether the values are fine.
  const judge = (id: string, name: string, value: unknown): string | null | undefined => {
    const target = targets.get(id);
    if (target === undefined) return undefined;
    const { frame } = target;
    if (target.kind === 'field' && target.field !== undefined) {
      if (name === 'value') {
        const message = judgeValue(
          frame.unit,
          target.field.size,
          value,
          `the value of "${target.field.id}"`,
        );
        if (message !== null) return message;
        if (
          frame.unit === 'segments' &&
          target.field.size !== undefined &&
          typeof value === 'string' &&
          value.length !== target.field.size
        ) {
          return `"${target.field.id}" is ${target.field.size} characters and this text is ${value.length}`;
        }
        return null;
      }
      return undefined;
    }
    if (target.kind === 'cursor' && name === 'at') {
      if (value === null) return null;
      const total = measure(frame).total;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        return `the cursor's "at" is a whole number from 0, or null; got ${JSON.stringify(value)}`;
      }
      if (total !== null && value > total)
        return `the cursor's "at" is past the end of a frame ${total} long`;
      return null;
    }
    return undefined;
  };
  problems.push(
    ...fieldProblems(
      pane,
      walkthrough,
      (id) => {
        const target = targets.get(id);
        if (target === undefined) return undefined;
        return target.kind === 'frame'
          ? FRAME_FIELDS
          : target.kind === 'field'
            ? FIELD_FIELDS
            : CURSOR_FIELDS;
      },
      judge,
    ),
  );

  // Walking the calls: a frame must be there for its fields to be touched, and a counting field
  // must hold the right count at every call.
  const present = new Set(
    content.frames.filter((frame) => frame.initial ?? content.initial).map((frame) => frame.id),
  );
  const values = new Map<string, string | number | undefined>();
  const resetValues = (frame: FrameDecl) =>
    frame.fields.forEach((field) => values.set(fieldId(frame.id, field.id), field.value));
  content.frames.forEach(resetValues);

  const checkCount = (target: Target, at: Path) => {
    const { frame, field } = target;
    if (field?.counts === undefined) return;
    const expected = expectedCount(frame, field);
    if (expected === undefined) return;
    const value = values.get(fieldId(frame.id, field.id));
    const number = numeric(frame.unit, value);
    if (number !== undefined && number !== BigInt(expected)) {
      error(
        'count-mismatch',
        at,
        `"${field.id}" is ${String(value)} but the fields it counts come to ${expected}${field.counts.per === 1 ? '' : ` (in units of ${field.counts.per})`}`,
      );
    }
  };
  content.frames.forEach((frame, position) => {
    frame.fields.forEach((field, index) =>
      checkCount({ frame, kind: 'field', field }, [
        ...where,
        'frames',
        position,
        'fields',
        index,
        'value',
      ]),
    );
  });

  walkthrough.steps.forEach((step, s) => {
    step.calls.forEach((call, c) => {
      writtenEffects(call, pane.id).forEach((effect, e) => {
        const at: Path = ['steps', s, 'calls', c, 'effects', pane.id, e];
        for (const key of Object.keys(effect)) {
          if (EFFECT_KEYS.includes(key)) continue;
          error(
            'unknown-key',
            [...at, key],
            `an effect on a frame takes ${EFFECT_KEYS.join(', ')}; "${key}" is ignored`,
            'warning',
          );
        }
        const { verb, id } = effectTarget(effect);
        const target = targets.get(id);
        if (target === undefined) return;
        if (target.kind === 'frame') {
          if (verb === 'add') present.add(id);
          else if (verb === 'remove') {
            present.delete(id);
            resetValues(target.frame);
          }
          return;
        }
        if (verb === 'add' || verb === 'remove') {
          error(
            'field-presence',
            [...at, verb],
            `"${id}" appears and goes with its frame; ${verb} "${target.frame.id}" instead`,
          );
        } else if (!present.has(target.frame.id)) {
          error(
            'absent-frame',
            [...at, verb],
            `cannot ${verb} "${id}": frame "${target.frame.id}" is not present at this call`,
          );
        }
        if (verb === 'update' && target.kind === 'field' && effect.fields !== undefined) {
          const next: unknown = effect.fields.value;
          if (typeof next === 'string' || typeof next === 'number') {
            values.set(id, next);
            checkCount(target, [...at, 'fields', 'value']);
          }
        }
      });
    });
  });
  return problems;
}
