export const TAU = Math.PI * 2;

export function sphereRadius(width: number, height: number) {
  return Math.max(40, Math.min(width / 2 - 26, height / 2 - 26));
}

export type OrbitPlan = { tilt: number; flatten: number; phase: number; period: number; direction: number; radius: number };
export const ORBIT_COUNT = 6;
const planes = [
  { tilt: -68, flatten: .36 }, { tilt: -38, flatten: .62 },
  { tilt: -8, flatten: .28 }, { tilt: 24, flatten: .51 },
  { tilt: 54, flatten: .69 }, { tilt: 84, flatten: .43 },
];

// Phases maximize the closest projected approach across a complete shared cycle.
// Changing individual periods would eventually destroy this clearance.
const separatedPhases = [0, 4.21726268, .89916762, 4.82630687, 1.77015405, 5.65318790];
export function createOrbitPlans(ids: string[]): OrbitPlan[] {
  const slots = ids.length <= 2 ? [0, 4, 1, 2, 3, 5] : ids.length <= 4 ? [0, 1, 2, 5, 3, 4] : [0, 1, 2, 3, 4, 5];
  return slots.map(slot => ({ tilt: planes[slot].tilt * Math.PI / 180, flatten: planes[slot].flatten,
    phase: separatedPhases[slot], period: 84, direction: 1, radius: 1 }));
}

export function orbitRadius(width: number, height: number) {
  return Math.max(30, Math.min(width / 2 - 46, height / 2 - 46)) / 1.04;
}

/** Perspective projection of a true circular path in a tilted 3D plane. */
export function orbitPoint(plan: OrbitPlan, angle: number, width: number, height: number) {
  const radius = orbitRadius(width, height) * plan.radius;
  const a = Math.cos(angle), b = Math.sin(angle), c = Math.cos(plan.tilt), s = Math.sin(plan.tilt);
  const zAxis = Math.sqrt(1 - plan.flatten * plan.flatten);
  const x = a * c - b * plan.flatten * s, y = a * s + b * plan.flatten * c, depth = b * zAxis;
  const perspective = 4.5 / (4.5 - depth);
  const dz = a * zAxis;
  const dx = ((-b * c - a * plan.flatten * s) + x * dz / (4.5 - depth)) * plan.direction;
  const dy = ((-b * s + a * plan.flatten * c) + y * dz / (4.5 - depth)) * plan.direction;
  return { x: width / 2 + radius * perspective * x,
    y: height / 2 + radius * perspective * y, depth, angle, radius, unit: [x, y, depth],
    heading: Math.atan2(dy, dx) * 180 / Math.PI, scale: .9 + depth * .23 };
}

export function formationPosition(plan: OrbitPlan, seconds: number, width: number, height: number) {
  return orbitPoint(plan, plan.phase + plan.direction * seconds * TAU / plan.period, width, height);
}

/** Screen-space clearance caps hull size at close projected crossings. */
export function spacedFormation(plans: OrbitPlan[], seconds: number, width: number, height: number, count: number) {
  const points = plans.slice(0, count).map(plan => formationPosition(plan, seconds, width, height));
  const hullDiagonal = Math.hypot(76, 76);
  return points.map((point, index) => {
    const nearest = Math.min(...points.filter((_, other) => other !== index).map(other => Math.hypot(point.x - other.x, point.y - other.y)));
    return { ...point, scale: Math.min(point.scale, nearest * .88 / hullDiagonal) };
  });
}

