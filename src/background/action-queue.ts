/**
 * background/action-queue.ts
 * Action queue with approval system.
 * Persists pending actions and an audit log in chrome.storage.local.
 */

import { DEFAULT_SETTINGS, RISK_LEVELS } from '../shared/constants';
import { generateId } from '../shared/utils';
import * as gmailApi from './gmail-api';
import type { Settings, QueuedAction } from '../shared/types';

// ── Storage keys ───────────────────────────────────────────────────────────────
const STORAGE_KEYS = {
  PENDING:  'actionQueue_pending',
  LOG:      'actionQueue_log',
  SETTINGS: 'extension_settings',
};

// ── Settings ───────────────────────────────────────────────────────────────────

/** Retrieve extension settings (merged with defaults). */
export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const stored = result[STORAGE_KEYS.SETTINGS] as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...stored };
}

/** Persist updated settings. */
export async function updateSettings(settings: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const merged = { ...current, ...settings };
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: merged });
  return merged;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/** Check whether user approval is needed for a given risk level. */
async function isApprovalRequired(riskLevel: string): Promise<boolean> {
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
async function readPending(): Promise<QueuedAction[]> {
  const result = (await chrome.storage.local.get(STORAGE_KEYS.PENDING)) as { [key: string]: QueuedAction[] | undefined };
  const pending = result[STORAGE_KEYS.PENDING];
  return pending ?? [];
}

/** Write the pending-actions array to storage. */
async function writePending(pending: QueuedAction[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.PENDING]: pending });
}

/** Append an entry to the action log. */
async function appendLog(entry: QueuedAction): Promise<void> {
  const result = (await chrome.storage.local.get(STORAGE_KEYS.LOG)) as { [key: string]: QueuedAction[] | undefined };
  const log = result[STORAGE_KEYS.LOG];
  const updated = [entry, ...(log ?? [])];
  // Keep the log from growing unbounded — retain last 500 entries
  await chrome.storage.local.set({ [STORAGE_KEYS.LOG]: updated.slice(0, 500) });
}

// ── Execute an action ──────────────────────────────────────────────────────────

/**
 * Map an action type to the corresponding gmail-api function and execute it.
 * @param action — { type, params }
 * @returns API result
 */
async function executeActionInternal(action: QueuedAction): Promise<any> {
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

interface QueueActionOptions {
  type: string;
  params: any;
  reason?: string;
  riskLevel?: string;
}

/**
 * Queue an action. If approval is not required, it executes immediately.
 * @returns the action record
 */
export async function queueAction({ type, params, reason = '', riskLevel = RISK_LEVELS.HIGH }: QueueActionOptions): Promise<QueuedAction> {
  const action: QueuedAction = {
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
export async function getPendingActions(): Promise<QueuedAction[]> {
  return readPending();
}

/**
 * Approve a pending action — execute it and log the result.
 */
export async function approveAction(actionId: string): Promise<QueuedAction> {
  const pending = await readPending();
  const index = pending.findIndex((a) => a.id === actionId);

  if (index === -1) {
    throw new Error(`Action ${actionId} not found in pending queue`);
  }

  const found = pending[index];
  if (!found) {
    throw new Error(`Action ${actionId} data not found`);
  }

  const action: QueuedAction = { ...found, status: 'approved' };
  pending.splice(index, 1);
  await writePending(pending);

  return executeAction(action);
}

interface EditActionOptions {
  reason?: string;
  params?: any;
  riskLevel?: string;
}

/**
 * Edit a pending action's reason, params, or risk level. The action stays
 * pending so the user can still approve or reject it afterwards.
 */
export async function editAction(actionId: string, updates: EditActionOptions = {}): Promise<QueuedAction> {
  const pending = await readPending();
  const index = pending.findIndex((a) => a.id === actionId);

  if (index === -1) {
    throw new Error(`Action ${actionId} not found in pending queue`);
  }

  const found = pending[index];
  if (!found) {
    throw new Error(`Action ${actionId} data not found`);
  }

  const edited: QueuedAction = {
    ...found,
    reason: updates.reason ?? found.reason,
    params: updates.params ? { ...found.params, ...updates.params } : found.params,
    riskLevel: updates.riskLevel ?? found.riskLevel,
  };

  pending[index] = edited;
  await writePending(pending);

  return edited;
}

/**
 * Reject a pending action.
 */
export async function rejectAction(actionId: string): Promise<QueuedAction> {
  const pending = await readPending();
  const index = pending.findIndex((a) => a.id === actionId);

  if (index === -1) {
    throw new Error(`Action ${actionId} not found in pending queue`);
  }

  const found = pending[index];
  if (!found) {
    throw new Error(`Action ${actionId} data not found`);
  }

  const action: QueuedAction = {
    ...found,
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
export async function executeAction(action: QueuedAction): Promise<QueuedAction> {
  try {
    const result = await executeActionInternal(action);
    const completed: QueuedAction = {
      ...action,
      status: 'executed',
      completedAt: Date.now(),
      result,
    };
    await appendLog(completed);
    return completed;
  } catch (err: any) {
    const failed: QueuedAction = {
      ...action,
      status: 'failed',
      completedAt: Date.now(),
      error: err.message,
    };
    await appendLog(failed);
    return failed;
  }
}

export async function getActionLog(limit: number = 50): Promise<QueuedAction[]> {
  const result = (await chrome.storage.local.get(STORAGE_KEYS.LOG)) as { [key: string]: QueuedAction[] | undefined };
  const log = result[STORAGE_KEYS.LOG];
  return (log ?? []).slice(0, limit);
}

/**
 * Clear the entire action log.
 */
export async function clearActionLog(): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.LOG]: [] });
}
