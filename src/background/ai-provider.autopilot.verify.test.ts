/**
 * Verification harness for Issue 1: evaluateRuleMatch false-positive risk.
 *
 * The implementation under test is:
 *   return /^\s*YES(?:[ \t\n\r,.!?;:]|$)/i.test(raw.trim());
 * (see src/background/ai-provider.ts, evaluateRuleMatch, near the bottom of the file)
 *
 * The regex anchors on the first non-whitespace token: the reply must START
 * with "YES" (modulo leading whitespace) and be followed by whitespace,
 * end-of-string, or terminal punctuation. This rejects both substring matches
 * ("I wouldn't say YES to that.") and hyphenated tokens ("YES-terday's newsletter")
 * that the model's prompt instructs it not to produce.
 *
 * This file drives the real evaluateRuleMatch() function end-to-end by
 * stubbing chrome.storage.local (so the API key lookup works) and
 * stubbing globalThis.fetch (so we can return whatever the model
 * "would have" returned for each case).
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
let nextResponse: { ok: boolean; status?: number; json: unknown; throw?: boolean } = {
  ok: true,
  json: { candidates: [{ content: { parts: [{ text: '' }] } }] },
};

const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => {
  if (nextResponse.throw) {
    throw new Error('simulated network failure');
  }
  return {
    ok: nextResponse.ok,
    status: nextResponse.status ?? 200,
    json: async () => nextResponse.json,
  } as unknown as Response;
});
vi.stubGlobal('fetch', fetchMock);

// Import after stubs are in place
const { evaluateRuleMatch } = await import('./ai-provider');

function setModelText(text: string) {
  nextResponse = {
    ok: true,
    json: { candidates: [{ content: { parts: [{ text }] } }] },
  };
}

beforeEach(() => {
  store.clear();
  store.set('geminiApiKey', 'FAKE_KEY_FOR_TEST');
  setModelText('');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('evaluateRuleMatch — robustness of the YES/NO check', () => {
  // ── Correct accept cases ───────────────────────────────────────────────────
  it('"YES" → true', async () => {
    setModelText('YES');
    const out = await evaluateRuleMatch('body', 'subj', 'from', 'criteria');
    expect(out).toBe(true);
  });

  it('"yes" → true (case-insensitive)', async () => {
    setModelText('yes');
    const out = await evaluateRuleMatch('body', 'subj', 'from', 'criteria');
    expect(out).toBe(true);
  });

  it('" YES \\n" → true (whitespace tolerated)', async () => {
    setModelText(' YES \n');
    const out = await evaluateRuleMatch('body', 'subj', 'from', 'criteria');
    expect(out).toBe(true);
  });

  // ── False-positive cases (now correctly rejected by the anchored regex) ───
  it('"YES-terday\'s newsletter" → false (hyphen is not a valid YES terminator)', async () => {
    setModelText("YES-terday's newsletter");
    const out = await evaluateRuleMatch('body', 'subj', 'from', 'criteria');
    // The anchored regex /^\s*YES(?:[ \t\n\r,.!?;:]|$)/i requires YES to be
    // followed by whitespace, terminal punctuation, or end-of-string. The
    // hyphen here is not in the terminator set, so the regex rejects the reply.
    expect(out).toBe(false);
  });

  it('"I wouldn\'t say YES to that." → false (prose with YES in the middle)', async () => {
    setModelText("I wouldn't say YES to that.");
    const out = await evaluateRuleMatch('body', 'subj', 'from', 'criteria');
    // The reply does not start with YES, so the anchored regex returns false.
    expect(out).toBe(false);
  });

  // ── Additional anchored-regex edge cases ──────────────────────────────────
  it('"YES!" → true (exclamation is a valid terminator)', async () => {
    setModelText('YES!');
    const out = await evaluateRuleMatch('body', 'subj', 'from', 'criteria');
    expect(out).toBe(true);
  });

  it('"YES\\nMore text" → true (newline is a valid terminator)', async () => {
    setModelText('YES\nMore text');
    const out = await evaluateRuleMatch('body', 'subj', 'from', 'criteria');
    expect(out).toBe(true);
  });

  it('" yes \\nSure thing" → true (lowercase + leading whitespace + space terminator)', async () => {
    setModelText(' yes \nSure thing');
    const out = await evaluateRuleMatch('body', 'subj', 'from', 'criteria');
    expect(out).toBe(true);
  });

  it('"\\nYES" → true (newline-prefixed, end-of-string terminator)', async () => {
    setModelText('\nYES');
    const out = await evaluateRuleMatch('body', 'subj', 'from', 'criteria');
    expect(out).toBe(true);
  });

  it('"YES, definitely" → true (comma is a valid terminator)', async () => {
    setModelText('YES, definitely');
    const out = await evaluateRuleMatch('body', 'subj', 'from', 'criteria');
    expect(out).toBe(true);
  });

  it('"YES: affirmative" → true (colon is a valid terminator)', async () => {
    setModelText('YES: affirmative');
    const out = await evaluateRuleMatch('body', 'subj', 'from', 'criteria');
    expect(out).toBe(true);
  });

  it('"yesterday" → false (YES not at start)', async () => {
    setModelText('yesterday');
    const out = await evaluateRuleMatch('body', 'subj', 'from', 'criteria');
    expect(out).toBe(false);
  });

  it('"YES_NO" → false (underscore is not a valid terminator)', async () => {
    setModelText('YES_NO');
    const out = await evaluateRuleMatch('body', 'subj', 'from', 'criteria');
    expect(out).toBe(false);
  });

  it('"NOPE" → false', async () => {
    setModelText('NOPE');
    const out = await evaluateRuleMatch('body', 'subj', 'from', 'criteria');
    expect(out).toBe(false);
  });

  // ── Correct reject cases ───────────────────────────────────────────────────
  it('"NO" → false', async () => {
    setModelText('NO');
    const out = await evaluateRuleMatch('body', 'subj', 'from', 'criteria');
    expect(out).toBe(false);
  });

  it('"Maybe." → false', async () => {
    setModelText('Maybe.');
    const out = await evaluateRuleMatch('body', 'subj', 'from', 'criteria');
    expect(out).toBe(false);
  });

  it('"" (empty) → false', async () => {
    setModelText('');
    const out = await evaluateRuleMatch('body', 'subj', 'from', 'criteria');
    expect(out).toBe(false);
  });

  // ── Error path ─────────────────────────────────────────────────────────────
  it('callGemini throws → false (no crash, no match)', async () => {
    nextResponse = { ok: true, json: {}, throw: true };
    const out = await evaluateRuleMatch('body', 'subj', 'from', 'criteria');
    expect(out).toBe(false);
  });
});
