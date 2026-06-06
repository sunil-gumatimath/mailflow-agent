/**
 * background/service-worker.ts
 * Main background service worker — central message router for InboxCommander.
 *
 * All event listeners are registered at the top level (MV3 requirement).
 * Uses ES module imports from sibling modules.
 */

import { MESSAGE_TYPES, DEFAULT_SETTINGS, RISK_LEVELS } from '../shared/constants';
import { createResponse } from '../shared/message-types';
import { parseEmailBody, extractHeaders, sanitizeForAI, createMimeMessage } from '../shared/utils';

import { isAuthenticated, getAuthTokenInteractive, revokeAuth } from './auth';

import * as gmailApi from './gmail-api';

import {
  summarizeEmail,
  summarizeThread,
  classifyEmail,
  draftReply,
  translateToGmailQuery,
  chatWithAgent,
  getApiKey,
  summarizeInbox,
  findPriorityEmails,
  summarizeUnread,
  evaluateRuleMatch,
  runAnalytics,
  parseThreadTimeline,
} from './ai-provider';
import type { InboxEmailInput } from './ai-provider';

import {
  queueAction,
  getPendingActions,
  approveAction,
  rejectAction,
  editAction,
  getActionLog,
  getSettings,
  clearActionLog,
} from './action-queue';
import { getRules } from '../shared/storage';
import type { ExtensionResponse, ThreadMessageInput, AutoPilotRule } from '../shared/types';

// ── Install / Update ───────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details: chrome.runtime.InstalledDetails) => {
  console.log(`[InboxCommander] Installed — reason: ${details.reason}`);

  // Seed default settings on first install
  if (details.reason === 'install') {
    const existing = await chrome.storage.local.get('extension_settings');
    if (!existing.extension_settings) {
      await chrome.storage.local.set({ extension_settings: { ...DEFAULT_SETTINGS } });
    }
  }

  // Set side-panel behaviour — open on action click for Gmail tabs
  if (chrome.sidePanel?.setOptions) {
    await chrome.sidePanel.setOptions({ enabled: true });
  }

  // Set up background alarm for auto-pilot rules checking (every 15 minutes)
  chrome.alarms.create('check_autopilot', { periodInMinutes: 15 });
});

// MV3 edge case: alarms can be lost across browser restarts. Re-register on startup
// so the autopilot tick keeps firing after the user restarts Chrome.
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('check_autopilot', { periodInMinutes: 15 });
});
// ── Central message router ─────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((err: any) => {
        console.error(`[InboxCommander] Message handler error:`, err);
        sendResponse(createResponse(false, null, err.message));
      });

    // Return true — we WILL call sendResponse asynchronously

    return true;
  },
);

interface ResolvedEmailData {
  body: string;
  subject: string;
  from: string;
  emailId?: string;
  threadId?: string;
  payload?: any;
}

/**
 * Resolve email data from either passed content or by fetching from ID/threadId.
 */
async function resolveEmailData(data: any = {}, message: any = {}): Promise<ResolvedEmailData> {
  // Check if we already have the body/payload, subject, and sender
  const body = data.body || message.body || null;
  const payload = data.payload || message.payload || null;
  const subject = data.subject || message.subject || null;
  const from = data.from || message.from || null;

  if ((body || payload) && subject && from) {
    return { body, payload, subject, from };
  }

  // Otherwise, we need to fetch using messageId or threadId
  let messageId = data.emailId || message.emailId || data.messageId || message.messageId || null;
  const threadId = data.threadId || message.threadId || null;

  if (!messageId && threadId) {
    // Get the thread and use the latest message
    const thread = await gmailApi.getThread(threadId);
    if (thread?.messages?.length) {
      const latestMsg = thread.messages[thread.messages.length - 1];
      if (latestMsg) {
        messageId = latestMsg.id;
      }
    }
  }

  if (messageId) {
    const msg = await gmailApi.getMessage(messageId);
    const headers = extractHeaders(msg.payload?.headers);
    return {
      body: parseEmailBody(msg.payload),
      subject: headers['subject'] || '',
      from: headers['from'] || '',
      emailId: messageId,
      threadId: msg.threadId || threadId,
      payload: msg.payload,
    };
  }

  throw new Error('No email message details or thread ID available.');
}

