import { useId, useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id'> & { label: string };

export function PasswordField({ label, disabled, ...inputProps }: Props) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const revealed = visible && !disabled;

  return <div className="password-field">
    <label htmlFor={id}>{label}</label>
    <div className="password-input-shell">
      <input {...inputProps} id={id} type={revealed ? 'text' : 'password'} disabled={disabled} />
      <button type="button" className="password-visibility" disabled={disabled}
        aria-label={`${revealed ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
        aria-pressed={revealed} aria-controls={id} onClick={() => setVisible(current => !current)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {revealed && <path d="m4 4 16 16" />}
        </svg>
      </button>
    </div>
  </div>;
}
