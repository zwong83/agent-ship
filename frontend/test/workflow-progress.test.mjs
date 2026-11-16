import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/workflow-progress.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText;
const { workflowNodeTone: node, workflowConnectionTone: edge } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

assert.equal(node(undefined, false), 'preview');
for (const state of ['running', 'leased']) {
  assert.equal(node(state, true), 'active');
  assert.equal(node(state, false), 'pending', 'Offline or stopped runs must not show work in motion');
}
for (const state of ['ready', 'queued', 'blocked', 'pending', 'unknown']) assert.equal(node(state, true), 'pending');
for (const state of ['complete', 'completed', 'succeeded']) assert.equal(node(state, false), 'complete');
for (const state of ['failed', 'needs_attention', 'waiting_reply', 'stopped', 'cancelled']) assert.equal(node(state, true), 'attention');
assert.equal(node('skipped', true), 'skipped');
assert.equal(edge('preview', 'preview'), 'preview');
assert.equal(edge('complete', 'active'), 'active');
assert.equal(edge('complete', 'complete'), 'complete');
assert.equal(edge('complete', 'attention'), 'attention');
assert.equal(edge('active', 'pending'), 'pending');
assert.equal(edge('pending', 'active'), 'pending');
assert.equal(edge('skipped', 'active'), 'skipped');
assert.equal(edge('complete', 'skipped'), 'skipped');
console.log('PASS: workflow motion reflects recorded states, resolved dependencies, and offline execution.');