export type AlertAnchor = { x: number; y: number };
/** Alerts are an independent HUD layer. Pinned hover/focus targets never move. */
export function alertLayout(points: AlertAnchor[], width: number, height: number, pinned: Map<number, AlertAnchor> = new Map()) {
  const clamp = (point: AlertAnchor) => ({ x: Math.max(28, Math.min(width - 28, point.x)), y: Math.max(28, Math.min(height - 28, point.y)) });
  const anchors = points.map((point, index) => pinned.has(index) ? { ...pinned.get(index)! } : clamp({ x: point.x, y: point.y - 50 }));
  for (let pass = 0; pass < 32; pass++) {
    for (let i = 0; i < anchors.length; i++) for (let j = i + 1; j < anchors.length; j++) {
      const a = anchors[i], b = anchors[j], dx = b.x - a.x, dy = b.y - a.y;
      const distance = Math.hypot(dx, dy);
      if (distance >= 80 || (pinned.has(i) && pinned.has(j))) continue;
      const nx = distance > .01 ? dx / distance : 1, ny = distance > .01 ? dy / distance : 0;
      const shift = 80 - distance;
      if (!pinned.has(i)) anchors[i] = clamp({ x: a.x - nx * shift * (pinned.has(j) ? 1 : .5), y: a.y - ny * shift * (pinned.has(j) ? 1 : .5) });
      if (!pinned.has(j)) anchors[j] = clamp({ x: b.x + nx * shift * (pinned.has(i) ? 1 : .5), y: b.y + ny * shift * (pinned.has(i) ? 1 : .5) });
    }
  }
  return anchors;
}

export type OrbitTrack = { blocked: boolean; selected: boolean; stale: boolean };
/** Keep persistent 128×24 nameplates readable without changing any ship's route. */
export function fleetLabelLayout(points: AlertAnchor[], alerts: AlertAnchor[], width: number, height: number) {
  const labels: AlertAnchor[] = [];
  const clampY = (y: number) => Math.max(16, Math.min(height - 16, y));
  for (const point of points) {
    const x = Math.max(68, Math.min(width - 68, point.x));
    const preferred = clampY(point.y + 44);
    const candidates: AlertAnchor[] = [{ x, y: preferred }];
    for (let step = 1; step <= Math.ceil(height / 28); step++) {
      candidates.push({ x, y: clampY(preferred + step * 28) }, { x, y: clampY(preferred - step * 28) });
    }
    const available = candidates.filter(candidate => labels.every(label =>
      Math.abs(candidate.x - label.x) >= 132 || Math.abs(candidate.y - label.y) >= 28));
    const cost = (candidate: AlertAnchor) => Math.abs(candidate.y - preferred)
      + alerts.filter(alert => Math.abs(candidate.x - alert.x) < 94 && Math.abs(candidate.y - alert.y) < 40).length * 32
      + points.filter(ship => ship !== point && Math.abs(candidate.x - ship.x) < 96 && Math.abs(candidate.y - ship.y) < 38).length * 12;
    const nearest = available.reduce<AlertAnchor | undefined>((best, candidate) => !best || cost(candidate) < cost(best) ? candidate : best, undefined);
    labels.push(nearest ?? { x, y: preferred });
  }
  return labels;
}

/** The visible line, moving light trail and ship use exactly the same route. */
export function drawOrbitTracks(ctx: CanvasRenderingContext2D, width: number, height: number, seconds: number, tracks: OrbitTrack[], plans: OrbitPlan[], front: boolean) {
  plans.forEach((plan, index) => {
    const track = tracks[index];
    const color = !track ? '#87bbde' : track.stale ? '#90a3b6' : track.blocked ? '#ff748a' : track.selected ? '#dbffff' : '#59edff';
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = track?.selected ? 1.8 : 1;
    ctx.globalAlpha = track ? (front ? .9 : .32) : (front ? .4 : .15);
    ctx.beginPath(); let connected = false;
    for (let step = 0; step <= 180; step++) {
      const point = orbitPoint(plan, TAU * step / 180, width, height);
      if ((point.depth >= 0) !== front) { connected = false; continue; }
      if (connected) ctx.lineTo(point.x, point.y); else ctx.moveTo(point.x, point.y);
      connected = true;
    }
    ctx.stroke();
    if (!track) { ctx.restore(); return; }
    const head = formationPosition(plan, seconds, width, height).angle;
    ctx.shadowColor = color; ctx.shadowBlur = front ? 24 : 14;
    // Two spreading ripples and a luminous centerline form the fading wake.
    for (let step = 0; step < 28; step++) {
      const behind = .08 + step * .044;
      const a = orbitPoint(plan, head - plan.direction * behind, width, height);
      const b = orbitPoint(plan, head - plan.direction * (behind + .05), width, height);
      if ((a.depth >= 0) !== front || (b.depth >= 0) !== front) continue;
      const fade = Math.pow(1 - step / 28, 1.5) * (front ? 1 : .6);
      const spread = 1.5 + step * .18;
      for (const side of [-1, 0, 1]) {
        const na = (a.heading + 90) * Math.PI / 180, nb = (b.heading + 90) * Math.PI / 180;
        ctx.globalAlpha = fade * (side ? .68 : 1); ctx.lineWidth = side ? .8 : 3.5;
        ctx.beginPath(); ctx.moveTo(a.x + Math.cos(na) * spread * side, a.y + Math.sin(na) * spread * side);
        ctx.lineTo(b.x + Math.cos(nb) * (spread + .34) * side, b.y + Math.sin(nb) * (spread + .34) * side); ctx.stroke();
        if (!side) {
          ctx.strokeStyle = track.stale ? '#b9c9d2' : track.blocked ? '#ffe0e8' : '#e2fff7';
          ctx.lineWidth = 1.5; ctx.globalAlpha = fade * .9; ctx.shadowBlur = 0; ctx.stroke();
          ctx.strokeStyle = color; ctx.shadowBlur = front ? 24 : 14;
        }
      }
    }
    ctx.restore();
  });
}

