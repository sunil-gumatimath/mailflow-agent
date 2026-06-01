/**
 * background/action-queue.js
 * Action queue with approval system.
 * Persists pending actions and an audit log in chrome.storage.local.
 */

import { DEFAULT_SETTINGS, RISK_LEVELS } from '../shared/constants.js';
import { generateId } from '../shared/utils.js';
import * as gmailApi from './gmail-api.js';

// ── Storage keys ───────────────────────────────────────────────────────────────
const STORAGE_KEYS = {
  PENDING:  'actionQueue_pending',
  LOG:      'actionQueue_log',
  SETTINGS: 'extension_settings',
};

// ── Settings ───────────────────────────────────────────────────────────────────

/** Retrieve extension settings (merged with defaults). */
export async function getSettings() {
  const { [STORAGE_KEYS.SETTINGS]: stored } = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

/** Persist updated settings. */
export async function updateSettings(settings) {
  const current = await getSettings();
  const merged = { ...current, ...settings };
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: merged });
  return merged;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/** Check whether user approval is needed for a given risk level. */
async function isApprovalRequired(riskLevel) {
  const settings = await getSettings();
  const approval = settings.approvalRequired ?? DEFAULT_SETTINGS.approvalRequired;

  switch (riskLevel) {
    case RISK_LEVELS.LOW:    return approval.low    ?? false;
    case RISK_LEVELS.MEDIUM: return approval.medium ?? true;
    case RISK_LEVELS.HIGH:   return approval.high   ?? true;
    default:                 return true;
  }
}

/** Read the pending-actions array from storage. */
async function readPending() {
  const { [STORAGE_KEYS.PENDING]: pending } = await chrome.storage.local.get(STORAGE_KEYS.PENDING);
  return pending ?? [];
}

/** Write the pending-actions array to storage. */
async function writePending(pending) {
  await chrome.storage.local.set({ [STORAGE_KEYS.PENDING]: pending });
}

/** Append an entry to the action log. */
async function appendLog(entry) {
  const { [STORAGE_KEYS.LOG]: log } = await chrome.storage.local.get(STORAGE_KEYS.LOG);
  const updated = [entry, ...(log ?? [])];
  // Keep the log from growing unbounded — retain last 500 entries
  await chrome.storage.local.set({ [STORAGE_KEYS.LOG]: updated.slice(0, 500) });
}

// ── Execute an action ──────────────────────────────────────────────────────────

/**
 * Map an action type to the corresponding gmail-api function and execute it.
 * @param {object} action — { type, params }
 * @returns {Promise<*>} API result
 */
async function executeActionInternal(action) {
  const { type, params } = action;

  switch (type) {
    case 'SEND_EMAIL':
      return gmailApi.sendMessage(params.raw, params.threadId);

    case 'TRASH_EMAIL':
      return gmailApi.trashMessage(params.messageId);

    case 'ARCHIVE_EMAIL':
      return gmailApi.archiveMessage(params.messageId);

    case 'LABEL_EMAIL':
      return gmailApi.labelMessage(params.messageId, params.labelId);

    case 'MARK_READ':
      return gmailApi.markAsRead(params.messageId);

    case 'CREATE_DRAFT':
      return gmailApi.createDraft(params.raw, params.threadId);

    case 'STAR_EMAIL':
      return gmailApi.starMessage(params.messageId);

    case 'UNSTAR_EMAIL':
      return gmailApi.unstarMessage(params.messageId);

    default:
      throw new Error(`Unknown action type: ${type}`);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Queue an action. If approval is not required, it executes immediately.
 * @param {object} opts
 * @param {string} opts.type       — action type (e.g. 'SEND_EMAIL')
 * @param {object} opts.params     — action-specific parameters
 * @param {string} opts.reason     — human-readable reason
 * @param {string} opts.riskLevel  — RISK_LEVELS value
 * @returns {Promise<object>} the action record
 */
export async function queueAction({ type, params, reason = '', riskLevel = RISK_LEVELS.HIGH }) {
  const action = {
    id: generateId(),
    type,
    params,
    riskLevel,
    reason,
    status: 'pending',
    timestamp: Date.now(),
    completedAt: null,
    result: null,
    error: null,
  };

  const needsApproval = await isApprovalRequired(riskLevel);

  if (!needsApproval) {
    // Auto-execute
    return executeAction(action);
  }

  // Store as pending
  const pending = await readPending();
  pending.push(action);
  await writePending(pending);
  await appendLog(action);

  return action;
}

/**
 * Get all pending (unapproved) actions.
 */
export async function getPendingActions() {
  return readPending();
}

/**
 * Approve a pending action — execute it and log the result.
 */
export async function approveAction(actionId) {
  const pending = await readPending();
  const index = pending.findIndex((a) => a.id === actionId);

  if (index === -1) {
    throw new Error(`Action ${actionId} not found in pending queue`);
  }

  const action = { ...pending[index], status: 'approved' };
  pending.splice(index, 1);
  await writePending(pending);

  return executeAction(action);
}

/**
 * Reject a pending action.
 */
export async function rejectAction(actionId) {
  const pending = await readPending();
  const index = pending.findIndex((a) => a.id === actionId);

  if (index === -1) {
    throw new Error(`Action ${actionId} not found in pending queue`);
  }

  const action = {
    ...pending[index],
    status: 'rejected',
    completedAt: Date.now(),
  };

  pending.splice(index, 1);
  await writePending(pending);
  await appendLog(action);

  return action;
}

/**
 * Execute an action, log the outcome, and return the updated action record.
 */
export async function executeAction(action) {
  try {
    const result = await executeActionInternal(action);
    const completed = {
      ...action,
      status: 'executed',
      completedAt: Date.now(),
      result,
    };
    await appendLog(completed);
    return completed;
  } catch (err) {
    const failed = {
      ...action,
      status: 'failed',
      completedAt: Date.now(),
      error: err.message,
    };
    await appendLog(failed);
    return failed;
  }
}

/**
 * Retrieve the action log (most recent first).
 * @param {number} limit — max entries to return (default 50)
 */
export async function getActionLog(limit = 50) {
  const { [STORAGE_KEYS.LOG]: log } = await chrome.storage.local.get(STORAGE_KEYS.LOG);
  return (log ?? []).slice(0, limit);
}

/**
 * Clear the entire action log.
 */
export async function clearActionLog() {
  await chrome.storage.local.set({ [STORAGE_KEYS.LOG]: [] });
}