/**
 * Fetch a set of inbox emails and shape them for the AI provider.
 */
async function fetchInboxForAI(
  query: string = 'label:INBOX',
  maxResults: number = 25,
): Promise<InboxEmailInput[]> {
  const stubs = await gmailApi.listMessages(query, maxResults);
  const messages = await Promise.all(stubs.map((s) => gmailApi.getMessage(s.id)));
  return messages.map((msg) => {
    const headers = extractHeaders(msg.payload?.headers);
    return {
      from: headers['from'] || '',
      subject: headers['subject'] || '',
      date: headers['date'] || '',
      snippet: msg.snippet || '',
      body: sanitizeForAI(parseEmailBody(msg.payload)),
    };
  });
}

async function getConfiguredMaxEmails(fallback: number = 25): Promise<number> {
  const settings = await getSettings();
  const maxEmails = Number(settings.maxEmails);
  if (!Number.isFinite(maxEmails)) return fallback;
  return Math.min(Math.max(Math.floor(maxEmails), 1), 500);
}

/**
 * Route a message to the appropriate handler.
 * Always returns a createResponse(...) object.
 */
async function handleMessage(message: any): Promise<ExtensionResponse> {
  const { type, data = {} } = message;

  try {
    switch (type) {
      // ── Auth ───────────────────────────────────────────────────────────────
      case MESSAGE_TYPES.AUTH_STATUS: {
        const authenticated = await isAuthenticated();
        let email: string | null = null;
        if (authenticated) {
          try {
            const profile = await gmailApi.getProfile();
            email = profile.emailAddress;
          } catch {
            // Ignore profile fetch failure
          }
        }
        return createResponse(true, { authenticated, email });
      }

      case MESSAGE_TYPES.AUTH_LOGIN: {
        await getAuthTokenInteractive();
        let email: string | null = null;
        try {
          const profile = await gmailApi.getProfile();
          email = profile.emailAddress;
        } catch {
          // Ignore
        }
        return createResponse(true, { authenticated: true, email });
      }

      case MESSAGE_TYPES.AUTH_LOGOUT: {
        await revokeAuth();
        return createResponse(true, { authenticated: false });
      }

      // ── Profile ────────────────────────────────────────────────────────────
      case MESSAGE_TYPES.GET_PROFILE: {
        const profile = await gmailApi.getProfile();
        return createResponse(true, profile);
      }

      // ── Emails ─────────────────────────────────────────────────────────────
      case MESSAGE_TYPES.GET_EMAILS: {
        const query = data.query ?? message.query;
        const maxResults = data.maxResults ?? message.maxResults;
        const stubs = await gmailApi.listMessages(query, maxResults);
        // Hydrate each stub with full message data
        const messages = await Promise.all(stubs.map((s) => gmailApi.getMessage(s.id)));
        return createResponse(true, messages);
      }

      case MESSAGE_TYPES.GET_EMAIL: {
        const messageId = data.messageId ?? message.messageId;
        const format = data.format ?? message.format;
        const msg = await gmailApi.getMessage(messageId, format);
        return createResponse(true, msg);
      }

      case MESSAGE_TYPES.GET_THREAD: {
        const threadId = data.threadId ?? message.threadId;
        const format = data.format ?? message.format;
        const thread = await gmailApi.getThread(threadId, format);
        return createResponse(true, thread);
      }

      case MESSAGE_TYPES.GET_UNREAD_COUNT: {
        const count = await gmailApi.getUnreadCount();
        return createResponse(true, { count });
      }

      case MESSAGE_TYPES.BATCH_MODIFY: {
        const ids = data.ids ?? message.ids;
        const addLabelIds = data.addLabelIds ?? message.addLabelIds ?? [];
        const removeLabelIds = data.removeLabelIds ?? message.removeLabelIds ?? [];
        if (!Array.isArray(ids) || ids.length === 0) {
          throw new Error('At least one message ID is required for batch modify.');
        }
        const action = await queueAction({
          type: 'BATCH_MODIFY',
          params: { ids, addLabelIds, removeLabelIds },
          reason:
            data.reason ??
            message.reason ??
            `Modify ${ids.length} email${ids.length === 1 ? '' : 's'}`,
          riskLevel: RISK_LEVELS.HIGH,
        });
        return createResponse(true, action);
      }

      // ── Search ─────────────────────────────────────────────────────────────
      case MESSAGE_TYPES.SEARCH_EMAILS: {
        let query = data.query ?? message.query ?? '';
        const maxResults = data.maxResults ?? message.maxResults;
        const naturalLanguage = data.naturalLanguage ?? message.naturalLanguage;

        // If the caller wants natural-language translation
        if (naturalLanguage) {
          query = await translateToGmailQuery(query);
        }

        const results = await gmailApi.searchMessages(query, maxResults);
        return createResponse(true, { query, results });
      }

      // ── Gmail Context Change (from content script) ─────────────────────────
      case 'GMAIL_CONTEXT_CHANGE': {
        const context = data.context ?? message.context;
        // We accept both hex (legacy) and base64url (current) Gmail IDs. The
        // Gmail API resolves either format, so we no longer gate on isValidHexId.
        const hasUsableId = (id: string | null | undefined): boolean =>
          typeof id === 'string' && id.length >= 8;

        if (context && context.view === 'thread') {
          try {
            let threadId: string | null = context.threadId ?? null;
            let emailId: string | null = context.emailId ?? null;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let latestMsg: any = null;

            // Prefer the emailId (most specific). If we don't have one yet
            // (the content script only resolves it from the DOM), fall back
            // to the threadId and pick the latest message in the thread.
            if (emailId && hasUsableId(emailId)) {
              try {
                const msg = await gmailApi.getMessage(emailId);
                latestMsg = msg;
                if (msg.threadId) threadId = msg.threadId;
              } catch {
                // Email may have been deleted or moved; fall through to thread.
                emailId = null;
              }
            }
            if (!latestMsg && threadId && hasUsableId(threadId)) {
              const thread = await gmailApi.getThread(threadId);
              if (thread?.messages?.length) {
                latestMsg = thread.messages[thread.messages.length - 1];
                if (latestMsg) emailId = latestMsg.id ?? emailId;
              }
            }

            if (latestMsg) {
              const headers = extractHeaders(latestMsg.payload?.headers);
              const from = headers['from'] || '';
              const subject = headers['subject'] || '';
              const body = parseEmailBody(latestMsg.payload);

              let priority = 'NORMAL';
              let category = 'WORK';

              try {
                const apiKey = await getApiKey();
                if (apiKey) {
                  const classification = await classifyEmail(sanitizeForAI(body), subject, from);
                  priority = classification.priority || 'NORMAL';
                  category = classification.category || 'WORK';
                }
              } catch (aiErr) {
                console.warn('[InboxCommander] Context auto-classification failed:', aiErr);
              }

              chrome.runtime
                .sendMessage({
                  type: MESSAGE_TYPES.EMAIL_CONTEXT_UPDATE,
                  context: {
                    threadId,
                    emailId,
                    subject,
                    from,
                    body,
                    priority,
                    category,
                  },
                })
                .catch(() => {});
            }
          } catch (err) {
            console.error('[InboxCommander] GMAIL_CONTEXT_CHANGE processing failed:', err);
          }
        } else {
          chrome.runtime
            .sendMessage({
              type: MESSAGE_TYPES.EMAIL_CONTEXT_CLEAR,
            })
            .catch(() => {});
        }
        return createResponse(true);
      }

      // ── AI operations ──────────────────────────────────────────────────────
      case MESSAGE_TYPES.CLASSIFY_EMAIL: {
        const resolved = await resolveEmailData(data, message);
        const sanitized = sanitizeForAI(resolved.body ?? parseEmailBody(resolved.payload));
        const classification = await classifyEmail(sanitized, resolved.subject, resolved.from);
        return createResponse(true, classification);
      }

      case MESSAGE_TYPES.SUMMARIZE_EMAIL: {
        const resolved = await resolveEmailData(data, message);
        const sanitized = sanitizeForAI(resolved.body ?? parseEmailBody(resolved.payload));
        const summary = await summarizeEmail(sanitized, resolved.subject, resolved.from);
        return createResponse(true, { reply: summary, summary });
      }

      case MESSAGE_TYPES.SUMMARIZE_THREAD: {
        let messagesList = data.messages ?? message.messages ?? [];
        const threadId = data.threadId ?? message.threadId;

        if ((!messagesList || messagesList.length === 0) && threadId) {
          const thread = await gmailApi.getThread(threadId);
          if (thread?.messages) {
            messagesList = thread.messages.map((m: any) => {
              const headers = extractHeaders(m.payload?.headers);
              return {
                from: headers['from'] || '',
                subject: headers['subject'] || '',
                body: parseEmailBody(m.payload),
              };
            });
          }
        }

        const threadMessages: ThreadMessageInput[] = messagesList.map((m: any) => ({
          from: m.from,
          subject: m.subject,
          body: sanitizeForAI(m.body),
        }));
        const summary = await summarizeThread(threadMessages);
        return createResponse(true, { reply: summary, summary });
      }

      case MESSAGE_TYPES.DRAFT_REPLY: {
        const resolved = await resolveEmailData(data, message);
        const sanitized = sanitizeForAI(resolved.body ?? '');
        const settings = await getSettings();
        const baseInstruction = data.instruction ?? message.instruction ?? 'Draft a reply.';
        
        const tone = data.tone ?? message.tone ?? settings.writingTone ?? 'professional';
        const length = data.length ?? message.length ?? 'medium';
        
        let lengthInstruction = '';
        if (length === 'short') {
          lengthInstruction = 'Keep the reply extremely short and direct (1-2 sentences).';
        } else if (length === 'long') {
          lengthInstruction = 'Write a detailed, thorough response addressing all points in detail, including appropriate greetings and closings.';
        } else {
          lengthInstruction = 'Keep the reply moderate in length (1-2 short paragraphs).';
        }

        const toneInstruction = `Use a ${tone} tone. ${lengthInstruction} ${baseInstruction}`;

        const replyBody = await draftReply(
          sanitized,
          resolved.subject,
          resolved.from,
          toneInstruction,
          data.userName ?? message.userName ?? settings.userName ?? '',
          data.userSignature ?? message.userSignature ?? settings.emailSignature ?? '',
        );
        return createResponse(true, { reply: replyBody, replyBody });
      }

      // ── Inbox-wide quick actions ───────────────────────────────────────────
      case MESSAGE_TYPES.SUMMARIZE_INBOX: {
        const maxResults =
          data.maxResults ?? message.maxResults ?? (await getConfiguredMaxEmails());
        const emails = await fetchInboxForAI('label:INBOX', maxResults);
        const summary = await summarizeInbox(emails);
        return createResponse(true, { reply: summary, summary });
      }

      case MESSAGE_TYPES.PRIORITY_EMAILS: {
        const maxResults =
          data.maxResults ?? message.maxResults ?? (await getConfiguredMaxEmails());
        const emails = await fetchInboxForAI('label:INBOX', maxResults);
        const reply = await findPriorityEmails(emails);
        return createResponse(true, { reply });
      }

      case MESSAGE_TYPES.UNREAD_EMAILS: {
        const maxResults =
          data.maxResults ?? message.maxResults ?? (await getConfiguredMaxEmails());
        const emails = await fetchInboxForAI('is:unread', maxResults);
        const reply = await summarizeUnread(emails);
        return createResponse(true, { reply });
      }

      case MESSAGE_TYPES.CHAT: {
        const resolvedMessage = data.message ?? message.message;
        const resolvedContext =
          data.emailContext ?? message.emailContext ?? data.context ?? message.context ?? null;
        const resolvedHistory =
          data.conversationHistory ??
          message.conversationHistory ??
          data.history ??
          message.history ??
          [];

        const response = await chatWithAgent(resolvedMessage, resolvedContext, resolvedHistory);
        return createResponse(true, { reply: response, response });
      }

      // ── Queued actions (risk-gated) ────────────────────────────────────────
      case MESSAGE_TYPES.SEND_EMAIL: {
        const raw = data.raw ?? message.raw ?? createMimeMessage(data);
        const threadId = data.threadId ?? message.threadId;
        const reason = data.reason ?? message.reason ?? 'Send email';
        const action = await queueAction({
          type: 'SEND_EMAIL',
          params: { raw, threadId },
          reason,
          riskLevel: RISK_LEVELS.HIGH,
        });
        return createResponse(true, action);
      }

      case MESSAGE_TYPES.TRASH_EMAIL: {
        const messageId = data.messageId ?? message.messageId;
        const reason = data.reason ?? message.reason ?? 'Trash email';
        const action = await queueAction({
          type: 'TRASH_EMAIL',
          params: { messageId },
          reason,
          riskLevel: RISK_LEVELS.HIGH,
        });
        return createResponse(true, action);
      }

      case MESSAGE_TYPES.ARCHIVE_EMAIL: {
        const messageId = data.messageId ?? message.messageId;
        const reason = data.reason ?? message.reason ?? 'Archive email';
        const action = await queueAction({
          type: 'ARCHIVE_EMAIL',
          params: { messageId },
          reason,
          riskLevel: RISK_LEVELS.MEDIUM,
        });
        return createResponse(true, action);
      }

      case MESSAGE_TYPES.LABEL_EMAIL: {
        const messageId = data.messageId ?? message.messageId;
        const labelId = data.labelId ?? message.labelId;
        if (!messageId) {
          throw new Error('Message ID is required to apply a label.');
        }
        if (!labelId) {
          throw new Error('Label ID is required to apply a label.');
        }
        const reason = data.reason ?? message.reason ?? `Apply label: ${labelId}`;
        const action = await queueAction({
          type: 'LABEL_EMAIL',
          params: { messageId, labelId },
          reason,
          riskLevel: RISK_LEVELS.MEDIUM,
        });
        return createResponse(true, action);
      }

      case MESSAGE_TYPES.MARK_READ: {
        const messageId = data.messageId ?? message.messageId;
        const reason = data.reason ?? message.reason ?? 'Mark as read';
        const action = await queueAction({
          type: 'MARK_READ',
          params: { messageId },
          reason,
          riskLevel: RISK_LEVELS.MEDIUM,
        });
        return createResponse(true, action);
      }

      case MESSAGE_TYPES.CREATE_DRAFT: {
        const raw = data.raw ?? message.raw ?? createMimeMessage(data);
        const threadId = data.threadId ?? message.threadId;
        const draft = await gmailApi.createDraft(raw, threadId);
        return createResponse(true, draft);
      }

      // ── Labels ─────────────────────────────────────────────────────────────
      case MESSAGE_TYPES.GET_LABELS: {
        const labels = await gmailApi.listLabels();
        return createResponse(true, labels);
      }

      // ── Action queue management ────────────────────────────────────────────
      case MESSAGE_TYPES.APPROVE_ACTION: {
        const actionId = data.actionId ?? message.actionId;
        const approved = await approveAction(actionId);
        return createResponse(true, approved);
      }

      case MESSAGE_TYPES.REJECT_ACTION: {
        const actionId = data.actionId ?? message.actionId;
        const rejected = await rejectAction(actionId);
        return createResponse(true, rejected);
      }

      case MESSAGE_TYPES.EDIT_ACTION: {
        const actionId = data.actionId ?? message.actionId;
        const edited = await editAction(actionId, {
          reason: data.reason ?? message.reason,
          params: data.params ?? message.params,
          riskLevel: data.riskLevel ?? message.riskLevel,
        });
        return createResponse(true, edited);
      }

      case MESSAGE_TYPES.GET_PENDING_APPROVALS: {
        const pending = await getPendingActions();
        return createResponse(true, { approvals: pending });
      }

      case MESSAGE_TYPES.GET_ACTION_HISTORY: {
        const limit = data.limit ?? message.limit;
        const log = await getActionLog(limit);
        return createResponse(true, { history: log });
      }

      case MESSAGE_TYPES.CLEAR_LOG: {
        await clearActionLog();
        return createResponse(true, { cleared: true });
      }

      case MESSAGE_TYPES.RUN_AUTOPILOT: {
        await checkAutopilotRules();
        return createResponse(true, { success: true });
      }

      case MESSAGE_TYPES.GET_ANALYTICS: {
        const maxResults = data.maxResults ?? message.maxResults ?? 50;
        const emails = await fetchInboxForAI('label:INBOX', maxResults);
        const report = await runAnalytics(emails);
        return createResponse(true, report);
      }

      case MESSAGE_TYPES.GET_THREAD_TIMELINE: {
        const threadId = data.threadId ?? message.threadId;
        if (!threadId) {
          throw new Error('Thread ID is required to fetch a timeline.');
        }
        const thread = await gmailApi.getThread(threadId);
        const messagesList = (thread?.messages ?? []).map((m: any) => {
          const headers = extractHeaders(m.payload?.headers);
          return {
            from: headers['from'] || '',
            subject: headers['subject'] || '',
            body: sanitizeForAI(parseEmailBody(m.payload)),
          };
        });
        const timeline = await parseThreadTimeline(messagesList);
        return createResponse(true, { timeline });
      }

      // ── Context broadcasts (handled by the side panel) ─────────────────────
      case MESSAGE_TYPES.EMAIL_CONTEXT_UPDATE:
      case MESSAGE_TYPES.EMAIL_CONTEXT_CLEAR:
        // These are broadcast to the side panel; acknowledge here so the
        // router doesn't log a spurious "Unknown message type" warning.
        return createResponse(true);

      // ── Unknown ────────────────────────────────────────────────────────────
      default:
        console.warn(`[InboxCommander] Unknown message type: ${type}`);
        return createResponse(false, null, `Unknown message type: ${type}`);
    }
  } catch (err: any) {
    console.error(`[InboxCommander] Error handling ${type}:`, err);
    return createResponse(false, null, err.message);
  }
}

