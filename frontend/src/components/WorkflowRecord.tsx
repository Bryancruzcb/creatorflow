import { Check } from 'lucide-react';
import { useMemo, useState } from 'react';
import { buildWorkflowRecord, fieldsThrough } from '../workflowRecord';

/**
 * "How it works", shown rather than listed.
 *
 * The four steps are unchanged — they were already the right four. What changed is that each one
 * now reveals the part of a real release manifest it produces, for one real file, so a visitor
 * reaches the end of the section having watched a record get built instead of having read that
 * records get built.
 *
 * The panel is the output of `buildReleaseManifest`, the same call the sample workspace's export
 * button makes. The final step shows the document itself.
 */
export function WorkflowRecord() {
  const record = useMemo(() => buildWorkflowRecord(), []);
  const [active, setActive] = useState(0);
  const isLast = active === record.stages.length - 1;

  /**
   * The last step shows the document instead of the running list.
   *
   * Every field steps one to three added is already in the JSON, so carrying all fourteen rows
   * above it made the panel twice as tall as any other step and shoved the rest of the page down
   * by about 700px on a click. Exporting the manifest is the moment the record stops being a list
   * of fields and becomes a file, which is what the panel now shows.
   */
  const fields = isLast ? record.stages[record.stages.length - 1].fields : fieldsThrough(record, active);

  return (
    <div className="workflow-record">
      <ol className="workflow-steps">
        {record.stages.map((stage, index) => (
          <li key={stage.title}>
            <button
              type="button"
              className="workflow-step"
              aria-current={index === active ? 'step' : undefined}
              data-state={index < active ? 'done' : index === active ? 'active' : 'ahead'}
              onClick={() => setActive(index)}
            >
              <span className="workflow-step-index" aria-hidden="true">
                {index < active ? <Check size={13} strokeWidth={2.4} /> : String(index + 1).padStart(2, '0')}
              </span>
              <span className="workflow-step-copy">
                <strong>{stage.title}</strong>
                <small>{stage.body}</small>
              </span>
              <span className="workflow-step-produces">{stage.produces}</span>
            </button>
          </li>
        ))}
      </ol>

      <figure className="workflow-panel">
        <figcaption className="workflow-panel-head">
          <p className="workflow-panel-kicker">Release manifest entry</p>
          <p className="workflow-panel-file">{record.fileName}</p>
        </figcaption>

        {/*
          One live region for the whole panel. Each step adds rows rather than replacing them, so
          announcing the panel as a unit matches what a sighted visitor sees: a record growing.
        */}
        <div className="workflow-panel-body" aria-live="polite">
          <dl className="workflow-fields">
            {fields.map((field) => (
              <div key={field.label} data-block={field.block ? 'true' : undefined}>
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>

          {active === 1 && record.topMatch && (
            <p className="workflow-match">
              <strong>{record.topMatch.similarity}%</strong>
              {' '}similar to {record.topMatch.title}
              <small>{record.topMatch.provider}</small>
            </p>
          )}

          {isLast && (
            <pre className="workflow-json" tabIndex={0} aria-label="The exported manifest, as JSON">
              <code>{record.json}</code>
            </pre>
          )}
        </div>
      </figure>
    </div>
  );
}

export default WorkflowRecord;
