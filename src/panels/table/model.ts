/**
 * The table's derived values: legend lookups, row groups and meter numbers. Pure, so that the
 * view, the lint and the tests share one answer.
 */
import { own } from '../../core';

export const LEGEND_TONES = ['good', 'warn', 'muted'] as const;
export type LegendTone = (typeof LEGEND_TONES)[number];

export interface LegendEntry {
  tone?: LegendTone | undefined;
  label: string;
}

/** The id of a column as an element: `col.<column>`. Dots are reserved, so no row can have it. */
export const columnElement = (columnId: string) => `col.${columnId}`;

/** The legend entry for a cell's text, or undefined. Own keys only: "constructor" is just text. */
export function legendFor(
  legend: Readonly<Record<string, LegendEntry>> | undefined,
  value: string | undefined,
): LegendEntry | undefined {
  return value === undefined ? undefined : own(legend, value);
}

export interface Group<Row> {
  /** The group's label, or undefined for rows that name none. */
  group: string | undefined;
  rows: Row[];
}

/** Consecutive rows of one group, in order. Rows that name no group form runs of their own. */
export function groupRuns<Row extends { group?: string | undefined }>(
  rows: readonly Row[],
): Group<Row>[] {
  const runs: Group<Row>[] = [];
  for (const row of rows) {
    const last = runs.at(-1);
    if (last !== undefined && last.group === row.group) last.rows.push(row);
    else runs.push({ group: row.group, rows: [row] });
  }
  return runs;
}

/** A number written as text: an optional minus, digits, an optional fraction. Nothing else. */
export function meterNumber(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const trimmed = text.trim();
  return /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : undefined;
}

export interface Meter {
  max: number;
  warn?: number | undefined;
}

export interface MeterReading {
  value: number;
  /** The share of the bar that is filled, 0 to 1. */
  fraction: number;
  /** True when the value is past the warn threshold. */
  warn: boolean;
}

/** Why a meter cell cannot be drawn, or null when it can. */
export function meterProblem(text: string | undefined, meter: Meter): string | null {
  const value = meterNumber(text);
  if (value === undefined) return `"${text ?? ''}" is not a number, and this column is a meter`;
  if (value < 0) return `${value} is below 0, which the meter cannot draw`;
  if (value > meter.max) return `${value} is above the meter's max of ${meter.max}`;
  return null;
}

/** The bar for a cell, or undefined when the cell is not a drawable number. */
export function readMeter(text: string | undefined, meter: Meter): MeterReading | undefined {
  if (meterProblem(text, meter) !== null) return undefined;
  const value = meterNumber(text)!;
  return {
    value,
    fraction: meter.max === 0 ? 0 : value / meter.max,
    warn: meter.warn !== undefined && value > meter.warn,
  };
}
