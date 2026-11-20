import { useEffect, useState } from 'react';
import type { CardModel, CardSection, Selection } from '../core';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className="fw-copy"
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function Section({ section, selection }: { section: CardSection; selection: Selection }) {
  return (
    <section className="fw-section" data-section={section.id}>
      <div className="fw-section-head">
        <h3>{section.title}</h3>
        {section.kind === 'code' && <CopyButton text={section.text} />}
      </div>
      {section.kind === 'text' && <p>{section.text}</p>}
      {section.kind === 'code' && (
        <pre className="fw-code" data-lang={section.lang}>
          <code>{section.text}</code>
        </pre>
      )}
      {section.kind === 'fields' && (
        <dl className="fw-fields">
          {section.rows.map((row) => (
            <div key={row.key}>
              <dt>{row.key}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {section.kind === 'list' && (
        <ul className="fw-list">
          {section.items.map((item, index) => {
            const mark = item.mark === undefined ? '' : ` is-${item.mark}`;
            const body = (
              <>
                {item.mark !== undefined && <span className="fw-mark">{item.mark}</span>}
                <span>{item.label}</span>
              </>
            );
            return (
              <li key={`${item.entity ?? item.label}-${index}`} className={`fw-list-item${mark}`}>
                {item.entity === undefined ? (
                  body
                ) : (
                  <button
                    type="button"
                    className="fw-entity"
                    aria-pressed={selection.id === item.entity}
                    onClick={() =>
                      selection.select(selection.id === item.entity ? undefined : item.entity)
                    }
                  >
                    {body}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function Card({
  card,
  selection,
  selectedLabel,
}: {
  card: CardModel;
  selection: Selection;
  selectedLabel: string | undefined;
}) {
  const { position } = card;
  return (
    <aside className="fw-card" aria-label="Details of this call">
      <p className="fw-card-position">
        Step {position.step} of {position.steps} · Call {position.call} of {position.calls}
      </p>
      <p className="fw-card-step">{card.stepTitle}</p>
      <h2 className="fw-card-title">{card.title}</h2>
      {(card.from !== undefined || card.to !== undefined) && (
        <p className="fw-card-lanes">
          <span>{card.from?.title ?? '—'}</span>
          <span aria-hidden="true"> → </span>
          <span className="fw-visually-hidden"> to </span>
          <span>{card.to?.title ?? '—'}</span>
        </p>
      )}
      {card.chips.length > 0 && (
        <p className="fw-chips">
          {card.chips.map((chip, position) => (
            <span
              key={position}
              className={`fw-chip is-${chip.tone ?? 'neutral'}`}
              title={chip.title}
            >
              {chip.label}
            </span>
          ))}
        </p>
      )}
      {card.text !== undefined && <p className="fw-card-text">{card.text}</p>}
      {card.where !== undefined && <p className="fw-card-where">{card.where}</p>}
      {selection.id !== undefined && (
        <p className="fw-selected">
          <span>
            Selected: <strong>{selectedLabel ?? selection.id}</strong>
          </span>
          <button type="button" className="fw-copy" onClick={() => selection.select(undefined)}>
            Clear
          </button>
        </p>
      )}
      {card.sections.map((section) => (
        <Section key={section.id} section={section} selection={selection} />
      ))}
    </aside>
  );
}
