import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { windowGlobalData } = vi.hoisted(() => ({
  windowGlobalData: {
    rapt: undefined as unknown,
    account: '0',
    'f.sid': 'test-session',
    bl: 'test-build',
    path: '/',
    at: 'test-token',
  },
}));

vi.mock('../src/windowGlobalData', () => ({ windowGlobalData }));

import Api from '../src/api/api';
import ApiUtils from '../src/api/api-utils';

function rpcRow(rpcid: string, payload: unknown): unknown[] {
  return ['wrb.fr', rpcid, JSON.stringify(payload)];
}

async function settleWithRetries<T>(request: Promise<T>): Promise<T> {
  const settled = request.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  await vi.runAllTimersAsync();
  const result = await settled;
  if (!result.ok) throw result.error;
  return result.value;
}

describe('Api.makeApiRequest', () => {
  const fetchMock = vi.fn<typeof fetch>();

  function respondWith(body: string, status = 200): void {
    fetchMock.mockImplementation(async () => new Response(body, { status }));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    windowGlobalData.rapt = undefined;
    vi.stubGlobal('window', { location: { pathname: '/test/path' } });
    fetchMock.mockReset();
    respondWith(JSON.stringify([rpcRow('testRpc', {})]));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('includes a string RAPT token in the request URL', async () => {
    windowGlobalData.rapt = 'locked-folder-token';
    await new Api().makeApiRequest('testRpc', []);
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get('rapt')).toBe('locked-folder-token');
  });

  it('omits a non-string RAPT value from the request URL', async () => {
    windowGlobalData.rapt = 42;
    await new Api().makeApiRequest('testRpc', []);
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.has('rapt')).toBe(false);
  });

  it('finds the requested RPC after bookkeeping and other RPC rows', async () => {
    respondWith(JSON.stringify([
      ['di', 17], rpcRow('otherRpc', { wrong: true }),
      rpcRow('testRpc', { correct: true }), ['af.httprm', 17],
    ]));
    await expect(settleWithRetries(new Api().makeApiRequest('testRpc', [])))
      .resolves.toEqual({ correct: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('finds the requested RPC in a later framed response chunk', async () => {
    respondWith([
      ")]}'", '', '100', JSON.stringify([['wrb.fr', 'otherRpc', null]]),
      '200', JSON.stringify([rpcRow('testRpc', { correct: true })]),
    ].join('\n'));
    await expect(settleWithRetries(new Api().makeApiRequest('testRpc', [])))
      .resolves.toEqual({ correct: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not use another RPC payload when the requested RPC is missing', async () => {
    respondWith(JSON.stringify([rpcRow('otherRpc', { wrong: true })]));
    await expect(settleWithRetries(new Api().makeApiRequest('testRpc', [])))
      .rejects.toThrow('No matching RPC envelope found in response');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not interpret a payload containing wrb.fr as an envelope', async () => {
    respondWith(JSON.stringify([['di', 'testRpc', JSON.stringify({ text: 'wrb.fr' })]]));
    await expect(settleWithRetries(new Api().makeApiRequest('testRpc', [])))
      .rejects.toThrow('No wrb.fr envelope found in response');
  });

  it('rejects ambiguous duplicate responses for the requested RPC', async () => {
    respondWith(JSON.stringify([
      rpcRow('testRpc', { first: true }), rpcRow('testRpc', { second: true }),
    ]));
    await expect(settleWithRetries(new Api().makeApiRequest('testRpc', [])))
      .rejects.toThrow('Multiple matching RPC envelopes found in response');
  });

  it.each([null, undefined, ''])('keeps a missing payload (%s) as a provider error', async (payload) => {
    respondWith(JSON.stringify([
      rpcRow('otherRpc', { unrelated: true }), ['wrb.fr', 'testRpc', payload],
    ]));
    await expect(settleWithRetries(new Api().makeApiRequest('testRpc', [])))
      .rejects.toThrow('Missing payload in parsed response');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([{}, [], 42, false].map((payload) => [payload]))('rejects a non-string payload (%j)', async (payload) => {
    respondWith(JSON.stringify([['wrb.fr', 'testRpc', payload]]));
    await expect(settleWithRetries(new Api().makeApiRequest('testRpc', [])))
      .rejects.toThrow('Invalid payload type in parsed response');
  });

  it.each([[], null, false, 0, {}].map((payload) => [payload]))('preserves valid JSON payloads (%j)', async (payload) => {
    respondWith(JSON.stringify([rpcRow('testRpc', payload)]));
    await expect(new Api().makeApiRequest('testRpc', [])).resolves.toEqual(payload);
  });

  it('preserves a legitimate empty-library response', async () => {
    respondWith(JSON.stringify([rpcRow('EzkLib', [[], null])]));
    await expect(new Api().getItemsByUploadedDate()).resolves.toEqual({ items: [], nextPageId: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('recovers after a transient missing payload', async () => {
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify([['wrb.fr', 'testRpc', null]])));
    await expect(settleWithRetries(new Api().makeApiRequest('testRpc', []))).resolves.toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['', 'Empty response body'],
    [")]}'\n100\n[]", 'No wrb.fr envelope found in response'],
  ])('rejects an invalid response (%j) after bounded retries', async (body, message) => {
    respondWith(body);
    await expect(settleWithRetries(new Api().makeApiRequest('testRpc', []))).rejects.toThrow(message);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    '[["wrb.fr", "testRpc",',
    JSON.stringify([['wrb.fr', 'testRpc', '{invalid-json}']]),
  ])('keeps malformed JSON as a failure (%s)', async (body) => {
    respondWith(body);
    await expect(settleWithRetries(new Api().makeApiRequest('testRpc', []))).rejects.toBeInstanceOf(SyntaxError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([401, 403, 429, 503])('preserves HTTP %i provider errors', async (status) => {
    respondWith('provider error', status);
    await expect(settleWithRetries(new Api().makeApiRequest('testRpc', []))).rejects.toThrow(`HTTP ${status}`);
    expect(fetchMock).toHaveBeenCalledTimes(status === 401 || status === 403 ? 1 : 3);
  });

  it('does not start a request for an already aborted read', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(settleWithRetries(new Api().makeApiRequest('testRpc', [], controller.signal)))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts a pending fetch and does not retry it', async () => {
    const controller = new AbortController();
    let aborted = false;
    fetchMock.mockImplementation((_url, options) => new Promise((resolve, reject) => {
      if (!options?.signal) { resolve(new Response(JSON.stringify([rpcRow('testRpc', {})]))); return; }
      options.signal.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    }));
    const result = new Api().makeApiRequest('testRpc', [], controller.signal).catch((error: unknown) => error);
    controller.abort();
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels an inner retry delay without making another request', async () => {
    const controller = new AbortController();
    respondWith(JSON.stringify([['wrb.fr', 'testRpc', null]]));
    const result = new Api().makeApiRequest('testRpc', [], controller.signal).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not retry a fetch AbortError even without an external signal', async () => {
    fetchMock.mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    await expect(settleWithRetries(new Api().makeApiRequest('testRpc', [])))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still retries a transient HTTP error and cleans up its retry timer', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('temporarily unavailable', { status: 503 }));
    await expect(settleWithRetries(new Api().makeApiRequest('testRpc', []))).resolves.toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([401, 403])('preserves HTTP %i status for the outer scan classifier', async (status) => {
    respondWith('expired session', status);
    await expect(settleWithRetries(new Api().makeApiRequest('testRpc', [])))
      .rejects.toMatchObject({ status });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['EzkLib', (api: Api, signal: AbortSignal) => api.getItemsByUploadedDate(null, false, signal)],
    ['Z5xsfc', (api: Api, signal: AbortSignal) => api.getAlbums(null, 100, false, signal)],
    ['snAcKc', (api: Api, signal: AbortSignal) => api.getAlbumPage('album', null, null, false, signal)],
    ['EWgK9e', (api: Api, signal: AbortSignal) => api.getBatchMediaInfo([], false, signal)],
  ] as const)('passes the read signal to fetch for %s', async (rpcid, read) => {
    const controller = new AbortController();
    respondWith(JSON.stringify([rpcRow(rpcid, [])]));
    await read(new Api(), controller.signal);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });


  it('cancels the album helper read without leaving API retries running', async () => {
    const controller = new AbortController();
    const core = { isProcessRunning: true } as ConstructorParameters<typeof ApiUtils>[0];
    const utils = new ApiUtils(core);
    let aborted = false;
    fetchMock.mockImplementation((_url, options) => new Promise((resolve, reject) => {
      if (!options?.signal) { resolve(new Response(JSON.stringify([rpcRow('snAcKc', [null, [], null, null])]))); return; }
      options.signal.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    }));
    const result = utils.getAllMediaInAlbum('album', controller.signal);
    controller.abort();
    await vi.runAllTimersAsync();
    await result;
    expect(aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

});
