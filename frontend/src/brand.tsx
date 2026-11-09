import type { ObjectKind } from './api';

export function Brand() {
  return <div className="brand">
    <img src="/agentship-mark.svg" width="42" height="42" alt="" />
    <span>Agent<span className="brand-accent">Ship</span><small>AI DELIVERY WORKSPACE</small></span>
  </div>;
}

export function ConfigIcon({ kind }: { kind: ObjectKind }) {
  return <svg className="config-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'requirements' && <><path d="M7 3h7l4 4v14H5V5a2 2 0 0 1 2-2Z" /><path d="M14 3v5h4M8 12h7M8 16h5" /></>}
    {kind === 'flows' && <><rect x="8" y="2" width="8" height="5" rx="1" /><rect x="2" y="17" width="7" height="5" rx="1" /><rect x="15" y="17" width="7" height="5" rx="1" /><path d="M12 7v5M5.5 17v-5h13v5" /></>}
    {kind === 'agents' && <><rect x="4" y="7" width="16" height="13" rx="4" /><path d="M12 3v4M1 12v4M23 12v4M9 16h6" /><circle cx="8" cy="12" r=".7" /><circle cx="16" cy="12" r=".7" /></>}
  </svg>;
}

export function MissionGraphic() {
  return <div className="mission-graphic" aria-hidden="true">
    <div className="orbit orbit-outer" /><div className="orbit orbit-inner" />
    <div className="mission-axis" />
    <div className="mission-core"><img src="/agentship-mark.svg" width="88" height="88" alt="" /></div>
    <div className="satellite satellite-one"><ConfigIcon kind="requirements" /><span>REQUIREMENT</span></div>
    <div className="satellite satellite-two"><ConfigIcon kind="flows" /><span>WORKFLOW</span></div>
    <div className="satellite satellite-three"><ConfigIcon kind="agents" /><span>AGENT</span></div>
    <span className="orbit-point point-one" /><span className="orbit-point point-two" />
  </div>;
}