/** Blue optical glass: a transparent body, Fresnel rim and reflected light. */
export function drawSphere(ctx: CanvasRenderingContext2D, width: number, height: number, seconds: number) {
  const cx = width / 2, cy = height / 2, radius = orbitRadius(width, height) * 1.04;
  ctx.save();
  const halo = ctx.createRadialGradient(cx, cy, radius * .88, cx, cy, radius * 1.13);
  halo.addColorStop(0, '#359ff600'); halo.addColorStop(.55, '#5dc5ff25'); halo.addColorStop(1, '#49bfff00');
  ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, radius * 1.13, 0, TAU); ctx.fill();
  const glass = ctx.createRadialGradient(cx - radius * .24, cy - radius * .35, radius * .04, cx, cy, radius);
  glass.addColorStop(0, '#4796cd08'); glass.addColorStop(.65, '#06447519');
  glass.addColorStop(.9, '#2375ad32'); glass.addColorStop(.975, '#70caff48'); glass.addColorStop(1, '#b7e9ff80');
  ctx.fillStyle = glass; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, TAU); ctx.fill();
  ctx.save(); ctx.clip(); ctx.strokeStyle = '#7abde32a'; ctx.lineWidth = .65;
  for (let i = 0; i < 7; i++) {
    const yaw = seconds * TAU / 220 + i * Math.PI / 7;
    ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(.5, Math.abs(Math.cos(yaw)) * radius), radius, -.22, 0, TAU); ctx.stroke();
  }
  for (const latitude of [-.75, -.5, -.25, 0, .25, .5, .75]) {
    ctx.beginPath(); ctx.ellipse(cx, cy + latitude * radius, radius * Math.sqrt(1 - latitude * latitude), radius * .1, -.22, 0, TAU); ctx.stroke();
  }
  ctx.restore();
  // Uneven highlights give the sphere depth instead of outlining a flat circle.
  ctx.strokeStyle = '#8ed7ff7a'; ctx.shadowColor = '#48b9ff'; ctx.shadowBlur = 15; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, TAU); ctx.stroke();
  for (const [start, end] of [[1.1, 1.64], [.2, .55]]) {
    ctx.strokeStyle = '#cef4ffb3'; ctx.shadowBlur = 10; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, radius - 1, Math.PI * start, Math.PI * end); ctx.stroke();
    ctx.strokeStyle = '#5ebcff55'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx, cy, radius - 5, Math.PI * start, Math.PI * end); ctx.stroke();
  }
  const star = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * .16);
  star.addColorStop(0, '#d7fbffc9'); star.addColorStop(.08, '#8ee5ffab'); star.addColorStop(.3, '#40c5ff38'); star.addColorStop(1, '#32c6ff00');
  ctx.shadowBlur = 0; ctx.fillStyle = star; ctx.beginPath(); ctx.arc(cx, cy, radius * .16, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#a8edff5c'; ctx.lineWidth = .7;
  ctx.beginPath(); ctx.moveTo(cx - radius * .13, cy); ctx.lineTo(cx + radius * .13, cy); ctx.moveTo(cx, cy - radius * .13); ctx.lineTo(cx, cy + radius * .13); ctx.stroke();
  ctx.restore();
}
