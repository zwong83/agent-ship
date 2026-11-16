import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/workflow-model.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { dependencyIssue } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
const node = (id, dependencies = [], type = 'work') => ({ id, name: id, type, dependencies });
const stages = [
  { id: 's1', name: 'Build', nodes: [node('a'), node('b', ['a']), node('c', ['b']), node('parallel')] },
  { id: 's2', name: 'Deliver', nodes: [node('review', ['c']), node('end', ['review'], 'end')] },
];
assert.equal(dependencyIssue(stages, 'parallel', 'b'), null, 'same-stage dependencies are supported');
assert.equal(dependencyIssue(stages, 'parallel', 'review'), null, 'cross-stage dependency is valid');
assert.equal(dependencyIssue(stages, 'parallel', 'end'), null, 'end node can receive dependencies');
assert.match(dependencyIssue(stages, 'a', 'a'), /itself/);
assert.match(dependencyIssue(stages, 'a', 'b'), /already connected/);
assert.match(dependencyIssue(stages, 'review', 'a'), /later stage/);
assert.match(dependencyIssue(stages, 'end', 'review'), /end node/);
assert.match(dependencyIssue(stages, 'c', 'a'), /circular/, 'transitive cycles are rejected');
assert.match(dependencyIssue(stages, 'b', 'a'), /circular/, 'direct cycles are rejected');
assert.match(dependencyIssue(stages, 'gone', 'a'), /exist/);
assert.match(dependencyIssue(stages, 'a', 'gone'), /exist/);
const existingCycle = [{ id: 'cycle', name: 'Imported draft', nodes: [node('x', ['y']), node('y', ['x']), node('z')] }];
assert.equal(dependencyIssue(existingCycle, 'x', 'z'), null, 'validation terminates even with a preexisting cycle');
console.log('PASS: dependency validation covers valid connections, missing nodes, duplicates, stage order, terminal nodes and cycles.');
