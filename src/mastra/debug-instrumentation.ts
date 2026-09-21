// Debug-only fetch and event probes for the first-turn ask_question hang.
const originalFetch = globalThis.fetch.bind(globalThis);

function safeUrlParts(input: RequestInfo | URL): { host: string; pathname: string } {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const parsed = new URL(raw, 'http://localhost');
    return { host: parsed.host, pathname: parsed.pathname };
  } catch {
    return { host: 'unparseable', pathname: '' };
  }
}

function isDebugIngest(input: RequestInfo | URL): boolean {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return raw.includes('127.0.0.1:7329/ingest/');
  } catch {
    return false;
  }
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (isDebugIngest(input)) {
    return originalFetch(input, init);
  }

  const { host, pathname } = safeUrlParts(input);
  const started = Date.now();
  // #region agent log
  fetch('http://127.0.0.1:7329/ingest/c35ee18f-ced6-4dfb-9939-f69ca388e4fa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '2d9e32' },
    body: JSON.stringify({
      sessionId: '2d9e32',
      runId: 'pre-fix',
      hypothesisId: 'C',
      location: 'debug-instrumentation.ts:fetch-start',
      message: 'outbound fetch start',
      data: {
        host,
        pathname,
        method: init?.method ?? 'GET',
        autoBlock: process.env.AUTO_BLOCK_EXTERNAL_PROVIDERS ?? null,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  try {
    const response = await originalFetch(input, init);
    // #region agent log
    fetch('http://127.0.0.1:7329/ingest/c35ee18f-ced6-4dfb-9939-f69ca388e4fa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '2d9e32' },
      body: JSON.stringify({
        sessionId: '2d9e32',
        runId: 'pre-fix',
        hypothesisId: 'C',
        location: 'debug-instrumentation.ts:fetch-end',
        message: 'outbound fetch end',
        data: {
          host,
          pathname,
          status: response.status,
          ok: response.ok,
          durationMs: Date.now() - started,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    return response;
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7329/ingest/c35ee18f-ced6-4dfb-9939-f69ca388e4fa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '2d9e32' },
      body: JSON.stringify({
        sessionId: '2d9e32',
        runId: 'pre-fix',
        hypothesisId: 'C',
        location: 'debug-instrumentation.ts:fetch-error',
        message: 'outbound fetch error',
        data: {
          host,
          pathname,
          durationMs: Date.now() - started,
          name: error instanceof Error ? error.name : 'unknown',
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    throw error;
  }
}) as typeof fetch;

// #region agent log
fetch('http://127.0.0.1:7329/ingest/c35ee18f-ced6-4dfb-9939-f69ca388e4fa', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '2d9e32' },
  body: JSON.stringify({
    sessionId: '2d9e32',
    runId: 'pre-fix',
    hypothesisId: 'C',
    location: 'debug-instrumentation.ts:boot',
    message: 'debug instrumentation loaded',
    data: {
      autoBlock: process.env.AUTO_BLOCK_EXTERNAL_PROVIDERS ?? null,
    },
    timestamp: Date.now(),
  }),
}).catch(() => {});
// #endregion
