/**
 * Verification harness for Issue 2b: silent JSON-parse fallback in parseThreadTimeline.
 *
 * parseThreadTimeline() calls callGemini() expecting a JSON array matching
 * a documented schema. If parsing fails — refusal, truncated JSON, garbage
 * inside a markdown fence — the function logs to console.error and returns
 * a fabricated fallback timeline (one update-node per input message).
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

const { parseThreadTimeline } = await import('./ai-provider');

function setModelText(text: string) {
  nextResponse = {
    ok: true,
    json: { candidates: [{ content: { parts: [{ text }] } }] },
  };
}

const sampleMessages = [
  { from: 'Alice <a@x.com>', subject: 'Hello', body: 'hi there' },
  { from: 'Bob <b@x.com>', subject: 'Re: Hello', body: 'reply' },
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

describe('parseThreadTimeline — invalid Gemini JSON is silently swallowed', () => {
  it('refusal text "Sorry, I can\'t help with that." → no throw, returns fallback', async () => {
    const refusal = "Sorry, I can't help with that.";
    setModelText(refusal);

    const out = await parseThreadTimeline(sampleMessages);

    expect(out).toBeDefined();
    expect(Array.isArray(out)).toBe(true);
    // Fallback: one update-node per input message
    expect(out.length).toBe(sampleMessages.length);
    expect(out.every((n) => n.type === 'update')).toBe(true);
    // Raw refusal text is NOT in the returned timeline
    expect(JSON.stringify(out)).not.toContain(refusal);
  });

  it('truncated "{ invalid json" → no throw, returns fallback', async () => {
    const garbage = '{ invalid json';
    setModelText(garbage);

    const out = await parseThreadTimeline(sampleMessages);

    expect(out).toBeDefined();
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBe(sampleMessages.length);
    expect(out.every((n) => n.type === 'update')).toBe(true);
    expect(JSON.stringify(out)).not.toContain(garbage);
  });

  it('markdown-fenced garbage "```json\\n{ urgentCount: \'oops\' }\\n```" → no throw, returns fallback', async () => {
    const garbage = "```json\n{ urgentCount: 'oops' }\n```";
    setModelText(garbage);

    const out = await parseThreadTimeline(sampleMessages);

    expect(out).toBeDefined();
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBe(sampleMessages.length);
    expect(out.every((n) => n.type === 'update')).toBe(true);
    expect(JSON.stringify(out)).not.toContain(garbage);
    expect(JSON.stringify(out)).not.toContain('oops');
  });

  it('console.error is called AND the raw Gemini response IS included in the log (fix for silent failure)', async () => {
    const refusal = "Sorry, I can't help with that.";
    setModelText(refusal);

    await parseThreadTimeline(sampleMessages);

    const errorSpy = console.error as unknown as ReturnType<typeof vi.fn>;
    expect(errorSpy).toHaveBeenCalled();

    const allCalls = errorSpy.mock.calls
      .map((args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
      .join('\n');

    // The wrapper prefix is logged:
    expect(allCalls).toContain('parseThreadTimeline failed');

    // The raw model text IS now included in the error log.
    expect(allCalls).toContain(refusal);
    expect(allCalls).toContain("can't help");
  });
});
