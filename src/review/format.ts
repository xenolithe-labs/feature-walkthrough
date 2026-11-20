import type { CheckResult, Stats, TraceCall, WalkthroughReview } from './schema';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function didText(did: TraceCall['panes'][number]['did']): string {
  const parts = (
    [
      ['added', did.added],
      ['updated', did.updated],
      ['read', did.read],
      ['removed', did.removed],
    ] as const
  )
    .filter(([, ids]) => ids.length > 0)
    .map(([verb, ids]) => `${verb} ${ids.join(', ')}`);
  return parts.length === 0 ? 'untouched' : parts.join('; ');
}

function statsText(stats: Stats): string[] {
  return [
    `${plural(stats.steps, 'step')} (${stats.callsPerStep.min} to ${stats.callsPerStep.max} calls each), ${plural(stats.calls, 'call')}, ${plural(stats.panes, 'pane')}, ${plural(stats.elements, 'element')}`,
    `words per call: mean ${stats.words.mean}, median ${stats.words.median}, longest ${stats.words.longest.words}${stats.words.longest.call === null ? '' : ` (${stats.words.longest.call})`}; ${stats.words.overCeiling} over the ceiling, ${stats.words.withoutText} without text`,
    `touched per call: mean ${stats.touchedPerCall.mean}, most ${stats.touchedPerCall.max}; ${stats.touchedPerCall.zero} touch nothing`,
    ...stats.perPane.map(
      (pane) =>
        `pane ${pane.pane} (${pane.panel}${pane.role === 'focus' ? ', focus' : ''}): ${plural(pane.elements, 'element')}, touched by ${plural(pane.callsTouching, 'call')}, changed by ${pane.callsChanging}`,
    ),
  ];
}

function traceText(trace: TraceCall): string[] {
  const { step, call } = trace;
  const lane =
    call.from !== undefined && call.to !== undefined ? ` · ${call.from} -> ${call.to}` : '';
  const lines = [
    `step ${step.index} "${step.title}" · call ${call.index} "${call.label}" [${call.key}]${lane}`,
  ];
  if (step.text !== undefined) lines.push(`  step text: ${step.text}`);
  lines.push(
    call.text === undefined ? '  text: (none)' : `  text (${call.words} words): ${call.text}`,
  );
  if (call.where !== undefined) lines.push(`  where: ${call.where}`);
  const reasons = Object.entries(trace.stage.reasons)
    .map(([id, why]) => `${id}: ${why}`)
    .join(', ');
  lines.push(
    `  focus view, stage of ${trace.stage.capacity}: ${trace.stage.panes.join(', ') || '(none)'}${trace.stage.primary === undefined ? '' : ` (largest: ${trace.stage.primary})`}${reasons === '' ? '' : ` [${reasons}]`}`,
  );
  for (const pane of trace.panes) {
    lines.push(`  pane ${pane.id} "${pane.title}" (${pane.panel}): ${didText(pane.did)}`);
    for (const line of pane.lines) lines.push(`    ${line}`);
  }
  if (trace.hidden.length > 0) lines.push(`  not shown: ${trace.hidden.join(', ')}`);
  return lines;
}

function walkthroughText(file: string, review: WalkthroughReview): string[] {
  const name = review.id ?? `#${review.index}`;
  const lines = [
    `${file}: walkthrough ${name}${review.title === null ? '' : ` "${review.title}"`}`,
  ];
  if (review.status === 'not-checked') {
    lines.push('  not checked: it has config errors, so design findings and the trace are skipped');
  }
  for (const problem of review.problems ?? []) {
    lines.push(`  ${problem.severity} ${problem.rule} at ${problem.at}: ${problem.message}`);
  }
  const seen = new Set<string>();
  for (const finding of review.findings ?? []) {
    lines.push(
      `  ${finding.severity} ${finding.rule} at ${finding.at}: ${finding.message}${
        seen.has(finding.rule) ? '' : `\n      from: ${finding.source}`
      }`,
    );
    seen.add(finding.rule);
  }
  if (review.stats !== undefined) {
    lines.push('  stats:');
    for (const line of statsText(review.stats)) lines.push(`    ${line}`);
  }
  if (review.trace !== undefined) {
    lines.push('  trace (`>x<` and `x*` mark what the call touched):');
    for (const trace of review.trace) {
      for (const line of traceText(trace)) lines.push(`    ${line}`);
      lines.push('');
    }
  }
  return lines;
}

/** The text `check` prints without --json. */
export function formatCheckText(result: CheckResult): string {
  const out: string[] = [];
  for (const file of result.files) {
    if (file.readError !== undefined) out.push(`${file.file}: cannot read: ${file.readError}`);
    for (const problem of file.problems) {
      out.push(
        `${file.file}: ${problem.severity} ${problem.rule} at ${problem.at}: ${problem.message}`,
      );
    }
    for (const walkthrough of file.walkthroughs) {
      out.push(...walkthroughText(file.file, walkthrough));
    }
  }
  const { summary } = result;
  out.push(
    `${plural(summary.files, 'file')}, ${plural(summary.walkthroughs, 'walkthrough')}: ${plural(summary.errors, 'error')}, ${plural(summary.warnings, 'warning')}, ${plural(summary.infos, 'info')}${
      summary.reason === '' ? '' : `. Exit 1: ${summary.reason}`
    }`,
  );
  return out.join('\n');
}
