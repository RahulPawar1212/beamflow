import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from './client';

/** Build a Response-like stub for the global fetch mock. */
function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => body,
  } as unknown as Response;
}

describe('api client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('requests', () => {
    it('GET /nodes hits the proxied /api base with no body', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ nodes: [] }));
      await api.getNodes();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/nodes');
      expect(options.method).toBeUndefined(); // default GET
      expect(options.body).toBeUndefined();
    });

    it('POST createPipeline sends a JSON body with the content-type header', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ metadata: { id: 'p1' } }));
      await api.createPipeline({ name: 'X' });
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/pipelines');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(options.body)).toEqual({ name: 'X' });
    });

    it('encodeURIComponent-escapes path segments (node type & pipeline id)', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}));
      await api.getNode('beamflow:csv-source');
      expect(fetchMock.mock.calls[0][0]).toBe('/api/nodes/beamflow%3Acsv-source');

      fetchMock.mockResolvedValue(jsonResponse({}));
      await api.getPipeline('a/b?c');
      expect(fetchMock.mock.calls[1][0]).toBe('/api/pipelines/a%2Fb%3Fc');
    });

    it('builds the execution polling URL from both ids', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}));
      await api.getExecution('pipe 1', 'exec 2');
      expect(fetchMock.mock.calls[0][0]).toBe('/api/pipelines/pipe%201/executions/exec%202');
    });
  });

  describe('response handling', () => {
    it('parses and returns the JSON body on success', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ nodes: [{ type: 'beamflow:map' }] }));
      const result = await api.getNodes();
      expect(result.nodes[0].type).toBe('beamflow:map');
    });

    it('returns undefined for a 204 No Content (delete)', async () => {
      fetchMock.mockResolvedValue(jsonResponse(null, { ok: true, status: 204 }));
      const result = await api.deletePipeline('p1');
      expect(result).toBeUndefined();
    });

    it('throws with the server error message on a non-OK response', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: 'Pipeline not found.' }, { ok: false, status: 404 }));
      await expect(api.getPipeline('missing')).rejects.toThrow('Pipeline not found.');
    });

    it('falls back to a status message when the error body has no `error`', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, { ok: false, status: 500 }));
      await expect(api.getNodes()).rejects.toThrow('Request failed: 500');
    });
  });
});
