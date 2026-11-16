import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/earth-geometry.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { ORBIT_COUNT, createOrbitPlans, formationPosition, orbitPoint, drawOrbitTracks, spacedFormation, alertLayout } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
assert.equal(ORBIT_COUNT, 6);
for (const count of [0, 1, 2, 4, 6]) {
  const ids = Array.from({length: count}, (_, i) => 'requirement-' + i);
  const plans = createOrbitPlans(ids);
  assert.equal(plans.length, 6, 'All six paths remain present, including unoccupied ones');
  assert.deepEqual(plans, createOrbitPlans(ids), 'Polling cannot change route phases');
  const normals = plans.map(plan => {
    const a = orbitPoint(plan, 0, 640, 516).unit, b = orbitPoint(plan, Math.PI / 2, 640, 516).unit;
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  });
  normals.forEach((a, i) => normals.slice(i + 1).forEach(b => assert.ok(Math.abs(a.reduce((sum,v,k)=>sum+v*b[k],0)) < .96, 'Every circular plane has a visibly different tilt')));
  for (const [width, height] of [[294, 434], [364, 434], [500, 516], [640, 516], [980, 806]]) {
    plans.forEach((plan, i) => {
      let front = false, rear = false;
      for (let seconds = 0; seconds <= plan.period; seconds += .25) {
        const point = formationPosition(plan, seconds, width, height);
        front ||= point.depth > .7; rear ||= point.depth < -.7;
        assert.ok(point.x >= 45 && point.x <= width - 45 && point.y >= 44 && point.y <= height - 44, 'Medium-small ships remain inside the scene');
        assert.ok(Math.abs(point.unit.reduce((sum,v)=>sum+v*v,0)-1) < 1e-9, 'The path is a true 3D circle');
        assert.ok(Math.abs(point.unit.reduce((sum,v,k)=>sum+v*normals[i][k],0)) < 1e-9, 'Each ship stays in its own tilted plane');
        assert.deepEqual(point, orbitPoint(plan, point.angle, width, height), 'The ship and wake use the same curve');
        const later = formationPosition(plan, seconds + plan.period, width, height);
        assert.ok(Math.hypot(point.x-later.x,point.y-later.y) < 1e-8, '360-degree motion loops continuously');
        const ahead = formationPosition(plan, seconds + .001, width, height);
        const tangent = Math.atan2(ahead.y-point.y,ahead.x-point.x)*180/Math.PI;
        assert.ok(Math.abs(((point.heading-tangent+540)%360)-180) < .02, 'The hull follows the projected flight tangent');
      }
      assert.ok(front && rear, 'Every ship travels past the front and around the back');
      assert.ok(orbitPoint(plan, Math.PI/2,width,height).scale > orbitPoint(plan,Math.PI*1.5,width,height).scale, 'Front ships appear closer than rear ships');
    });
  }
}
let strokes = 0;
const ctx = { save(){}, restore(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){ strokes++; } };
drawOrbitTracks(ctx, 640, 516, 0, [], createOrbitPlans([]), true);
assert.equal(strokes, 6, 'The empty scene draws exactly six orbit lines and no fake agent wakes');
strokes=0;
drawOrbitTracks(ctx,640,516,0,[{blocked:false,selected:false,stale:false}],createOrbitPlans(['a']),true);
drawOrbitTracks(ctx,640,516,0,[{blocked:false,selected:false,stale:false}],createOrbitPlans(['a']),false);
assert.ok(strokes>12,'Occupied paths gain fading wakes in the appropriate hemisphere');
console.log('PASS six distinct 3D circular planes, perspective bounds, front/back transitions, tangent headings, exact wakes, stable phases and empty-slot rendering.');

for (const [width,height,count] of [[294,434,2],[364,434,2],[355,434,2],[580,516,4],[640,516,6],[980,806,6]]) {
  const plans = createOrbitPlans(Array.from({length:count},(_,i)=>'live-'+i));
  const pinned = new Map();
  for (let seconds = 0; seconds < 168; seconds += .125) {
    const points = spacedFormation(plans,seconds,width,height,count);
    const alerts = alertLayout(points,width,height,pinned);
    if (seconds === 5) pinned.set(0,{...alerts[0]});
    if (seconds === 40) pinned.clear();
    points.forEach((point,i)=>{
      const raw = formationPosition(plans[i],seconds,width,height);
      assert.deepEqual([point.x,point.y],[raw.x,raw.y],'Spacing preserves the six exact tilted paths');
      const repeat = spacedFormation(plans,seconds+84,width,height,count)[i];
      assert.ok(Math.hypot(point.x-repeat.x,point.y-repeat.y)<1e-8,'Spacing repeats without eventual drift');
      const diameter=Math.hypot(76,76)*point.scale;
      points.slice(i+1).forEach(other=>{
        const distance=Math.hypot(point.x-other.x,point.y-other.y);
        assert.ok(distance>75,'Coordinated timing maintains visible projected separation');
        assert.ok((diameter+Math.hypot(76,76)*other.scale)/2 < distance-5,'Sailboat bounds cannot overlap');
      });
      assert.ok(alerts[i].x>=28&&alerts[i].x<=width-28&&alerts[i].y>=28&&alerts[i].y<=height-28,'52px alerts remain in bounds');
      if(pinned.has(i)) assert.deepEqual(alerts[i],pinned.get(i),'Hover/focus pins the alert without stopping the ship');
      alerts.slice(i+1).forEach(other=>assert.ok(Math.hypot(alerts[i].x-other.x,alerts[i].y-other.y)>74,'Alert hit areas never overlap'));
    });
  }
}
console.log('PASS repeated-cycle projected ship clearance, non-overlapping hull bounds, independent 52px alert targets and pinned hover/focus anchors.');
