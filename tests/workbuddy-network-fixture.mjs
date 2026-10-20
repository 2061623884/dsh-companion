// Test-only outbound fixture. Every non-loopback fetch is intercepted; no
// credentials or response bodies are recorded and no real model can be called.
import { writeFileSync } from 'node:fs';
const nativeFetch = globalThis.fetch, requests = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(input);
  if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return nativeFetch(input, init);
  requests.push({ path: url.pathname, method: init?.method ?? 'GET', refreshHeader: new Headers(init?.headers).has('x-refresh-token') });
  writeFileSync(process.env.DSH_WORKBUDDY_TEST_NETWORK, JSON.stringify(requests));
  if (url.pathname === '/console/enterprises/personal/models') return Response.json({ code: 0, data: {
    models: [{ id: 'fixture-workbuddy', name: 'WorkBuddy fixture', maxInputTokens: 128000, maxOutputTokens: 8192 }],
    agents: [{ name: 'cli', models: ['fixture-workbuddy'] }] } });
  return Response.json({ code: 503, message: 'Test fixture: external requests disabled' }, { status: 503 });
};
