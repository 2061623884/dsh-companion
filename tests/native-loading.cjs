// Exercise the shipped loading overlay and bridge in an actual VS Code webview.
const vscode = require('vscode'), assert = require('node:assert/strict'), http = require('node:http');
const path = require('node:path'), fs = require('node:fs/promises');
exports.run = async () => {
  const root = path.resolve(__dirname, '..'), { frameHtml } = require('../dist/test/sidebar/view');
  const cases = [];
  const server = http.createServer((req, res) => {
    const delay = Number(new URL(req.url, 'http://localhost').searchParams.get('delay'));
    res.setHeader('content-type', 'text/html');
    res.end(`<html><body>Ready chat<script>
      const post=type=>parent.postMessage({source:'dsh-companion-sidebar',type},'*');
      post('hello');setTimeout(()=>post('ui-ready'),${delay});
    </script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const delay of [400, 0]) {
      const panel = vscode.window.createWebviewPanel('dshLoadingTest', 'DSH loading acceptance', vscode.ViewColumn.One,
        { enableScripts: true, localResourceRoots: [] });
      try {
        const result = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Native loading transition timed out')), 10000);
          panel.webview.onDidReceiveMessage(message => {
            if(message.type === 'loading-test') { clearTimeout(timeout); resolve(message); }
          });
          let html = frameHtml('http://127.0.0.1:' + server.address().port, path.join(root, 'media/whale.svg'));
          html = html.replace('/?dsh-companion=1', '/?dsh-companion=1&delay=' + delay)
            .replace('acquireVsCodeApi()', '(window.__loadingTestApi = acquireVsCodeApi())');
          panel.webview.html = html.replace('</script>', `
            const loader=document.getElementById('dsh-companion-loading'), iframe=document.querySelector('iframe');
            const stream=loader.querySelector('.digit-stream');
            const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
            const initialAnimation=getComputedStyle(stream).animationName;
            let handshakeVisible=false, readyAt, firstTransform, animationMoved=false;
            window.addEventListener('message', event=>{
              if(event.source!==iframe.contentWindow)return;
              if(event.data.type==='hello')handshakeVisible=getComputedStyle(loader).visibility==='visible'&&iframe.inert;
              if(event.data.type==='ui-ready')readyAt=performance.now();
            });
            function sample(){
              const transform=getComputedStyle(stream).transform;
              if(firstTransform===undefined)firstTransform=transform;
              else if(!loader.hasAttribute('data-ready')&&transform!==firstTransform)animationMoved=true;
              if(readyAt!==undefined&&getComputedStyle(loader).visibility==='hidden'){
                window.__loadingTestApi.postMessage({type:'loading-test',handshakeVisible,animationMoved,reducedMotion,initialAnimation,
                  chatInteractive:!iframe.inert,fadeMs:performance.now()-readyAt,
                  animationStopped:getComputedStyle(stream).animationName==='none'});
              }else requestAnimationFrame(sample);
            }requestAnimationFrame(sample);
          </script>`);
        });
        assert.equal(result.handshakeVisible, true); assert.equal(result.chatInteractive, true);
        assert.equal(result.animationStopped, true); assert.ok(result.fadeMs < 500);
        if(result.reducedMotion) assert.equal(result.initialAnimation, 'none');
        else if(delay) assert.equal(result.animationMoved, true);
        cases.push({ delay, ...result });
      } finally { panel.dispose(); }
    }
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await fs.writeFile(path.join(root, '.test-work/native-loading-result.json'), JSON.stringify({ vscodeVersion: vscode.version, cases }, null, 2));
};