// ── Alarms & Background Processing ─────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'check_autopilot') {
    checkAutopilotRules().catch((err) => {
      console.error('[InboxCommander] Error running background autopilot rules:', err);
    });
  }
});

// ── Autopilot helpers ──────────────────────────────────────────────────────────

export interface AutopilotEmailInput {
  id: string;
  subject: string;
  from: string;
  body: string;
}
export interface QueuedActionInput {
  type: 'ARCHIVE_EMAIL' | 'MARK_READ' | 'STAR_EMAIL' | 'LABEL_EMAIL';
  messageId: string;
  labelId?: string;
  reason: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}
export const MAX_EMAILS_PER_TICK = 20;
export const MAX_ACTIONS_PER_RULE_PER_RUN = 4;

function actionKey(type: string, messageId: string, labelId: string | null = null): string {
  return `${type}:${messageId}:${labelId ?? ''}`;
}

/**
 * Pure-ish planner: given a batch of emails, a set of rules, and a `matches`
 * predicate, return the list of actions that should be queued.
 *
 *  - Caps the input batch at MAX_EMAILS_PER_TICK.
 *  - Skips disabled rules.
 *  - Deduplicates across rules by (type, messageId, labelId) — two rules
 *    that both fire `archive: true` for the same email yield ONE action.
 *  - Caps the number of actions produced per (rule, message) pair at
 *    MAX_ACTIONS_PER_RULE_PER_RUN.
 */
