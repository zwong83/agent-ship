import { useState, type ReactNode } from 'react';

export function NodeSettingsSection({ number, title, description, badge, initiallyOpen = false, children }: {
  number: string; title: string; description: string; badge?: string; initiallyOpen?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return <details className="inspector-section node-settings-section" open={open}
    onToggle={event => setOpen(event.currentTarget.open)}
    onInvalidCapture={event => {
      if (open) return;
      // Reveal invalid fields before moving keyboard focus into a collapsed section.
      event.preventDefault();
      const field = event.target as HTMLElement;
      setOpen(true);
      requestAnimationFrame(() => { field.focus(); field.scrollIntoView({ block: 'center' }); });
    }}>
    <summary className="node-section-heading" aria-label={title}>
      <span aria-hidden="true">{number}</span><div><h4>{title}</h4><p>{description}</p></div>
      {badge && <small>{badge}</small>}
      <svg className="node-section-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7 5 5 5-5" /></svg>
    </summary>
    <div className="node-section-body">{children}</div>
  </details>;
}
