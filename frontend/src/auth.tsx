import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, errorText, queryPath, request, type RegistrationReceipt, type RegistrationVerification,
  type Session, type VerificationChannel, type VerificationReceipt } from './api';
import { Button, Field, formData } from './ui';
import { Brand } from './brand';
import { MissionScene } from './mission-scene';
import { internationalPhone, type PhoneCountry } from './phone-number';
import { PhoneCountryPicker } from './phone-country-picker';
import { PasswordField } from './password-field';

const channelLabels = { email: 'Email', phone: 'Phone number' };

type AuthMessage = { text: string; tone: 'error' | 'success' };
function AuthMessageToast({ message }: { message: AuthMessage }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 5000);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;
  return <div className="auth-message-stack">
    <div className={'auth-message ' + message.tone}>
      <span className="auth-message-icon" aria-hidden="true">{message.tone === 'error' ? '!' : '✓'}</span>
      <p className="auth-message-text">{message.text}</p>
      <button type="button" className="auth-message-close" aria-label="Dismiss notification" onClick={() => setVisible(false)}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <path d="m5 5 10 10M15 5 5 15" />
        </svg>
      </button>
    </div>
  </div>;
}

function AuthMessages({ messages }: { messages: AuthMessage[] }) {
  return createPortal(<div className="auth-messages" role="status" aria-live="polite" aria-atomic="true">
    {messages.map(message => <AuthMessageToast key={message.tone + ':' + message.text} message={message} />)}
  </div>, document.body);
}

function passwordChecks(password: string) {
  return [
    { label: 'At least 8 characters', met: [...password].length >= 8 },
    { label: 'At least one lowercase letter', met: /[a-z]/.test(password) },
    { label: 'At least one uppercase letter', met: /[A-Z]/.test(password) },
    { label: 'At least one number', met: /[0-9]/.test(password) },
    { label: 'At least one symbol (such as !, @ or #)', met: /[\p{P}\p{S}]/u.test(password) },
  ];
}

function validRegistrationPassword(password: string) {
  return passwordChecks(password).every(check => check.met) && [...password].length <= 128 && !password.includes('\0');
}

type Props = {
  route: 'login' | 'register';
  navigate: (path: string) => void;
  onLogin: (session: Session) => void;
};

export function Auth({ route, navigate, onLogin }: Props) {
  const [registration, setRegistration] = useState<VerificationReceipt | null>(null);
  const [notice, setNotice] = useState('');
  return (
    <main className="auth futuristic-shell" data-motion="enabled">
      <div className="ambient-field" aria-hidden="true"><i /><i /><span /></div>
      <section className="auth-intro" aria-labelledby="brand-title">
        <div className="auth-brandbar"><Brand /></div>
        <div className="auth-story">
          <p className="eyebrow auth-kicker"><span /> MULTI-AGENT COMMAND CENTER</p>
          <h1 id="brand-title">Intelligence in motion.<br /><span>Execution in sync.</span></h1>
          <p>Specialized agents. Connected workflows.<br />Command every stage, from requirements to delivery.</p>
          <MissionScene />
        </div>
        <p className="auth-caption"><span className="signal-dot" /> LOCAL EXECUTION <span className="caption-divider">/</span> CONNECTED INTELLIGENCE</p>
      </section>
      <div className="auth-form">
        {route === 'register' && registration
          ? <Verification receipt={registration}
              onCancel={() => setRegistration(null)}
              onComplete={() => {
                setRegistration(null);
                setNotice('Your account is active. You can now sign in.');
                navigate('/login');
              }} />
          : <Credentials key={route} registration={route === 'register'} notice={notice}
              onRegistration={receipt => {
                if (receipt.status === 'active') {
                  setNotice('Account created. You can now sign in with your username.');
                  navigate('/login');
                } else setRegistration(receipt);
              }} onLogin={onLogin}
              switchRoute={() => { setRegistration(null); setNotice(''); navigate(route === 'register' ? '/login' : '/register'); }} />}
      </div>
    </main>
  );
}

