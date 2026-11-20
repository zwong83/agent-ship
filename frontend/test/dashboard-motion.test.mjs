import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Run the actual component effects and geometry against deterministic browser boundaries.
// This adapter models one mounted effect lifecycle; it does not claim React DOM integration.
const result = await build({
  entryPoints: [fileURLToPath(new URL('../src/earth-fleet.tsx', import.meta.url))],
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', write: false, external: ['react/jsx-runtime'],
  plugins: [{ name: 'isolated-effect-lifecycle', setup(builder) {
    builder.onResolve({ filter: /^react$/ }, () => ({ path: 'hooks', namespace: 'motion-test' }));
    builder.onLoad({ filter: /.*/, namespace: 'motion-test' }, () => ({ contents:
      'export const useRef = value => ({ current: value }); export const useEffect = effect => globalThis.__motionEffects.push(effect);', loader: 'js' }));
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { EarthFleet } = module.exports;

function exercise(reducedInitially) {
  const effects = globalThis.__motionEffects = [];
  const listeners = new Set(), frames = new Map(), nodes = [];
  let sequence = 0, observerDisconnected = false, observed = false, draws = 0;
  const motion = { matches: reducedInitially,
    addEventListener(type, callback) { assert.equal(type, 'change'); listeners.add(callback); },
    removeEventListener(type, callback) { assert.equal(type, 'change'); listeners.delete(callback); },
  };
  globalThis.window = { devicePixelRatio: 3, matchMedia(query) { assert.equal(query, '(prefers-reduced-motion: reduce)'); return motion; } };
  globalThis.document = { hidden: false };
  globalThis.ResizeObserver = class { observe() { observed = true; } disconnect() { observerDisconnected = true; } };
  globalThis.requestAnimationFrame = callback => { const id = ++sequence; frames.set(id, callback); return id; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  const context = new Proxy({}, { get(_target, key) {
    if (key === 'clearRect') return () => { draws++; };
    if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => ({ addColorStop() {} });
    return () => {};
  } });
  const row = { requirement: { id: 'mission', name: 'Motion requirement' },
    runs: [{ state: 'waiting' }], alertRun: { id: 'run', allowedActions: ['open_repair_control'] } };
  const tree = EarthFleet({ rows: [row], selected: null, select() {}, navigate() {}, live: true, hideRoster: true });
  function mount(element) {
    if (!element || typeof element !== 'object') return;
    if (Array.isArray(element)) { element.forEach(mount); return; }
    const props = element.props ?? {};
    const node = { props, style: { setProperty(name, value) { this[name] = value; } }, dataset: {},
      getBoundingClientRect: () => ({ width: 640, height: 516 }), getContext: () => context };
    nodes.push(node);
    if (typeof props.ref === 'function') props.ref(node);
    else if (props.ref) props.ref.current = node;
    mount(props.children);
  }
  mount(tree);
  const cleanup = effects.map(effect => effect()).filter(Boolean);
  const hull = nodes.find(node => node.props.className?.startsWith('orbital-ship '));
  const alert = nodes.find(node => node.props.className?.includes('orbital-hud-alert'));
  const canvas = nodes.find(node => node.props.className === 'earth-sphere');
  assert.ok(observed); assert.equal(listeners.size, 1); assert.equal(frames.size, 1);
  assert.equal(canvas.width, 1280, 'Canvas DPR is capped at two');
  const step = time => { const [id, callback] = frames.entries().next().value; frames.delete(id); callback(time); assert.equal(frames.size, 1, 'One animation callback remains scheduled'); };
  const initial = hull.style.transform, initialDraws = draws;
  step(1000); step(4000);
  if (reducedInitially) {
    assert.equal(hull.style.transform, initial, 'Reduced motion holds the initial formation');
    assert.equal(draws, initialDraws, 'Reduced motion does not continuously redraw');
    motion.matches = false; listeners.forEach(listener => listener()); step(8000);
    assert.notEqual(hull.style.transform, initial, 'Changing the motion preference resumes sailing');
  } else {
    assert.notEqual(hull.style.transform, initial, 'Normal motion advances the real orbit geometry');
    alert.props.onFocus(); const pinned = alert.style.transform, moving = hull.style.transform;
    step(8000); assert.equal(alert.style.transform, pinned, 'Focus pins the alert target');
    assert.notEqual(hull.style.transform, moving, 'Focus does not pause the ship');
    alert.props.onBlur(); step(12000); assert.notEqual(alert.style.transform, pinned, 'Blur releases the target');
    document.hidden = true; const hidden = hull.style.transform, beforeHidden = draws;
    step(16000); assert.equal(hull.style.transform, hidden); assert.equal(draws, beforeHidden, 'Hidden pages do not redraw');
    document.hidden = false; motion.matches = true; listeners.forEach(listener => listener());
    const staticPosition = hull.style.transform, beforeReduced = draws;
    step(20000); assert.equal(hull.style.transform, staticPosition); assert.equal(draws, beforeReduced, 'A preference change takes effect immediately');
  }
  const late = frames.values().next().value, beforeCleanup = hull.style.transform;
  cleanup.forEach(dispose => dispose());
  assert.equal(frames.size, 0, 'Unmount cancels the outstanding frame');
  assert.equal(listeners.size, 0, 'Unmount removes the motion listener');
  assert.equal(observerDisconnected, true, 'Unmount disconnects resize observation');
  late(30000); assert.equal(frames.size, 0); assert.equal(hull.style.transform, beforeCleanup, 'A late frame cannot mutate the departed view');
}
exercise(true);
exercise(false);
console.log('PASS real orbital effects: reduced motion, preference changes, continuous sailing, pinned alert, hidden page, DPR cap, and disposal');
