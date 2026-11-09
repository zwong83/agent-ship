import { useEffect, useState } from 'react';
import { ApiError, errorText, request } from './api';
import { Button, Choices, Field, Heading } from './ui';
import type { DeviceStatus, PairingCode } from './run-api';

const executionModes = {
  heartbeat: '仅保持连接',
  demo: '仅准备本地 Git',
  'demo-agents': '本地 Git + Agent 演示',
  github: '仅准备 GitHub 仓库',
  'codex-agents': 'GitHub + 本机 Codex',
};

export function DevicesPage({ csrf, onUnauthorized }: { csrf: string; onUnauthorized: () => void }) {
  const [devices, setDevices] = useState<DeviceStatus[] | null>(null);
  const [error, setError] = useState('');
  const [pair, setPair] = useState<PairingCode>();
  const [pending, setPending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [executionMode, setExecutionMode] = useState<keyof typeof executionModes>('heartbeat');
  useEffect(() => {
    const control = new AbortController();
    async function load() {
      try {
        const value = await request<{ items: DeviceStatus[] }>('/devices', { signal: control.signal });
        if (!control.signal.aborted) { setDevices(value.items); setError(''); }
      } catch (err) {
        if (control.signal.aborted) return;
        if (err instanceof ApiError && err.status === 401) onUnauthorized();
        else setError(errorText(err));
      }
    }
    void load();
    const timer = window.setInterval(() => { setNow(Date.now()); if (!document.hidden) void load(); }, 5000);
    return () => { control.abort(); window.clearInterval(timer); };
  }, [refresh, onUnauthorized]);

  async function pairDevice() {
    if (pending) return;
    setPending(true); setError('');
    try { setPair(await request<PairingCode>('/devices/pair', { method: 'POST', csrf })); setNow(Date.now()); }
    catch (err) {
      if (err instanceof ApiError && err.status === 401) onUnauthorized(); else setError(errorText(err));
    } finally { setPending(false); }
  }
  const expired = !!pair && Date.parse(pair.expiresAt) <= now;
  const github = executionMode === 'github' || executionMode === 'codex-agents';
  const executeAgents = executionMode === 'demo-agents' || executionMode === 'codex-agents';
  const command = 'java -jar platform/target/agentship-platform-0.1.0-SNAPSHOT.jar --worker --platform '
    + window.location.origin + ' --state-dir .agentship/' + (github ? 'local-worker-github' : 'local-worker') + ' --port 4781 --name "我的电脑"'
    + (executionMode === 'heartbeat' ? '' : ' --execute-git')
    + (executeAgents ? ' --execute-agents' : '')
    + (github ? ' --mode codex --git-provider github' : '')
    + (pair && !expired ? ' --pair-code ' + pair.code : ' --pair-code <配对码>');
  return <>
    <Heading label="YOUR EXECUTION DEVICE" title="本机设备" text="运行绑定发起时使用的电脑。电脑离线时保留运行，重新上线后恢复连接，等待执行。"
      actions={<Button onClick={() => setRefresh(n => n + 1)}>刷新设备</Button>} />
    <div className="device-layout">
      <section className="panel"><p className="eyebrow">CONNECT THIS COMPUTER</p><h2>配对当前电脑</h2>
        <p className="subtle">生成配对码后，在这台电脑的项目目录运行下面的命令。执行程序会持续连接平台。</p>
        <Button variant="accent" disabled={pending} onClick={() => void pairDevice()}>{pending ? '生成中…' : '生成配对码'}</Button>
        {pair && <div className={'pair-code ' + (expired ? 'expired' : '')} aria-live="polite"><small>{expired ? '配对码已过期，请重新生成' : '一次性配对码'}</small><strong>{pair.code}</strong><span>有效至 {new Date(pair.expiresAt).toLocaleTimeString()}</span></div>}
        <div className="device-execution-mode"><Field label="本机执行模式"><select aria-label="本机执行模式" value={executionMode} onChange={e => setExecutionMode(e.target.value as typeof executionMode)}>
          <Choices entries={executionModes} />
        </select></Field></div>
        <ol className="device-instructions"><li>在当前电脑准备项目打包生成的 Java 程序及 Java 21。</li><li>打开终端，进入项目目录，执行：</li></ol>
        <pre className="worker-command" aria-label="本机执行程序命令"><code>{command}</code></pre>
        <p className="subtle">重新启动已配对的程序时，使用同一 state-dir，并移除 --pair-code 参数。</p>
        {executionMode === 'heartbeat' && <p className="device-note">此模式提供配对和在线状态。选择本地演示可验证分支准备和节点调度。</p>}
        {executionMode === 'demo' && <p className="device-note">需要本机 Git。执行程序会在本地演示仓库准备分支。</p>}
        {executionMode === 'demo-agents' && <p className="device-note">需要本机 Git。节点角色使用演示结果运行，可验证子 Agent 顺序、协调汇总和结束节点。</p>}
        {github && <div className="device-note">
          <p>GitHub 模式会按运行计划创建公开仓库或复用已有仓库，并准备工作分支。</p>
          <p>在终端环境中配置 AGENTSHIP_GITHUB_TOKEN，凭据由本机程序读取。</p>
          {executeAgents && <p>先安装 Git 和 Codex CLI，并在本机登录 Codex。节点产物保存在发起电脑的工作区。</p>}
          <p>首次使用 GitHub 设备目录需单独配对。已配对时，停止原执行程序后使用相同目录重启。</p>
        </div>}
      </section>
      <section className="panel"><div className="row between"><h2>我的设备</h2><span className="pill">{devices?.length ?? '—'} 台</span></div>
        {devices === null ? <p role="status">正在读取设备…</p> : devices.length === 0 ? <div className="empty"><h3>还没有配对的电脑</h3><p>生成配对码并启动本机程序，设备会显示在这里。</p></div> :
          <div className="device-list">{devices.map(device => <article className="device-card" key={device.id}>
            <div className="row between"><h3>{device.name}</h3><span className={'pill ' + (device.connectivity === 'online' ? 'good' : 'attn')}>{device.connectivity === 'online' ? '在线' : '离线'}</span></div>
            <p>{device.mode === 'demo' ? '开发演示模式' : 'Codex 模式'} · {device.codexStatus === 'not_required' ? '演示模式无需 Codex' : device.codexStatus === 'available' ? '已检测到 Codex CLI' : device.codexStatus === 'unavailable' ? 'Codex 不可用' : 'Codex 状态待确认'}</p>
            {device.lastSeenAt && <small>最近连接 {new Date(device.lastSeenAt).toLocaleString()}</small>}
          </article>)}</div>}
      </section>
    </div>
    {error && <p role="alert" className="inline-error">{error}</p>}
  </>;
}
