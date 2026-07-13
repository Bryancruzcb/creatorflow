import { Check, ChevronDown, Copy, Database } from 'lucide-react';
import { useState } from 'react';

export interface MetadataField {
  label: string;
  value: string | number;
  note?: string;
  mono?: boolean;
  copyValue?: string;
}

export interface MetadataSection {
  title: string;
  fields: MetadataField[];
}

export function MetadataInspector({
  kind,
  title,
  subtitle,
  sections,
  defaultOpen = true,
}: {
  kind: string;
  title: string;
  subtitle?: string;
  sections: MetadataSection[];
  defaultOpen?: boolean;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copyField(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => current === key ? null : current), 1600);
    } catch {
      setCopied(null);
    }
  }

  return (
    <details className="metadata-inspector" open={defaultOpen}>
      <summary>
        <span className="metadata-inspector-icon"><Database size={15} /></span>
        <span><small>{kind} metadata</small><strong>{title}</strong>{subtitle ? <em>{subtitle}</em> : null}</span>
        <ChevronDown size={15} />
      </summary>
      <div className="metadata-inspector-body">
        {sections.map((section) => (
          <section key={section.title}>
            <h3>{section.title}</h3>
            <dl>
              {section.fields.map((field) => {
                const key = `${section.title}:${field.label}`;
                return (
                  <div key={key}>
                    <dt>{field.label}</dt>
                    <dd className={field.mono ? 'metadata-value-mono' : undefined}>{field.value}</dd>
                    {field.note ? <small>{field.note}</small> : null}
                    {field.copyValue ? <button type="button" onClick={() => { void copyField(key, field.copyValue!); }} aria-label={`Copy ${field.label}`}>{copied === key ? <Check size={12} /> : <Copy size={12} />}{copied === key ? 'Copied' : 'Copy'}</button> : null}
                  </div>
                );
              })}
            </dl>
          </section>
        ))}
      </div>
    </details>
  );
}