export async function computeAutopilotActions(
  messages: AutopilotEmailInput[],
  rules: AutoPilotRule[],
  matches: (body: string, subject: string, from: string, filter: string) => Promise<boolean>,
): Promise<QueuedActionInput[]> {
  const seen = new Set<string>();
  const out: QueuedActionInput[] = [];
  const capped = messages.slice(0, MAX_EMAILS_PER_TICK);

  for (const msg of capped) {
    for (const rule of rules) {
      if (!rule.enabled) continue;
      const matched = await matches(msg.body, msg.subject, msg.from, rule.filter);
      if (!matched) continue;
      let perRule = 0;
      const tryQueue = (a: QueuedActionInput) => {
        if (perRule >= MAX_ACTIONS_PER_RULE_PER_RUN) return;
        const k = actionKey(a.type, a.messageId, a.labelId ?? null);
        if (seen.has(k)) return;
        seen.add(k);
        out.push(a);
        perRule++;
      };
      if (rule.actions.archive) {
        tryQueue({
          type: 'ARCHIVE_EMAIL',
          messageId: msg.id,
          reason: `Auto-pilot: matched "${rule.name}"`,
          riskLevel: 'MEDIUM',
        });
      }
      if (rule.actions.markRead) {
        tryQueue({
          type: 'MARK_READ',
          messageId: msg.id,
          reason: `Auto-pilot: matched "${rule.name}"`,
          riskLevel: 'MEDIUM',
        });
      }
      if (rule.actions.star) {
        tryQueue({
          type: 'STAR_EMAIL',
          messageId: msg.id,
          reason: `Auto-pilot: matched "${rule.name}"`,
          riskLevel: 'LOW',
        });
      }
      if (rule.actions.labelId) {
        tryQueue({
          type: 'LABEL_EMAIL',
          messageId: msg.id,
          labelId: rule.actions.labelId,
          reason: `Auto-pilot: matched "${rule.name}"`,
          riskLevel: 'MEDIUM',
        });
      }
    }
  }
  return out;
}

