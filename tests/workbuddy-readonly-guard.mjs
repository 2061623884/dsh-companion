// Opt-in native acceptance only. Permit catalog/billing reads, block token
// refresh, login, generation, check-in and all other external fetches.
import { writeFileSync } from 'node:fs';
const nativeFetch = globalThis.fetch, requests = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(input), method = init?.method ?? 'GET';
  if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return nativeFetch(input, init);
  const allowed = (url.origin === 'https://copilot.tencent.com' && method === 'GET' && url.pathname === '/console/enterprises/personal/models') ||
    (url.origin === 'https://www.codebuddy.cn' && method === 'POST' && ['/v2/billing/meter/get-user-resource', '/v2/billing/meter/get-enterprise-user-usage'].includes(url.pathname));
  const record = { origin: url.origin, path: url.pathname, method, allowed, refreshHeader: new Headers(init?.headers).has('x-refresh-token') };
  requests.push(record);
  writeFileSync(process.env.DSH_WORKBUDDY_TEST_NETWORK, JSON.stringify(requests));
  if (!allowed || record.refreshHeader) return Response.json({ code: 503, message: 'Read-only acceptance guard blocked request' }, { status: 503 });
  const response = await nativeFetch(input, { ...init, signal: AbortSignal.timeout(15000) });
  record.status = response.status;
  writeFileSync(process.env.DSH_WORKBUDDY_TEST_NETWORK, JSON.stringify(requests));
  return response;
};
