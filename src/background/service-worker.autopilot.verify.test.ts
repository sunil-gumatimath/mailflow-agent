/**
 * Verification harness for Issue #4 + #5: per-tick/per-rule caps and
 * cross-rule action dedup in computeAutopilotActions.
 *
 * computeAutopilotActions() is a pure-ish planner: given a batch of emails,
 * a set of rules, and a `matches` predicate, it returns the list of actions
 * that should be queued. The plan must:
 *   - Cap the input batch at MAX_EMAILS_PER_TICK.
 *   - Skip disabled rules.
 *   - Deduplicate across rules by (type, messageId, labelId).
 *   - Cap the actions per (rule, message) at MAX_ACTIONS_PER_RULE_PER_RUN.
 *
 * This test exercises the planner in isolation, with a controlled
 * `matches` predicate so the assertions are deterministic.
 *
 * NOTE: service-worker.ts uses chrome.* at module top-level (alarms,
 * message listeners, onInstalled hook), so the chrome global must exist
 * BEFORE the dynamic import below. We set it up here, then dynamic-import.
 */

// ── chrome global stub (synchronous, runs before the dynamic import) ──────────
const chromeMock = {
  runtime: {
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    onMessage: { addListener: () => {} },
    sendMessage: () => {},
  },
  alarms: {
    create: () => {},
    onAlarm: { addListener: () => {} },
  },
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {},
    },
  },
  sidePanel: { setOptions: async () => {} },
  identity: { getAuthToken: async () => {} },
  tabs: {},
};
(globalThis as unknown as { chrome: typeof chromeMock }).chrome = chromeMock;

import { describe, it, expect } from 'vitest';
import type { AutoPilotRule } from '../shared/types';

// Dynamic imports so the chrome mock (set up synchronously above) is in place
// BEFORE service-worker.ts is evaluated (it references chrome.* at module top
// level for the alarms and message-router listeners).
const swPromise = import('./service-worker');
const { computeAutopilotActions, MAX_EMAILS_PER_TICK, MAX_ACTIONS_PER_RULE_PER_RUN } = await swPromise;
import type { AutopilotEmailInput } from './service-worker';

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeEmail(id: string, subject = 'subj', from = 'a@x.com', body = 'body'): AutopilotEmailInput {
  return { id, subject, from, body };
}

function makeRule(overrides: Partial<AutoPilotRule> = {}): AutoPilotRule {
  return {
    id: overrides.id ?? 'rule-' + Math.random().toString(36).slice(2, 8),
    name: overrides.name ?? 'Test rule',
    filter: overrides.filter ?? 'criteria',
    actions: {
      archive: false,
      markRead: false,
      star: false,
      labelId: null,
      ...overrides.actions,
    },
    enabled: overrides.enabled ?? true,
    createdAt: overrides.createdAt ?? Date.now(),
  };
}

const neverMatches = async () => false;
const alwaysMatches = async () => true;