function Credentials({ registration, notice, onRegistration, onLogin, switchRoute }: {
  registration: boolean;
  notice: string;
  onRegistration: (receipt: RegistrationReceipt) => void;
  onLogin: (session: Session) => void;
  switchRoute: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [passwordValue, setPasswordValue] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [phoneCountry, setPhoneCountry] = useState<PhoneCountry>('MY');
  const [details, setDetails] = useState({ name: '', username: '', email: '', phone: '' });
  const [emailNativeValid, setEmailNativeValid] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<keyof typeof details, boolean>>>({});
  const phoneInput = useRef<HTMLInputElement>(null);
  const checks = passwordChecks(passwordValue);
  const passwordReady = validRegistrationPassword(passwordValue);
  const mismatched = registration && confirmation.length > 0 && passwordValue !== confirmation;
  const phone = internationalPhone(details.phone, phoneCountry);
  const fieldErrors = {
    name: !details.name.trim() || [...details.name].length > 100 || details.name.includes('\0') ? 'Enter your name (up to 100 characters).' : '',
    username: !/^[A-Za-z0-9_-]{1,100}$/.test(details.username) ? 'Use 1–100 letters, numbers, underscores, or hyphens for your username.' : '',
    email: details.email.trim() && (!emailNativeValid || details.email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(details.email.trim())) ? 'Enter a valid email address or leave it blank.' : '',
    phone: details.phone.trim() && !phone ? 'Enter a valid phone number for the selected country, without an extension.' : '',
  };
  const registrationReady = passwordReady && confirmation === passwordValue && !Object.values(fieldErrors).some(Boolean);
  const messages: AuthMessage[] = [];
  if (error) messages.push({ text: error, tone: 'error' });
  if (mismatched) messages.push({ text: 'Passwords do not match.', tone: 'error' });
  if (registration) for (const key of Object.keys(fieldErrors) as (keyof typeof details)[]) {
    if (touched[key] && fieldErrors[key]) messages.push({ text: fieldErrors[key], tone: 'error' });
  }
  if (!messages.length) {
    if (notice) messages.push({ text: notice, tone: 'success' });
    else if (registrationReady) messages.push({ text: 'All fields are valid. You’re ready to register.', tone: 'success' });
    else if (registration && confirmation && passwordReady) messages.push({ text: 'Passwords match.', tone: 'success' });
    else if (registration && passwordReady) messages.push({ text: 'All password requirements met. Confirm your password below.', tone: 'success' });
  }
  function updateDetail(key: keyof typeof details, value: string) {
    setDetails(current => ({ ...current, [key]: value }));
    setError('');
  }
  function touch(key: keyof typeof details) { setTouched(current => ({ ...current, [key]: true })); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    const { text } = formData(event);
    if (pending) return;
    if (registration && !registrationReady) {
      setTouched({ name: true, username: true, email: true, phone: true });
      return;
    }
    if (!registration && (!text('identifier').trim() || !text('password'))) {
      setError('Enter your email or username and password.');
      return;
    }
    setError('');
    setPending(true);
    try {
      if (registration) {
        const password = text('password');
        const confirmPassword = text('confirmPassword');
        if (!validRegistrationPassword(password)) {
          setError('Use 8–128 characters with a lowercase letter, uppercase letter, number, and symbol.');
          return;
        }
        if (password !== confirmPassword) {
          setError('Passwords do not match.');
          return;
        }
        const phone = internationalPhone(text('phone'), phoneCountry);
        if (text('phone').trim() && !phone) {
          setError('Enter a valid phone number for the selected country, without an extension.');
          phoneInput.current?.focus();
          return;
        }
        onRegistration(await request<RegistrationReceipt>('/register', {
          method: 'POST',
          body: { name: text('name').trim(), username: text('username').trim(), email: text('email').trim() || null,
            phone, password, confirmPassword },
        }));
      } else {
        onLogin(await request<Session>('/login', {
          method: 'POST', body: { identifier: text('identifier').trim(), password: text('password') },
        }));
      }
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 && !registration
        ? 'The login information is incorrect, or the account has not been activated.' : errorText(err));
    } finally {
      setPending(false);
    }
  }

  return <>
    <p className="eyebrow">Workspace account</p>
    <h2>{registration ? 'Create an account' : 'Sign in to AgentShip'}</h2>
    <AuthMessages messages={messages} />
    <form className="grid form-stack" noValidate onSubmit={submit}>
      {registration ? <>
        <div className="cols">
          <Field label="Name"><input name="name" required maxLength={100} autoComplete="name" value={details.name}
            aria-invalid={!!(touched.name && fieldErrors.name)} onBlur={() => touch('name')} onChange={event => updateDetail('name', event.target.value)} /></Field>
          <Field label="Username"><input name="username" required pattern="[A-Za-z0-9_\-]{1,100}" maxLength={100} autoComplete="username" value={details.username}
            aria-invalid={!!(touched.username && fieldErrors.username)} onBlur={() => touch('username')} onChange={event => updateDetail('username', event.target.value)} /></Field>
        </div>
        <Field label="Email (optional)"><input name="email" type="email" maxLength={254} autoComplete="email" value={details.email}
          aria-invalid={!!(touched.email && fieldErrors.email)} onBlur={() => touch('email')} onChange={event => {
            setEmailNativeValid(event.target.validity.valid);
            updateDetail('email', event.target.value);
          }} /></Field>
        <div className="phone-field">
          <div className="phone-input-row">
            <PhoneCountryPicker value={phoneCountry} onChange={country => { setPhoneCountry(country); setError(''); }} />
            <Field label="Phone number (optional)">
              <input ref={phoneInput} name="phone" type="tel" inputMode="tel" autoComplete="tel-national"
                aria-describedby="phone-help" aria-invalid={!!(touched.phone && fieldErrors.phone)} value={details.phone}
                onBlur={() => touch('phone')} onChange={event => updateDetail('phone', event.target.value)} />
            </Field>
          </div>
          <small id="phone-help">Choose your country, then enter your local phone number.</small>
        </div>
      </> : <Field label="Email or username"><input name="identifier" required autoComplete="username" onChange={() => setError('')} /></Field>}
      <PasswordField label="Password" name="password" required autoComplete={registration ? 'new-password' : 'current-password'}
          aria-describedby={registration ? 'password-requirements password-limit' : undefined}
          value={passwordValue} onChange={event => {
            setPasswordValue(event.target.value);
            setError('');
            if (registration) setConfirmation('');
          }} />
      {registration && <div className="password-guidance">
        <ul id="password-requirements" className="password-checklist" aria-label="Password requirements">
          {checks.map(check => <li key={check.label} className={check.met ? 'met' : ''}>
            <span aria-hidden="true">{check.met ? '✓' : '○'}</span>
            <span className="sr-only">{check.met ? 'Met: ' : 'Not met: '}</span>{check.label}
          </li>)}
        </ul>
        <small id="password-limit">Maximum 128 characters. Spaces do not count as symbols.</small>
      </div>}
      {registration && <PasswordField label="Confirm password" name="confirmPassword" required autoComplete="new-password" disabled={!passwordReady}
          aria-invalid={mismatched} value={confirmation} onChange={event => { setConfirmation(event.target.value); setError(''); }} />}
      <div className="actions">
        <button className="accent" disabled={pending || (registration && !registrationReady)}>{pending ? 'Submitting…' : registration ? 'Create account' : 'Sign in'}</button>
        <Button disabled={pending} onClick={switchRoute}>{registration ? 'Back to sign in' : 'Create account'}</Button>
      </div>
    </form>
  </>;
}

