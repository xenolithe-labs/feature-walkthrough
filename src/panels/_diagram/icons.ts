/**
 * Icons for diagram nodes: a small built-in set of generic shapes, and a pane's own `icons` map
 * for anything else (an author can supply provider icons without the project bundling them).
 *
 * An icon is path data and nothing else. It is checked against a whitelist of the characters
 * path data uses, so markup cannot get in, and it is only ever drawn as the `d` of one `<path>`.
 */
import { z } from 'zod';
import { own } from '../../core';

/** A path drawn in a 24 by 24 box. Built-in icons are outlines. */
export interface ResolvedIcon {
  d: string;
  /** Filled shape instead of an outline. */
  fill: boolean;
  /** The side of the square box the path is drawn in. */
  size: number;
}

const BUILT_IN: Record<string, string> = {
  server: 'M4 4h16v6H4z M4 14h16v6H4z M7.5 7h.01 M7.5 17h.01',
  database:
    'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  queue: 'M3 8h4v8H3z M10 8h4v8h-4z M17 8h4v8h-4z M7 12h3 M14 12h3',
  balancer: 'M3 12h6 M9 12c3 0 4-6 8-6h4 M9 12h12 M9 12c3 0 4 6 8 6h4',
  user: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7',
  lock: 'M6 11h12v10H6z M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11 M12 15v2',
  cloud: 'M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5 4 4 0 0 1 17.5 18H7z',
  globe:
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M3 12h18 M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z',
  function:
    'M9 4C7 4 6 5 6 7v3c0 1.2-.8 2-2 2 1.2 0 2 .8 2 2v3c0 2 1 3 3 3 M15 4c2 0 3 1 3 3v3c0 1.2.8 2 2 2-1.2 0-2 .8-2 2v3c0 2-1 3-3 3',
  storage:
    'M4 7c0-1.4 3.6-2.5 8-2.5S20 5.6 20 7s-3.6 2.5-8 2.5S4 8.4 4 7z M4 7l2 12c.2 1 2.7 2 6 2s5.8-1 6-2l2-12',
  cache: 'M13 3L5 13h6l-1 8 8-10h-6l1-8z',
  container: 'M3 8l9-5 9 5v8l-9 5-9-5z M3 8l9 5 9-5 M12 13v8',
  key: 'M10.2 13l9.3-9.3 M16 7.5l2.5 2.5 M14 9.5l2 2 M7.5 12a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  shield: 'M12 3l8 3v5.5c0 4.7-3.2 8.2-8 9.5-4.8-1.3-8-4.8-8-9.5V6l8-3z M9 12l2.2 2.2L15.5 10',
  network:
    'M12 3.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z M5 16.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z M19 16.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z M12 7.5v8 M5 16.5v-5h14v5',
  gateway: 'M3 12h12 M11 8l4 4-4 4 M19 4v16',
  document: 'M6 3h8l4 4v14H6z M14 3v4h4 M9 12h6 M9 16h6',
  package: 'M4 7.5L12 3l8 4.5v9L12 21l-8-4.5z M4 7.5l8 4.5 8-4.5 M12 12v9 M8 5.3l8 4.5',
  bug: 'M9 7a3 3 0 0 1 6 0 M8 9h8v6a4 4 0 0 1-8 0z M12 9v10 M8 12H4 M16 12h4 M8 16l-3 2 M16 16l3 2 M9 6L7 4 M15 6l2-2',
  users:
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6 M16 4.3a3.5 3.5 0 0 1 0 6.4 M18 14.3c2.3.7 3.5 2.6 3.5 5.7',
  alert: 'M12 3.5L21.5 20h-19z M12 10v4.5 M12 17.5h.01',
};

/** The names of the built-in icons. */
export const ICON_NAMES: readonly string[] = Object.keys(BUILT_IN);

/** What path data is made of: commands, numbers and separators. No letters outside the commands. */
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE+\-.,\s]+$/;
export const MAX_PATH_LENGTH = 4000;

export const PathDataSchema = z
  .string()
  .max(MAX_PATH_LENGTH, `path data is at most ${MAX_PATH_LENGTH} characters`)
  .regex(PATH_DATA, 'icons are path data only (M, L, C, A, Z and numbers), never markup');

/** A custom icon: path data, or path data with how to draw it. */
export const CustomIconSchema = z.union([
  PathDataSchema,
  z.strictObject({
    d: PathDataSchema,
    /** Draw a filled shape instead of an outline. */
    fill: z.boolean().optional(),
    /** The side of the square the path is drawn in. Defaults to 24. */
    size: z.number().positive().max(512).optional(),
  }),
]);
export type CustomIcon = z.infer<typeof CustomIconSchema>;

/** An icon by name: the pane's own first, then the built-in set. Undefined for an unknown name. */
export function resolveIcon(
  name: string | undefined,
  custom: Readonly<Record<string, CustomIcon>> | undefined,
): ResolvedIcon | undefined {
  if (name === undefined) return undefined;
  const mine = own(custom, name);
  if (mine !== undefined) {
    return typeof mine === 'string'
      ? { d: mine, fill: false, size: 24 }
      : { d: mine.d, fill: mine.fill ?? false, size: mine.size ?? 24 };
  }
  const builtIn = own(BUILT_IN, name);
  return builtIn === undefined ? undefined : { d: builtIn, fill: false, size: 24 };
}

/** Extra height an icon above a node's label needs. */
export const ICON_BAND = 24;
