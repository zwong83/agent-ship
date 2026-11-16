import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Render the actual graph component with deterministic execution snapshots.
const result = buildSync({
  stdin: { resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'tsx', contents: `
    import assert from 'node:assert/strict';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { WorkflowMap } from './src/workflow-map';
    const stages = [{id:'stage',name:'Delivery',nodes:[
      {id:'a',name:'Build',type:'work',dependencies:[]},
      {id:'b',name:'Review',type:'work',dependencies:['a']},
      {id:'c',name:'Ship',type:'end',dependencies:['b']}
    ]}];
    const render = (execution) => renderToStaticMarkup(<WorkflowMap stages={stages} execution={execution}/>);
    const running = render({states:{a:'complete',b:'running',c:'blocked'},executing:true});
    assert.match(running,/aria-label="Review: Executing"/);
    assert.equal((running.match(/class="map-cable tone-active"/g)||[]).length,1);
    assert.equal((running.match(/class="cable-packet"/g)||[]).length,1);
    assert.doesNotMatch(running,/tone-preview/);
    const offline = render({states:{a:'complete',b:'running',c:'blocked'},executing:false});
    assert.doesNotMatch(offline,/cable-packet|tone-active/);
    const finished = render({states:{a:'complete',b:'complete',c:'skipped'},executing:false});
    assert.doesNotMatch(finished,/cable-packet|tone-active/);
    assert.match(finished,/aria-label="Ship: skipped"/);
    const preview = renderToStaticMarkup(<WorkflowMap stages={stages} selectedId="b" select={()=>{}}/>);
    assert.match(preview,/Design preview · not live progress/);
    assert.equal((preview.match(/role="button"/g)||[]).length,3);
    assert.match(preview,/tone-preview selected/);
    const editable = renderToStaticMarkup(<WorkflowMap stages={stages} vertical onConnect={()=>{}}/>);
    assert.match(editable,/vertical-network/);
    assert.equal((editable.match(/aria-label="Start connection from /g)||[]).length,2);
    assert.equal((editable.match(/aria-label="Connect to /g)||[]).length,3);
    assert.doesNotMatch(editable,/min-width:720/);
    assert.doesNotMatch(running,/Start connection from|data-input-node/);
    console.log('PASS: rendered workflow preview, active dependencies, offline states, and keyboard targets.');
  ` }, bundle:true, platform:'node', format:'cjs', jsx:'automatic', write:false,
});
new Function('require', result.outputFiles[0].text)(createRequire(import.meta.url));