function Verification({ receipt, onCancel, onComplete }: {
  receipt: VerificationReceipt;
  onCancel: () => void;
  onComplete: () => void;
}) {
  const [verified, setVerified] = useState<VerificationChannel[]>([]);
  const [pending, setPending] = useState<VerificationChannel | null>(null);
  const [error, setError] = useState('');
  const [simulated, setSimulated] = useState<{ channel: VerificationChannel; code: string }[]>([]);
  const [showInbox, setShowInbox] = useState(false);
  const expires = new Date(receipt.expiresAt);
  const expired = expires.getTime() <= Date.now();

  useEffect(() => {
    const control = new AbortController();
    request<{ messages: { channel: VerificationChannel; code: string }[] }>(
      queryPath('/dev/registration-messages', { registrationRef: receipt.registrationRef }), { signal: control.signal })
      .then(response => { if (!control.signal.aborted) setSimulated(response.messages); })
      .catch(() => { /* A non-development server has no local inbox. */ });
    return () => control.abort();
  }, [receipt.registrationRef]);

  async function verify(event: FormEvent<HTMLFormElement>, channel: VerificationChannel) {
    const { text } = formData(event);
    if (pending || expired) return;
    if (!text('code').trim()) { setError('Enter the ' + channelLabels[channel].toLowerCase() + ' verification code.'); return; }
    setPending(channel);
    setError('');
    try {
      const response = await request<RegistrationVerification>('/register/verify', {
        method: 'POST', body: { channel, code: text('code').trim(), registrationRef: receipt.registrationRef },
      });
      setVerified(response.verifiedChannels);
      setSimulated(current => current.filter(message => !response.verifiedChannels.includes(message.channel)));
      if (response.status === 'active') onComplete();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(null);
    }
  }

  return <>
    <p className="eyebrow">Account activation</p>
    <h2>Verify contact information</h2>
    <p className="subtle">You can log in only after your email and mobile phone number have been verified. Valid until {expires.toLocaleString('en-US')}.</p>
    <AuthMessages messages={expired ? [{ text: 'This registration has expired. Please register again.', tone: 'error' }]
      : error ? [{ text: error, tone: 'error' }]
      : verified.length ? [{ text: verified.map(channel => channelLabels[channel]).join(' and ') + ' verified.', tone: 'success' }] : []} />
    <div className="grid">
      {receipt.requiredChannels.map(channel => verified.includes(channel)
        ? <div className="verify-row positive-note" key={channel}>{channelLabels[channel]} verified</div>
        : <form className="panel grid" noValidate key={channel} onSubmit={event => void verify(event, channel)}>
            <Field label={channelLabels[channel] + ' verification code'}>
              <input name="code" required autoComplete="one-time-code" onChange={() => setError('')} />
            </Field>
            <button disabled={pending !== null || expired}>{pending === channel ? 'Verifying…' : 'Verify ' + channelLabels[channel]}</button>
          </form>)}
      {showInbox && !expired && simulated.length > 0 && <div className="gate" aria-label="Local simulated inbox">
        <strong>Local simulated inbox</strong>
        {simulated.map(message => <p key={message.channel}>{channelLabels[message.channel]} <code>{message.code}</code></p>)}
      </div>}
      <div className="actions">
        {simulated.length > 0 && !expired && <Button onClick={() => setShowInbox(value => !value)}>
          {showInbox ? 'Hide local verification codes' : 'View local verification codes'}
        </Button>}
        <Button disabled={pending !== null} onClick={onCancel}>Start registration again</Button>
      </div>
    </div>
  </>;
}
