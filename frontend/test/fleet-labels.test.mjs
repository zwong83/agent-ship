import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/earth-geometry.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText;
const { createOrbitPlans, spacedFormation, alertLayout, fleetLabelLayout } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
for (const [width, height, count] of [[294, 335, 2], [364, 435, 2], [430, 430, 4], [500, 500, 6], [510, 500, 6], [600, 680, 6]]) {
  const plans = createOrbitPlans(Array.from({ length: count }, (_, i) => String(i)));
  for (let t = 0; t < 168; t += .25) {
    const ships = spacedFormation(plans, t, width, height, count);
    const labels = fleetLabelLayout(ships, alertLayout(ships, width, height), width, height);
    assert.equal(labels.length, count);
    labels.forEach((label, i) => {
      assert.ok(label.x >= 68 && label.x <= width - 68 && label.y >= 16 && label.y <= height - 16, 'Persistent nameplates stay within the scene');
      labels.slice(i + 1).forEach(other => assert.ok(Math.abs(label.x - other.x) >= 132 || Math.abs(label.y - other.y) >= 28, 'Nameplates never obscure each other during a complete orbit'));
    });
  }
}
console.log('PASS persistent fleet nameplate bounds and separation across two orbital cycles');
