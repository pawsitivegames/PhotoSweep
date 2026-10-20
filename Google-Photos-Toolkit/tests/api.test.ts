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

describe('Api.makeApiRequest', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    windowGlobalData.rapt = undefined;
    vi.stubGlobal('window', { location: { pathname: '/test/path' } });
    fetchMock.mockResolvedValue(new Response(JSON.stringify([['wrb.fr', null, '{}']])));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
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
});
