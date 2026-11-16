/** Decorative spatial model; real execution state remains in the workspace. */
export function MissionScene() {
  return <div className="mission-scene" aria-hidden="true">
    <div className="scene-caption">AGENTSHIP / ORCHESTRATION ENGINE</div>
    <div className="scene-viewport">
      <div className="scene-shadow" />
      <div className="scene-stack">
        <div className="scene-deck scene-deck-base"><span className="deck-mark">AGENTSHIP</span></div>
        <div className="scene-deck scene-deck-middle"><i /><i /><i /><i /></div>
        <div className="scene-deck scene-deck-top">
          <svg viewBox="0 0 300 240" fill="none"><path className="scene-track" d="M55 120H130M150 120V55H245M150 120H245M150 120V185H245" /><path className="scene-signal" d="M55 120H130M150 120V55H245M150 120H245M150 120V185H245" /></svg>
          {['source', 'alpha', 'beta', 'gamma'].map(node => <span key={node} className={'scene-node scene-node-' + node}><i /></span>)}
          <div className="scene-core"><span className="core-top">A<span>S</span></span><span className="core-front" /><span className="core-side" /></div>
        </div>
        <div className="scene-orbit" />
      </div>
    </div>
    <div className="scene-legend"><span>01 / DEFINE</span><span>02 / CONNECT</span><span>03 / SHIP</span></div>
  </div>;
}
