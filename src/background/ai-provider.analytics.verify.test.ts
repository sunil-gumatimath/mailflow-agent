/**
 * Verification harness for Issue 2a: silent JSON-parse fallback in runAnalytics.
 *
 * runAnalytics() calls callGemini() expecting a JSON object that matches a
 * documented schema. If the model returns anything that doesn't parse —
 * a refusal, truncated JSON, garbage inside a markdown fence — the function
 * logs to console.error and returns a fabricated fallback object.
 *
 * The fix: console.error now also receives the raw model text in a { raw }
 * object as the trailing argument, so a developer debugging the extension
 * can see what the model actually said. The user's UI behaviour is unchanged.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ── chrome.storage.local in-memory stub ───────────────────────────────────────
const store = new Map<string, unknown>();
const chromeMock = {
  storage: {
    local: {
      get: vi.fn(async (key: string | string[]) => {
        const keys = Array.isArray(key) ? key : [key];
        const out: Record<string, unknown> = {};
        for (const k of keys) if (store.has(k)) out[k] = store.get(k);
        return out;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) store.set(k, v);
      }),
    },
  },
};
(globalThis as unknown as { chrome: typeof chromeMock }).chrome = chromeMock;

// ── fetch stub: canned Gemini response ────────────────────────────────────────
let nextResponse: { ok: boolean; status?: number; json: unknown } = {
  ok: true,
  json: { candidates: [{ content: { parts: [{ text: '' }] } }] },
};

const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => {
  return {
    ok: nextResponse.ok,
    status: nextResponse.status ?? 200,
    json: async () => nextResponse.json,
  } as unknown as Response;
});
vi.stubGlobal('fetch', fetchMock);

const { runAnalytics } = await import('./ai-provider');

function setModelText(text: string) {
  nextResponse = {
    ok: true,
    json: { candidates: [{ content: { parts: [{ text }] } }] },
  };
}

const sampleEmails = [
  { from: 'a@x.com', subject: 'S1', snippet: 'snip 1' },
  { from: 'b@x.com', subject: 'S2', snippet: 'snip 2' },
];

beforeEach(() => {
  store.clear();
  store.set('geminiApiKey', 'FAKE_KEY_FOR_TEST');
  setModelText('');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runAnalytics — invalid Gemini JSON is silently swallowed', () => {
  it('refusal text "Sorry, I can\'t help with that." → no throw, returns fallback', async () => {
    const refusal = "Sorry, I can't help with that.";
    setModelText(refusal);

    const out = await runAnalytics(sampleEmails);

    // Did not throw
    expect(out).toBeDefined();
    // Fallback shape is returned
    expect(out.totalAnalyzed).toBe(sampleEmails.length);
    expect(out.urgentCount).toBe(0);
    expect(out.overallMood).toBe('Neutral');
    expect(Array.isArray(out.categories)).toBe(true);
    expect(Array.isArray(out.sentiments)).toBe(true);
    // The refusal text is NOT surfaced anywhere in the return value
    expect(JSON.stringify(out)).not.toContain(refusal);
  });

  it('truncated "{ invalid json" → no throw, returns fallback', async () => {
    const garbage = '{ invalid json';
    setModelText(garbage);

    const out = await runAnalytics(sampleEmails);

    expect(out).toBeDefined();
    expect(out.totalAnalyzed).toBe(sampleEmails.length);
    expect(out.urgentCount).toBe(0);
    expect(out.overallMood).toBe('Neutral');
    expect(JSON.stringify(out)).not.toContain(garbage);
  });

  it('markdown-fenced garbage "```json\\n{ urgentCount: \'oops\' }\\n```" → no throw, returns fallback', async () => {
    const garbage = "```json\n{ urgentCount: 'oops' }\n```";
    setModelText(garbage);

    const out = await runAnalytics(sampleEmails);

    expect(out).toBeDefined();
    expect(out.totalAnalyzed).toBe(sampleEmails.length);
    expect(out.urgentCount).toBe(0); // not NaN, not 1 — true fallback
    expect(out.overallMood).toBe('Neutral');
    expect(JSON.stringify(out)).not.toContain(garbage);
    expect(JSON.stringify(out)).not.toContain('oops');
  });

  it('console.error is called AND the raw Gemini response IS included in the log (fix for silent failure)', async () => {
    const refusal = "Sorry, I can't help with that.";
    setModelText(refusal);

    await runAnalytics(sampleEmails);

    const errorSpy = console.error as unknown as ReturnType<typeof vi.fn>;
    expect(errorSpy).toHaveBeenCalled();

    // Concatenate every argument the spy was called with into one searchable blob.
    const allCalls = errorSpy.mock.calls
      .map((args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
      .join('\n');

    // The wrapper prefix is logged:
    expect(allCalls).toContain('runAnalytics failed');

    // The raw model text IS now included in the error log so a developer
    // debugging the extension can see what Gemini actually said.
    expect(allCalls).toContain(refusal);
    expect(allCalls).toContain("can't help");
  });
});
