/**
 * background/service-worker.js
 * Main background service worker — central message router for MailFlow-agent.
 *
 * All event listeners are registered at the top level (MV3 requirement).
 * Uses ES module imports from sibling modules.
 */

import { MESSAGE_TYPES, DEFAULT_SETTINGS, RISK_LEVELS } from '../shared/constants.js';
import { createResponse } from '../shared/message-types.js';
import { parseEmailBody, extractHeaders, sanitizeForAI, createMimeMessage } from '../shared/utils.js';

import {
  isAuthenticated,
  getAuthTokenInteractive,
  revokeAuth,
} from './auth.js';

import * as gmailApi from './gmail-api.js';

import {
  summarizeEmail,
  summarizeThread,
  classifyEmail,
  draftReply,
  translateToGmailQuery,
  chatWithAgent,
  setApiKey,
  getApiKey,
} from './ai-provider.js';

import {
  queueAction,
  getPendingActions,
  approveAction,
  rejectAction,
  getActionLog,
  getSettings,
  updateSettings,
} from './action-queue.js';

// ── Install / Update ───────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`[MailFlow-agent] Installed — reason: ${details.reason}`);

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
});

// ── Side-panel: enable only on mail.google.com tabs ────────────────────────────

chrome.tabs.onUpdated.addListener(async (tabId, _changeInfo, tab) => {
  if (!chrome.sidePanel?.setOptions) return;

  const isGmail = tab.url?.startsWith('https://mail.google.com');

  try {
    await chrome.sidePanel.setOptions({
      tabId,
      enabled: isGmail,
    });
  } catch {
    // Tab may have been closed — ignore
  }
});

// ── Alarms (placeholder for future scheduled tasks) ────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  console.log(`[MailFlow-agent] Alarm fired: ${alarm.name}`);
  // Future: handle scheduled email checks, digest generation, etc.
});

// ── Central message router ─────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((err) => {
      console.error(`[MailFlow-agent] Message handler error:`, err);
      sendResponse(createResponse(false, null, err.message));
    });

  // Return true — we WILL call sendResponse asynchronously
  return true;
});

/**
 * Route a message to the appropriate handler.
 * Always returns a createResponse(...) object.
 */
