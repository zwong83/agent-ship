import { useEffect, useRef } from 'react';
import { canOpenChat, type LiveFleetRow } from './dashboard-model';
import { createOrbitPlans, drawSphere, drawOrbitTracks, spacedFormation, alertLayout, type AlertAnchor } from './earth-geometry';
import { FleetShip } from './fleet-ship';

export function EarthFleet({ rows, selected, select, navigate, live }: {
  rows: LiveFleetRow[]; selected: string | null; select: (id: string) => void; navigate: (path: string) => void; live: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const ships = useRef(new Map<string, HTMLDivElement>());
  const alerts = useRef(new Map<string, HTMLButtonElement>());
  const alertAnchors = useRef(new Map<string, AlertAnchor>());
  const hoveredAlerts = useRef(new Set<string>());
  const focusedAlerts = useRef(new Set<string>());
  const start = useRef<number | null>(null);
  const redraw = useRef<(() => void) | null>(null);
  const tracks = useRef<{ blocked: boolean; selected: boolean; stale: boolean }[]>([]);
  tracks.current = rows.map(row => ({ blocked: Boolean(row.alertRun), selected: selected === row.requirement.id, stale: !live }));
  const formationKey = rows.map(row => row.requirement.id).join(',');
  useEffect(() => {
    if (!host.current || !canvas.current) return;
    const element = host.current, surface = canvas.current, ctx = surface.getContext('2d');
    const ids = formationKey ? formationKey.split(',') : [];
    const plans = createOrbitPlans(ids);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0, height = 0, frame = 0, previous = -Infinity, disposed = false;
    const render = (time: number) => {
      const seconds = motion.matches ? 0 : (time - (start.current ?? time)) / 1000;
      const points = spacedFormation(plans, seconds, width, height, ids.length);
      const pinned = new Map<number, AlertAnchor>();
      ids.forEach((id, index) => {
        const anchor = alertAnchors.current.get(id);
        if (anchor && (hoveredAlerts.current.has(id) || focusedAlerts.current.has(id))) pinned.set(index, anchor);
      });
      const anchors = alertLayout(points, width, height, pinned);
      if (ctx) {
        ctx.clearRect(0, 0, width, height);
        drawOrbitTracks(ctx, width, height, seconds, tracks.current, plans, false);
        drawSphere(ctx, width, height, seconds);
        drawOrbitTracks(ctx, width, height, seconds, tracks.current, plans, true);
        ctx.save(); ctx.lineWidth = 1; ctx.globalAlpha = .48; ctx.setLineDash([2, 4]);
        points.forEach((point, index) => {
          ctx.strokeStyle = tracks.current[index]?.blocked ? '#ff8ca2' : '#83e4d0';
          ctx.beginPath(); ctx.moveTo(point.x, point.y - 12); ctx.lineTo(anchors[index].x, anchors[index].y); ctx.stroke();
        });
        ctx.restore();
      }
      ids.forEach((id, index) => {
        const ship = ships.current.get(id);
        if (!ship) return;
        const position = points[index];
        const anchor = anchors[index];
        alertAnchors.current.set(id, anchor);
        const alert = alerts.current.get(id);
        if (alert) alert.style.transform = `translate(${anchor.x}px,${anchor.y}px) translate(-50%,-50%)`;
        ship.style.transform = `translate(${position.x}px,${position.y}px) translate(-50%,-50%)`;
        ship.style.zIndex = position.depth < 0 ? String(20 + Math.round(position.depth * 10)) : String(120 + Math.round(position.depth * 20));
        ship.dataset.depth = position.depth < 0 ? 'rear' : 'front';
        // Keep the mast upright and the agent face readable throughout each orbit.
        ship.style.setProperty('--vessel-bank', String(Math.sin(position.heading * Math.PI / 180) * 8) + 'deg');
        ship.style.setProperty('--vessel-scale', String(position.scale));
        ship.style.setProperty('--orbital-depth', String(.68 + (position.depth + 1) * .16));
      });
    };
    const resize = () => {
      const rect = element.getBoundingClientRect(); width = rect.width; height = rect.height;
      hoveredAlerts.current.clear();
      alertAnchors.current.forEach((anchor, id) => alertAnchors.current.set(id, { x: Math.max(28, Math.min(width - 28, anchor.x)), y: Math.max(28, Math.min(height - 28, anchor.y)) }));
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      surface.width = Math.round(width * ratio); surface.height = Math.round(height * ratio);
      ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
      render(performance.now());
    };
    const observer = new ResizeObserver(resize); observer.observe(element);
    const tick = (time: number) => {
      if (disposed) return;
      start.current ??= time;
      if (!document.hidden && !motion.matches && time - previous >= 33) { render(time); previous = time; }
      frame = requestAnimationFrame(tick);
    };
    const preferenceChanged = () => render(performance.now());
    redraw.current = preferenceChanged;
    motion.addEventListener('change', preferenceChanged);
    resize(); frame = requestAnimationFrame(tick);
    return () => { redraw.current = null; disposed = true; cancelAnimationFrame(frame); observer.disconnect(); motion.removeEventListener('change', preferenceChanged); };
  }, [formationKey]);
  useEffect(() => { redraw.current?.(); }, [rows, selected, live]);

  const fleet = rows.map(row => ({ ...row, blocked: Boolean(row.alertRun),
    label: row.alertRun ? 'Blocked' : row.runs.every(run => ['queued', 'preparing'].includes(run.state)) ? 'Preparing' : 'Running' }));
  return <div className="earth-orbit" data-fleet-size={rows.length} aria-label="Agent ships sailing along six tilted paths around a transparent sphere">
    <div className="orbital-flight-space" ref={host} style={{ bottom: rows.length > 2 ? 174 : rows.length ? 96 : 0 }}>
      <canvas className="earth-sphere" ref={canvas} aria-hidden="true" />
      <div className="earth-coordinates" aria-hidden="true"><span>SPHERE / ORBITAL NETWORK</span><span>06 ORBITAL PATHS / 360°</span></div>
      {fleet.map((row, index) => <div className={'orbital-ship ' + (row.blocked ? 'orbital-blocked' : 'orbital-running') + (!live ? ' orbital-stale' : '')} key={row.requirement.id}
        ref={element => { if (element) ships.current.set(row.requirement.id, element); else ships.current.delete(row.requirement.id); }}>
        <button type="button" className="orbital-ship-select" aria-pressed={selected === row.requirement.id} aria-label={'Focus ' + row.requirement.name + ', ' + row.label}
          title={row.requirement.name + ' · ' + row.label} onClick={() => select(row.requirement.id)}><FleetShip /><span className="ship-callsign" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span></button>
      </div>)}
      <div className="orbital-alert-layer">{fleet.map(row => {
        const alert = row.alertRun, canChat = alert && canOpenChat(alert), id = row.requirement.id;
        return <button type="button" key={id} className={'ship-alert-dot orbital-hud-alert' + (row.blocked ? ' orbital-blocked' : '') + (!live ? ' orbital-stale' : '')}
          ref={element => { if (element) alerts.current.set(id, element); else alerts.current.delete(id); }} disabled={row.blocked && !canChat}
          onPointerEnter={() => hoveredAlerts.current.add(id)} onPointerLeave={() => hoveredAlerts.current.delete(id)}
          onFocus={() => focusedAlerts.current.add(id)} onBlur={() => focusedAlerts.current.delete(id)}
          aria-label={row.blocked ? (canChat ? 'Open blocked chat for ' : 'Chat unavailable for blocked requirement ') + row.requirement.name : 'Running requirement: ' + row.requirement.name}
          title={row.blocked ? (canChat ? 'Blocked — open agent chat' : 'Blocked — chat access is unavailable') : 'Requirement in progress — select to focus'}
          onClick={() => { if (alert && canChat) navigate('/runs/' + alert.id + '/chat'); else select(id); }}><i aria-hidden="true" />{row.blocked && <span className="alert-glyph" aria-hidden="true">!</span>}</button>;
      })}</div>
    </div>
    {fleet.length > 0 && <div className="orbital-roster" aria-label="Fleet names and status">{fleet.map((row, index) =>
      <div key={row.requirement.id} className={'orbital-roster-card' + (row.blocked ? ' is-blocked' : '')} data-selected={selected === row.requirement.id}>
        <button type="button" className="orbital-roster-select" aria-pressed={selected === row.requirement.id} aria-label={'Focus requirement ' + row.requirement.name}
          onClick={() => select(row.requirement.id)} title={row.requirement.name}>
          <span className="roster-callsign">{String(index + 1).padStart(2, '0')}</span>
          <span className="roster-copy"><span className="orbital-name">{row.requirement.name}</span><span className="orbital-status">{live ? row.label : 'Last known: ' + row.label}</span></span>
        </button>
        {row.alertRun && canOpenChat(row.alertRun) && <button type="button" className="roster-alert" aria-label={'Open blocked chat from card for ' + row.requirement.name}
          title="Open blocked agent chat" onClick={() => navigate('/runs/' + row.alertRun.id + '/chat')}><span aria-hidden="true">!</span></button>}
      </div>)}</div>}
  </div>;
}
