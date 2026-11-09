import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, errorText, queryPath, request, type RegistrationReceipt, type RegistrationVerification,
  type Session, type VerificationChannel } from './api';
import { Button, Field, formData } from './ui';
import { Brand, MissionGraphic } from './brand';

const channelLabels = { email: '邮箱', phone: '手机号' };

type Props = {
  route: 'login' | 'register';
  navigate: (path: string) => void;
  onLogin: (session: Session) => void;
};

export function Auth({ route, navigate, onLogin }: Props) {
  const [registration, setRegistration] = useState<RegistrationReceipt | null>(null);
  const [notice, setNotice] = useState('');
  return (
    <main className="auth">
      <section className="auth-intro" aria-labelledby="brand-title">
        <Brand />
        <div className="auth-story">
          <p className="eyebrow">FROM INTENT TO DELIVERY</p>
          <h1 id="brand-title">让每个需求，<br /><span>有序启航。</span></h1>
          <p>连接需求、流程与 Agent。<br />让协作有方向，让交付有迹可循。</p>
          <MissionGraphic />
        </div>
        <p className="auth-caption"><span className="signal-dot" /> 人来掌舵，Agent 协作。</p>
      </section>
      <div className="auth-form">
        {route === 'register' && registration
          ? <Verification receipt={registration}
              onCancel={() => setRegistration(null)}
              onComplete={() => {
                setRegistration(null);
                setNotice('账号已激活，可以登录。');
                navigate('/login');
              }} />
          : <Credentials key={route} registration={route === 'register'} notice={notice}
              onRegistration={setRegistration} onLogin={onLogin}
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    const { text } = formData(event);
    if (pending) return;
    setError('');
    setPending(true);
    try {
      if (registration) {
        const password = text('password');
        const confirmPassword = text('confirmPassword');
        if ([...password].length < 15 || [...password].length > 128) {
          setError('密码须为 15～128 个字符。');
          return;
        }
        if (password !== confirmPassword) {
          setError('两次输入的密码不一致。');
          return;
        }
        onRegistration(await request<RegistrationReceipt>('/register', {
          method: 'POST',
          body: { name: text('name').trim(), username: text('username').trim(), email: text('email').trim(),
            phone: text('phone').trim(), password, confirmPassword },
        }));
      } else {
        onLogin(await request<Session>('/login', {
          method: 'POST', body: { identifier: text('identifier').trim(), password: text('password') },
        }));
      }
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 && !registration
        ? '登录信息有误，或账号尚未激活。' : errorText(err));
    } finally {
      setPending(false);
    }
  }

  return <>
    <p className="eyebrow">工作台账号</p>
    <h2>{registration ? '注册账号' : '登录 AgentShip'}</h2>
    {notice && <p className="positive-note" role="status">{notice}</p>}
    <form className="grid form-stack" onSubmit={submit}>
      {registration ? <>
        <div className="cols">
          <Field label="姓名"><input name="name" required autoComplete="name" /></Field>
          <Field label="用户名"><input name="username" required pattern="[A-Za-z0-9_\-]{1,100}" maxLength={100} autoComplete="username" /></Field>
        </div>
        <Field label="邮箱"><input name="email" type="email" required autoComplete="email" /></Field>
        <Field label="手机号（含国家区号）"><input name="phone" type="tel" required autoComplete="tel" placeholder="+60…" /></Field>
      </> : <Field label="邮箱或用户名"><input name="identifier" required autoComplete="username" /></Field>}
      <Field label="密码">
        <input name="password" type="password" required autoComplete={registration ? 'new-password' : 'current-password'} />
        {registration && <small>15～128 个字符，允许空格和符号。</small>}
      </Field>
      {registration && <Field label="确认密码">
        <input name="confirmPassword" type="password" required autoComplete="new-password" />
      </Field>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="actions">
        <button className="accent" disabled={pending}>{pending ? '提交中…' : registration ? '注册并验证' : '登录'}</button>
        <Button disabled={pending} onClick={switchRoute}>{registration ? '返回登录' : '创建账号'}</Button>
      </div>
    </form>
  </>;
}

function Verification({ receipt, onCancel, onComplete }: {
  receipt: RegistrationReceipt;
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
    <p className="eyebrow">账号激活</p>
    <h2>验证联系方式</h2>
    <p className="subtle">邮箱和手机号都验证后才能登录。有效期至 {expires.toLocaleString('zh-CN')}。</p>
    {expired && <p className="inline-error" role="alert">这次注册已过期，请重新注册。</p>}
    <div className="grid">
      {receipt.requiredChannels.map(channel => verified.includes(channel)
        ? <div className="verify-row positive-note" role="status" key={channel}>{channelLabels[channel]}已验证</div>
        : <form className="panel grid" key={channel} onSubmit={event => void verify(event, channel)}>
            <Field label={channelLabels[channel] + '验证码'}>
              <input name="code" required autoComplete="one-time-code" />
            </Field>
            <button disabled={pending !== null || expired}>{pending === channel ? '验证中…' : '验证' + channelLabels[channel]}</button>
          </form>)}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {showInbox && !expired && simulated.length > 0 && <div className="gate" aria-label="本地模拟收件箱">
        <strong>本地模拟收件箱</strong>
        {simulated.map(message => <p key={message.channel}>{channelLabels[message.channel]} <code>{message.code}</code></p>)}
      </div>}
      <div className="actions">
        {simulated.length > 0 && !expired && <Button onClick={() => setShowInbox(value => !value)}>
          {showInbox ? '隐藏本地模拟验证码' : '查看本地模拟验证码'}
        </Button>}
        <Button disabled={pending !== null} onClick={onCancel}>重新填写注册资料</Button>
      </div>
    </div>
  </>;
}
