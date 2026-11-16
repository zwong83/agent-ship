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
/** The visible line, moving light trail and ship use exactly the same route. */
export function drawOrbitTracks(ctx: CanvasRenderingContext2D, width: number, height: number, seconds: number, tracks: OrbitTrack[], plans: OrbitPlan[], front: boolean) {
  plans.forEach((plan, index) => {
    const track = tracks[index];
    const color = !track ? '#69bdbb' : track.stale ? '#90a3b6' : track.blocked ? '#ff748a' : track.selected ? '#dbfff4' : '#7ef4d6';
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = track?.selected ? 1.8 : 1;
    ctx.globalAlpha = track ? (front ? .7 : .2) : (front ? .23 : .09);
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
    ctx.shadowColor = color; ctx.shadowBlur = front ? 22 : 12;
    // Two spreading ripples and a luminous centerline form the fading wake.
    for (let step = 0; step < 28; step++) {
      const behind = .08 + step * .044;
      const a = orbitPoint(plan, head - plan.direction * behind, width, height);
      const b = orbitPoint(plan, head - plan.direction * (behind + .05), width, height);
      if ((a.depth >= 0) !== front || (b.depth >= 0) !== front) continue;
      const fade = Math.pow(1 - step / 28, 1.5) * (front ? 1 : .6);
      const spread = 2 + step * .34;
      for (const side of [-1, 0, 1]) {
        const na = (a.heading + 90) * Math.PI / 180, nb = (b.heading + 90) * Math.PI / 180;
        ctx.globalAlpha = fade * (side ? .68 : 1); ctx.lineWidth = side ? 1.4 : 4.5;
        ctx.beginPath(); ctx.moveTo(a.x + Math.cos(na) * spread * side, a.y + Math.sin(na) * spread * side);
        ctx.lineTo(b.x + Math.cos(nb) * (spread + .34) * side, b.y + Math.sin(nb) * (spread + .34) * side); ctx.stroke();
        if (!side) {
          ctx.strokeStyle = track.stale ? '#b9c9d2' : track.blocked ? '#ffe0e8' : '#e2fff7';
          ctx.lineWidth = 1.5; ctx.globalAlpha = fade * .9; ctx.shadowBlur = 0; ctx.stroke();
          ctx.strokeStyle = color; ctx.shadowBlur = front ? 22 : 12;
        }
      }
    }
    ctx.restore();
  });
}

/** Translucent glass gives the rear ships a visible layer to travel behind. */
export function drawSphere(ctx: CanvasRenderingContext2D, width: number, height: number, seconds: number) {
  const cx = width / 2, cy = height / 2, radius = orbitRadius(width, height) * .82;
  ctx.save();
  const glass = ctx.createRadialGradient(cx - radius * .34, cy - radius * .4, radius * .08, cx, cy, radius);
  glass.addColorStop(0, '#98f7e914'); glass.addColorStop(.6, '#173b4c30'); glass.addColorStop(.92, '#163c4c4a'); glass.addColorStop(1, '#79e6d92e');
  ctx.fillStyle = glass; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, TAU); ctx.fill();
  ctx.save(); ctx.clip(); ctx.strokeStyle = '#81e3d91e'; ctx.lineWidth = .7;
  for (let i = 0; i < 5; i++) {
    const yaw = seconds * TAU / 220 + i * Math.PI / 5;
    ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(.5, Math.abs(Math.cos(yaw)) * radius), radius, -.22, 0, TAU); ctx.stroke();
  }
  for (const latitude of [-.6, -.3, 0, .3, .6]) {
    ctx.beginPath(); ctx.ellipse(cx, cy + latitude * radius, radius * Math.sqrt(1 - latitude * latitude), radius * .12, -.22, 0, TAU); ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = '#97ffe345'; ctx.shadowColor = '#58e9d5'; ctx.shadowBlur = 18; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, TAU); ctx.stroke();
  ctx.strokeStyle = '#ccfff59c'; ctx.shadowBlur = 6; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(cx, cy, radius - 2, Math.PI * 1.12, Math.PI * 1.57); ctx.stroke();
  ctx.restore();
}
