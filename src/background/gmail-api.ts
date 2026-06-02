/**
 * background/gmail-api.ts
 * Real Gmail REST API wrapper. All calls are authenticated via authenticatedFetch
 * which injects the chrome.identity OAuth token and retries on 401.
 */

import { GMAIL_API_BASE } from '../shared/constants';
import { authenticatedFetch } from './auth';
import type { GmailMessage, GmailThread } from '../shared/types';

interface ModifyMessageOptions {
  addLabelIds?: string[];
  removeLabelIds?: string[];
}

export interface GmailLabel {
  id: string;
  name: string;
  type: string;
}

export interface GmailProfile {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

async function gmailFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = path.startsWith('http') ? path : `${GMAIL_API_BASE}${path}`;
  const response = await authenticatedFetch(url, init);
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    let msg = `Gmail API error ${response.status}`;
    try {
      const parsed = JSON.parse(errText);
      if (parsed?.error?.message) msg = parsed.error.message;
    } catch {
      if (errText) msg = errText;
    }
    throw new Error(msg);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '' || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

// ── Core API methods ───────────────────────────────────────────────────────────

/**
 * List message IDs matching a Gmail search query.
 */
export async function listMessages(query: string = '', maxResults: number = 20): Promise<{ id: string; threadId: string }[]> {
  const qs = buildQuery({ q: query, maxResults });
  const data = await gmailFetch<{ messages?: { id: string; threadId: string }[] }>(`/messages${qs}`);
  return data.messages ?? [];
}

/**
 * Fetch a single message by ID.
 */
export async function getMessage(messageId: string, format: string = 'full'): Promise<GmailMessage> {
  const qs = buildQuery({ format });
  return gmailFetch<GmailMessage>(`/messages/${encodeURIComponent(messageId)}${qs}`);
}

/**
 * Fetch an entire thread by ID.
 */
export async function getThread(threadId: string, format: string = 'full'): Promise<GmailThread> {
  const qs = buildQuery({ format });
  return gmailFetch<GmailThread>(`/threads/${encodeURIComponent(threadId)}${qs}`);
}

/**
 * Modify labels on a message.
 */
export async function modifyMessage(messageId: string, { addLabelIds = [], removeLabelIds = [] }: ModifyMessageOptions = {}): Promise<GmailMessage> {
  return gmailFetch<GmailMessage>(
    `/messages/${encodeURIComponent(messageId)}/modify`,
    jsonInit('POST', { addLabelIds, removeLabelIds }),
  );
}

/** Move a message to Trash. */
export async function trashMessage(messageId: string): Promise<GmailMessage> {
  return gmailFetch<GmailMessage>(`/messages/${encodeURIComponent(messageId)}/trash`, { method: 'POST' });
}

/** Restore a message from Trash. */
export async function untrashMessage(messageId: string): Promise<GmailMessage> {
  return gmailFetch<GmailMessage>(`/messages/${encodeURIComponent(messageId)}/untrash`, { method: 'POST' });
}

/**
 * Send a message. `raw` must be a base64url-encoded RFC 2822 MIME message.
 */
export async function sendMessage(raw: string, threadId?: string): Promise<GmailMessage> {
  const body: Record<string, string> = { raw };
  if (threadId) body.threadId = threadId;
  return gmailFetch<GmailMessage>('/messages/send', jsonInit('POST', body));
}

/**
 * Create a draft. `raw` must be a base64url-encoded RFC 2822 MIME message.
 */
export async function createDraft(raw: string, threadId?: string): Promise<{ id: string; message: GmailMessage }> {
  const message: Record<string, string> = { raw };
  if (threadId) message.threadId = threadId;
  return gmailFetch<{ id: string; message: GmailMessage }>('/drafts', jsonInit('POST', { message }));
}

/** List all available labels (system + user). */
export async function listLabels(): Promise<GmailLabel[]> {
  const data = await gmailFetch<{ labels?: GmailLabel[] }>('/labels');
  return data.labels ?? [];
}

/** Get the authenticated user's profile. */
export async function getProfile(): Promise<GmailProfile> {
  return gmailFetch<GmailProfile>('/profile');
}

/** Batch-modify labels on multiple messages. */
export async function batchModify(ids: string[], { addLabelIds = [], removeLabelIds = [] }: ModifyMessageOptions = {}): Promise<null> {
  await gmailFetch<void>('/messages/batchModify', jsonInit('POST', { ids, addLabelIds, removeLabelIds }));
  return null;
}

/** Search messages and hydrate each result with the full payload. */
export async function searchMessages(query: string, maxResults: number = 20): Promise<GmailMessage[]> {
  const stubs = await listMessages(query, maxResults);
  return Promise.all(stubs.map((s) => getMessage(s.id)));
}

// ── Convenience helpers ────────────────────────────────────────────────────────

export const archiveMessage = (messageId: string): Promise<GmailMessage> =>
  modifyMessage(messageId, { removeLabelIds: ['INBOX'] });

export const markAsRead = (messageId: string): Promise<GmailMessage> =>
  modifyMessage(messageId, { removeLabelIds: ['UNREAD'] });

export const markAsUnread = (messageId: string): Promise<GmailMessage> =>
  modifyMessage(messageId, { addLabelIds: ['UNREAD'] });

export const labelMessage = (messageId: string, labelId: string): Promise<GmailMessage> =>
  modifyMessage(messageId, { addLabelIds: [labelId] });

export const starMessage = (messageId: string): Promise<GmailMessage> =>
  modifyMessage(messageId, { addLabelIds: ['STARRED'] });

export const unstarMessage = (messageId: string): Promise<GmailMessage> =>
  modifyMessage(messageId, { removeLabelIds: ['STARRED'] });