/**
 * Periodically evaluate recent incoming messages against active natural language rules,
 * queuing label or archive actions.
 */
async function checkAutopilotRules(): Promise<void> {
  try {
    const apiKey = await getApiKey();
    if (!apiKey) {
      console.warn('[InboxCommander] Autopilot check skipped: Gemini API key is not configured.');
      return;
    }

    const rules = (await getRules()).filter((r) => r.enabled);
    if (rules.length === 0) {
      return;
    }

    const authenticated = await isAuthenticated();
    if (!authenticated) {
      console.warn('[InboxCommander] Autopilot check skipped: Gmail account is not authenticated.');
      return;
    }

    // Load processed email IDs to avoid evaluating the same email twice
    const { autopilot_processed } = (await chrome.storage.local.get('autopilot_processed')) as {
      autopilot_processed?: string[];
    };
    const processedIds = new Set(autopilot_processed ?? []);

    // Fetch the last MAX_EMAILS_PER_TICK emails in the inbox
    const stubs = await gmailApi.listMessages('label:INBOX', MAX_EMAILS_PER_TICK);
    const newStubs = stubs.filter((s) => !processedIds.has(s.id));

    if (newStubs.length === 0) {
      return;
    }

    // Hydrate stubs into planner inputs. Track which IDs were successfully
    // hydrated so we can mark them processed below (failed hydration leaves
    // them unprocessed for the next tick to retry).
    const emailInputs: AutopilotEmailInput[] = [];
    const hydratedIds: string[] = [];
    for (const stub of newStubs) {
      try {
        const msg = await gmailApi.getMessage(stub.id);
        const headers = extractHeaders(msg.payload?.headers);
        const subject = headers['subject'] || '';
        const from = headers['from'] || '';
        const body = parseEmailBody(msg.payload);
        const sanitized = sanitizeForAI(body);
        emailInputs.push({ id: stub.id, subject, from, body: sanitized });
        hydratedIds.push(stub.id);
      } catch (err) {
        console.error(`[InboxCommander] Autopilot failed to hydrate email ${stub.id}:`, err);
      }
    }

    const queuedActions = await computeAutopilotActions(emailInputs, rules, evaluateRuleMatch);

    for (const action of queuedActions) {
      try {
        console.log(
          `[InboxCommander] Autopilot matched: ${action.reason} (${action.type} for ${action.messageId})`,
        );
        const params: Record<string, string> = { messageId: action.messageId };
        if (action.type === 'LABEL_EMAIL' && action.labelId) {
          params.labelId = action.labelId;
        }
        await queueAction({
          type: action.type,
          params,
          reason: action.reason,
          riskLevel: action.riskLevel,
        });
      } catch (err) {
        console.error(
          `[InboxCommander] Autopilot failed to queue action for ${action.messageId}:`,
          err,
        );
      }
    }

    // Mark only successfully-hydrated emails as processed — leave the rest
    // for the next tick to retry.
    for (const id of hydratedIds) processedIds.add(id);

    // Persist processed email IDs (rolling window)
    // Cap at 1000 IDs — at 20 emails per 15-min tick, that's ~12 hours of dedup coverage.
    const updatedProcessed = Array.from(processedIds).slice(-1000);
    await chrome.storage.local.set({ autopilot_processed: updatedProcessed });
  } catch (globalErr) {
    console.error('[InboxCommander] Global autopilot process exception:', globalErr);
  }
}