// ── Tests ────────────────────────────────────────────────────────────────────
describe('computeAutopilotActions — caps and dedup', () => {
  it('exposes the cap constants (sanity check that the test targets the right module)', () => {
    expect(MAX_EMAILS_PER_TICK).toBe(20);
    expect(MAX_ACTIONS_PER_RULE_PER_RUN).toBe(4);
  });

  it('returns an empty array when no rules are enabled', async () => {
    const out = await computeAutopilotActions(
      [makeEmail('m1')],
      [makeRule({ enabled: false })],
      alwaysMatches,
    );
    expect(out).toEqual([]);
  });

  it('returns an empty array when the matches predicate is always false', async () => {
    const out = await computeAutopilotActions(
      [makeEmail('m1'), makeEmail('m2')],
      [makeRule({ actions: { archive: true, markRead: true, star: true, labelId: null } })],
      neverMatches,
    );
    expect(out).toEqual([]);
  });

  it('cross-rule dedup: two rules both archive the same email → exactly ONE ARCHIVE_EMAIL', async () => {
    const email = makeEmail('m-dup');
    const ruleA = makeRule({ id: 'A', name: 'A', actions: { archive: true, markRead: false, star: false, labelId: null } });
    const ruleB = makeRule({ id: 'B', name: 'B', actions: { archive: true, markRead: false, star: false, labelId: null } });

    const out = await computeAutopilotActions([email], [ruleA, ruleB], alwaysMatches);

    const archiveActions = out.filter((a) => a.type === 'ARCHIVE_EMAIL' && a.messageId === 'm-dup');
    expect(archiveActions).toHaveLength(1);
    // The reason should mention one of the two rule names (whichever won the race).
    expect(archiveActions[0]!.reason).toMatch(/Auto-pilot: matched "(A|B)"/);
  });

  it('cross-rule dedup: ruleA archives, ruleB marks-read, both match same email → BOTH actions queued (different types)', async () => {
    const email = makeEmail('m-mix');
    const ruleA = makeRule({ id: 'A', actions: { archive: true, markRead: false, star: false, labelId: null } });
    const ruleB = makeRule({ id: 'B', actions: { archive: false, markRead: true, star: false, labelId: null } });

    const out = await computeAutopilotActions([email], [ruleA, ruleB], alwaysMatches);

    const types = out.map((a) => a.type).sort();
    expect(types).toEqual(['ARCHIVE_EMAIL', 'MARK_READ']);
  });

  it('cross-rule dedup: same LABEL action from two rules → only ONE LABEL_EMAIL per (type, messageId, labelId) tuple', async () => {
    const email = makeEmail('m-lbl');
    const ruleA = makeRule({ id: 'A', actions: { archive: false, markRead: false, star: false, labelId: 'Label_1' } });
    const ruleB = makeRule({ id: 'B', actions: { archive: false, markRead: false, star: false, labelId: 'Label_1' } });

    const out = await computeAutopilotActions([email], [ruleA, ruleB], alwaysMatches);

    const labelActions = out.filter((a) => a.type === 'LABEL_EMAIL' && a.messageId === 'm-lbl');
    expect(labelActions).toHaveLength(1);
    expect(labelActions[0]!.labelId).toBe('Label_1');
  });

  it('cross-rule dedup: same rule type with DIFFERENT labelIds → both queued (labelId is part of the dedup key)', async () => {
    const email = makeEmail('m-multi');
    const ruleA = makeRule({ id: 'A', actions: { archive: false, markRead: false, star: false, labelId: 'Label_1' } });
    const ruleB = makeRule({ id: 'B', actions: { archive: false, markRead: false, star: false, labelId: 'Label_2' } });

    const out = await computeAutopilotActions([email], [ruleA, ruleB], alwaysMatches);

    const labelActions = out.filter((a) => a.type === 'LABEL_EMAIL' && a.messageId === 'm-multi');
    expect(labelActions).toHaveLength(2);
    expect(labelActions.map((a) => a.labelId).sort()).toEqual(['Label_1', 'Label_2']);
  });

  it('a rule with all 4 actions matching → exactly 4 actions queued (one per type)', async () => {
    const email = makeEmail('m-all');
    const rule = makeRule({
      actions: { archive: true, markRead: true, star: true, labelId: 'MyLabel' },
    });

    const out = await computeAutopilotActions([email], [rule], alwaysMatches);

    expect(out).toHaveLength(4);
    const types = out.map((a) => a.type).sort();
    expect(types).toEqual(['ARCHIVE_EMAIL', 'LABEL_EMAIL', 'MARK_READ', 'STAR_EMAIL']);
  });

  it('MAX_EMAILS_PER_TICK cap: 25 input messages → output references at most 20 distinct messageIds', async () => {
    const messages: AutopilotEmailInput[] = [];
    for (let i = 0; i < 25; i++) messages.push(makeEmail(`m-${i}`));
    const rule = makeRule({ actions: { archive: true, markRead: false, star: false, labelId: null } });

    const out = await computeAutopilotActions(messages, [rule], alwaysMatches);

    const distinctIds = new Set(out.map((a) => a.messageId));
    expect(distinctIds.size).toBeLessThanOrEqual(MAX_EMAILS_PER_TICK);
    expect(distinctIds.size).toBe(MAX_EMAILS_PER_TICK);
    // And specifically, the first MAX_EMAILS_PER_TICK ids must be the ones processed.
    const expected = new Set(Array.from({ length: MAX_EMAILS_PER_TICK }, (_, i) => `m-${i}`));
    expect(distinctIds).toEqual(expected);
  });

  it('disabled rules are skipped entirely, even when their actions would match', async () => {
    const email = makeEmail('m-off');
    const disabled = makeRule({ enabled: false, actions: { archive: true, markRead: true, star: true, labelId: 'L' } });
    const enabled = makeRule({ enabled: true, actions: { archive: true, markRead: false, star: false, labelId: null } });

    const out = await computeAutopilotActions([email], [disabled, enabled], alwaysMatches);

    // Only the enabled rule's archive action should appear.
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe('ARCHIVE_EMAIL');
  });

  it('the matches predicate receives (body, subject, from, filter) in that order', async () => {
    const seen: Array<{ body: string; subject: string; from: string; filter: string }> = [];
    const recordingMatches = async (body: string, subject: string, from: string, filter: string) => {
      seen.push({ body, subject, from, filter });
      return true;
    };
    const email = makeEmail('m-rec', 'Hello there', 'alice@example.com', 'email body content');
    const rule = makeRule({ filter: 'criteria' });

    await computeAutopilotActions([email], [rule], recordingMatches);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      body: 'email body content',
      subject: 'Hello there',
      from: 'alice@example.com',
      filter: 'criteria',
    });
  });

  it('risk levels are correct per action type (STAR = LOW, others = MEDIUM)', async () => {
    const email = makeEmail('m-risk');
    const rule = makeRule({
      actions: { archive: true, markRead: true, star: true, labelId: 'L' },
    });

    const out = await computeAutopilotActions([email], [rule], alwaysMatches);
    const byType = new Map(out.map((a) => [a.type, a.riskLevel]));
    expect(byType.get('ARCHIVE_EMAIL')).toBe('MEDIUM');
    expect(byType.get('MARK_READ')).toBe('MEDIUM');
    expect(byType.get('STAR_EMAIL')).toBe('LOW');
    expect(byType.get('LABEL_EMAIL')).toBe('MEDIUM');
  });
});