async function handleMessage(message) {
  const { type, data = {} } = message;

  try {
    switch (type) {
      // ── Auth ───────────────────────────────────────────────────────────────
      case MESSAGE_TYPES.AUTH_STATUS: {
        const authenticated = await isAuthenticated();
        let email = null;
        if (authenticated) {
          try {
            const profile = await gmailApi.getProfile();
            email = profile.emailAddress;
          } catch (e) {
            // Ignore profile fetch failure
          }
        }
        return createResponse(true, { authenticated, email });
      }

      case MESSAGE_TYPES.AUTH_LOGIN: {
        await getAuthTokenInteractive();
        let email = null;
        try {
          const profile = await gmailApi.getProfile();
          email = profile.emailAddress;
        } catch (e) {
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
        const { query, maxResults } = data;
        const stubs = await gmailApi.listMessages(query, maxResults);
        // Hydrate each stub with full message data
        const messages = await Promise.all(
          stubs.map((s) => gmailApi.getMessage(s.id)),
        );
        return createResponse(true, messages);
      }

      case MESSAGE_TYPES.GET_EMAIL: {
        const msg = await gmailApi.getMessage(data.messageId, data.format);
        return createResponse(true, msg);
      }

      case MESSAGE_TYPES.GET_THREAD: {
        const thread = await gmailApi.getThread(data.threadId, data.format);
        return createResponse(true, thread);
      }

      // ── Search ─────────────────────────────────────────────────────────────
      case MESSAGE_TYPES.SEARCH_EMAILS: {
        let query = data.query ?? '';

        // If the caller wants natural-language translation
        if (data.naturalLanguage) {
          query = await translateToGmailQuery(data.query);
        }

        const results = await gmailApi.searchMessages(query, data.maxResults);
        return createResponse(true, { query, results });
      }

      // ── AI operations ──────────────────────────────────────────────────────
      case MESSAGE_TYPES.CLASSIFY_EMAIL: {
        const sanitized = sanitizeForAI(data.body ?? parseEmailBody(data.payload));
        const classification = await classifyEmail(sanitized, data.subject, data.from);
        return createResponse(true, classification);
      }

      case MESSAGE_TYPES.SUMMARIZE_EMAIL: {
        const sanitized = sanitizeForAI(data.body ?? parseEmailBody(data.payload));
        const summary = await summarizeEmail(sanitized, data.subject, data.from);
        return createResponse(true, { reply: summary, summary });
      }

      case MESSAGE_TYPES.SUMMARIZE_THREAD: {
        const threadMessages = (data.messages ?? []).map((m) => ({
          from: m.from,
          subject: m.subject,
          body: sanitizeForAI(m.body),
        }));
        const summary = await summarizeThread(threadMessages);
        return createResponse(true, { reply: summary, summary });
      }

      case MESSAGE_TYPES.DRAFT_REPLY: {
        const sanitized = sanitizeForAI(data.body ?? '');
        const replyBody = await draftReply(
          sanitized,
          data.subject,
          data.from,
          data.instruction,
          data.userName,
          data.userSignature,
        );
        return createResponse(true, { reply: replyBody, replyBody });
      }

      case MESSAGE_TYPES.CHAT: {
        const response = await chatWithAgent(
          data.message,
          data.emailContext ?? null,
          data.conversationHistory ?? [],
        );
        return createResponse(true, { reply: response, response });
      }

      // ── Queued actions (risk-gated) ────────────────────────────────────────
      case MESSAGE_TYPES.SEND_EMAIL: {
        const raw = data.raw ?? createMimeMessage(data);
        const action = await queueAction({
          type: 'SEND_EMAIL',
          params: { raw, threadId: data.threadId },
          reason: data.reason ?? 'Send email',
          riskLevel: RISK_LEVELS.HIGH,
        });
        return createResponse(true, action);
      }

      case MESSAGE_TYPES.TRASH_EMAIL: {
        const action = await queueAction({
          type: 'TRASH_EMAIL',
          params: { messageId: data.messageId },
          reason: data.reason ?? 'Trash email',
          riskLevel: RISK_LEVELS.HIGH,
        });
        return createResponse(true, action);
      }

      case MESSAGE_TYPES.ARCHIVE_EMAIL: {
        const action = await queueAction({
          type: 'ARCHIVE_EMAIL',
          params: { messageId: data.messageId },
          reason: data.reason ?? 'Archive email',
          riskLevel: RISK_LEVELS.MEDIUM,
        });
        return createResponse(true, action);
      }

      case MESSAGE_TYPES.LABEL_EMAIL: {
        const action = await queueAction({
          type: 'LABEL_EMAIL',
          params: { messageId: data.messageId, labelId: data.labelId },
          reason: data.reason ?? `Apply label: ${data.labelId}`,
          riskLevel: RISK_LEVELS.MEDIUM,
        });
        return createResponse(true, action);
      }

      case MESSAGE_TYPES.MARK_READ: {
        const action = await queueAction({
          type: 'MARK_READ',
          params: { messageId: data.messageId },
          reason: data.reason ?? 'Mark as read',
          riskLevel: RISK_LEVELS.MEDIUM,
        });
        return createResponse(true, action);
      }

      case MESSAGE_TYPES.CREATE_DRAFT: {
        const raw = data.raw ?? createMimeMessage(data);
        const draft = await gmailApi.createDraft(raw, data.threadId);
        return createResponse(true, draft);
      }

      // ── Labels ─────────────────────────────────────────────────────────────
      case MESSAGE_TYPES.GET_LABELS: {
        const labels = await gmailApi.listLabels();
        return createResponse(true, labels);
      }

      // ── Action queue management ────────────────────────────────────────────
      case MESSAGE_TYPES.APPROVE_ACTION: {
        const approved = await approveAction(data.actionId);
        return createResponse(true, approved);
      }

      case MESSAGE_TYPES.REJECT_ACTION: {
        const rejected = await rejectAction(data.actionId);
        return createResponse(true, rejected);
      }

      case MESSAGE_TYPES.GET_PENDING_APPROVALS: {
        const pending = await getPendingActions();
        return createResponse(true, { approvals: pending });
      }

      case MESSAGE_TYPES.GET_ACTION_HISTORY: {
        const log = await getActionLog(data.limit);
        return createResponse(true, { history: log });
      }

      // ── Unknown ────────────────────────────────────────────────────────────
      default:
        console.warn(`[MailFlow-agent] Unknown message type: ${type}`);
        return createResponse(false, null, `Unknown message type: ${type}`);
    }
  } catch (err) {
    console.error(`[MailFlow-agent] Error handling ${type}:`, err);
    return createResponse(false, null, err.message);
  }
}
