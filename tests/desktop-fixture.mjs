import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, createHmac } from 'node:crypto';
import yaml from 'js-yaml';

/** @param {string} home @param {string} address @param {string} method @param {object} args */
export async function desktopRpc(home, address, method, args) {
  const credentials = /** @type {{records: Record<string, {payload: {secret: string}}>}} */ (yaml.load(await readFile(path.join(home, '.credentials.yaml'), 'utf8')));
  const secret = Buffer.from(credentials.records['client-connection/browser-session'].payload.secret, 'base64url');
  const authority = new URL(address).host, now = Date.now() - 1000;
  const payload = Buffer.from(JSON.stringify({ version: 1, authority, issuedAt: now, expiresAt: now + 300000 })).toString('base64url');
  const cookie = 'dsh-auth-' + createHash('sha256').update(authority).digest('base64url') + '=v1.' + payload + '.' + createHmac('sha256', secret).update(payload).digest('base64url');
  const response = await fetch(address + '/api/' + method, { method: 'POST', headers: { cookie, Origin: address, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'synthetic-' + method, method, payload: { args } }) });
  const result = (await response.json()).result;
  if (!result.ok) throw new Error('Desktop fixture RPC failed: ' + method + ' ' + JSON.stringify(result.error));
  return result.value;
}

/** Run the installed Desktop Host with synthetic data; never touch the daily profile.
 * @param {string} root @param {string} [existingDirectory]
 */
export async function desktopFixture(root, existingDirectory) {
  const directory = existingDirectory || await mkdtemp(path.join(root, '.test-work/desktop-'));
  const home = path.join(directory, 'home'), project = path.join(home, 'profiles/desktop');
  if (!existingDirectory) {
  await mkdir(project, { recursive: true });
  await writeFile(path.join(home, '.credentials.yaml'), JSON.stringify({ version: 1, refs: {}, records: {
    'deepseek-account-platform/default': { kind: 'grant', payload: { version: 1, token: 'synthetic-desktop-token', issuer: 'https://platform.deepseek.com' } }
  } }));
  await writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'synthetic-desktop', private: true,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } }));
  await writeFile(path.join(project, 'cordis.patch.yml'), '[]\n');
  }
  if (!process.env.LOCALAPPDATA) throw new Error('Desktop fixture requires Windows LOCALAPPDATA');
  const installation = path.join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness');
  const runtime = path.join(installation, 'resources/app.asar/dsh');
  const executable = path.join(installation, 'DeepSeek Harness.exe');
  const network = path.join(directory, 'network.json');
  await writeFile(network, '[]');
  const child = spawn(executable, ['--expose-internals', path.join(runtime, 'node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js'),
    runtime, project, path.join(installation, 'resources/runtime/primary-runtime')], { windowsHide: true,
    env: { ...process.env, DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: '--import=' + pathToFileURL(path.join(root, 'tests/workbuddy-network-fixture.mjs')).href,
      DSH_WORKBUDDY_TEST_NETWORK: network }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  /** @type {Buffer[]} */
  const diagnostics = [];
  /** @type {import('node:stream').Readable} */ (child.stdout).on('data', bytes => diagnostics.push(bytes));
  /** @type {import('node:stream').Readable} */ (child.stderr).on('data', bytes => diagnostics.push(bytes));
  let address;
  try {
    address = await /** @type {Promise<string>} */ (new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Desktop fixture startup timeout')), 60000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error('Desktop fixture exited: ' + code)); });
      child.on('message', message => {
        const value = /** @type {{type: string, url?: string}} */ (message);
        if (value.type === 'ready' && typeof value.url === 'string') { clearTimeout(timer); resolve(new URL(value.url).origin); }
        else if (value.type === 'fatal') { clearTimeout(timer); reject(new Error('Desktop fixture boot failed')); }
      });
    }));
  } catch (error) {
    child.kill(); await writeFile(path.join(directory, 'host.log'), Buffer.concat(diagnostics)); throw error;
  }
  return { directory, home, address, executable, pid: /** @type {number} */ (child.pid), network,
    async stop() {
      if (child.exitCode === null) { const closed = once(child, 'exit'); child.disconnect(); await closed; }
      await writeFile(path.join(directory, 'host.log'), Buffer.concat(diagnostics));
      const requests = /** @type {{path: string}[]} */ (JSON.parse(await readFile(network, 'utf8')));
      if (requests.some(request => /chat\/completions|\/responses|\/messages/.test(request.path))) throw new Error('Unexpected model request');
    } };
}
