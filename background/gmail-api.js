/**
 * background/gmail-api.js
 * Mock Gmail REST API wrapper for offline testing with local state.
 * Uses chrome.storage.local to persist email modifications, replies, and drafts.
 */

import { base64UrlDecode, base64UrlEncode } from '../shared/utils.js';

// ── Initial Mock Emails ────────────────────────────────────────────────────────

const INITIAL_MOCK_EMAILS = [
  {
    id: "msg1",
    threadId: "thread1",
    labelIds: ["INBOX", "UNREAD"],
    snippet: "The production database has hit 100% disk usage and is rejecting connections. Immediate action required.",
    date: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 mins ago
    from: "DevOps Monitoring <alerts@company.com>",
    to: "me <user@example.com>",
    subject: "URGENT: Server Down (Production)",
    body: "The production database has hit 100% disk usage and is rejecting connections. Immediate action required. Please check pg_stat_activity and vacuum logs immediately."
  },
  {
    id: "msg2",
    threadId: "thread2",
    labelIds: ["INBOX", "UNREAD"],
    snippet: "Welcome to this week's digest. Today we explore Chrome Extension MV3 changes, WebGPU updates, and the rise of Bun runtime.",
    date: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), // 2 hours ago
    from: "Tech Insights <newsletters@techinsights.io>",
    to: "me <user@example.com>",
    subject: "Weekly Tech Digest #42",
    body: "Welcome to this week's digest.\n\nToday we explore:\n- Chrome Extension MV3 changes and side panels\n- WebGPU updates and in-browser inference\n- The rise of the Bun JS runtime\n\nHope you find it useful!"
  },
  {
    id: "msg3",
    threadId: "thread3",
    labelIds: ["INBOX"],
    snippet: "Hi, I am looking over the proposal for the Q3 renewal. Could you clarify if the support tier is included?",
    date: new Date(Date.now() - 24 * 3600 * 1000).toISOString(), // Yesterday
    from: "Marcus Brody <mbrody@clientcorp.com>",
    to: "me <user@example.com>",
    subject: "Inquiry regarding pricing for Q3 contract",
    body: "Hi,\n\nI am looking over the proposal for the Q3 renewal. Could you clarify if the support tier is included or is an additional 15% charge?\n\nThanks,\nMarcus"
  },
  {
    id: "msg4",
    threadId: "thread4",
    labelIds: ["INBOX", "UNREAD"],
    snippet: "Hey! Are you free for lunch tomorrow around 1 PM? Let me know if tacos work for you.",
    date: new Date(Date.now() - 36 * 3600 * 1000).toISOString(), // 1.5 days ago
    from: "Sarah Connor <sarah@friends.com>",
    to: "me <user@example.com>",
    subject: "Lunch tomorrow?",
    body: "Hey!\n\nAre you free for lunch tomorrow around 1 PM? Let me know if tacos work for you.\n\nSarah"
  }
];

// ── Storage Helpers ────────────────────────────────────────────────────────────

async function getMockDb() {
  const result = await chrome.storage.local.get('mock_emails');
  if (!result.mock_emails || result.mock_emails.length === 0) {
    await chrome.storage.local.set({ mock_emails: INITIAL_MOCK_EMAILS });
    return INITIAL_MOCK_EMAILS;
  }
  return result.mock_emails;
}

async function saveMockDb(db) {
  await chrome.storage.local.set({ mock_emails: db });
}

async function insertMockEmail(email) {
  const db = await getMockDb();
  db.push(email);
  await saveMockDb(db);
}

// Helper to format mock email into Gmail API schema structure
function formatMockMessage(email) {
  return {
    id: email.id,
    threadId: email.threadId,
    labelIds: email.labelIds || [],
    snippet: email.snippet || '',
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: email.from },
        { name: "To", value: email.to },
        { name: "Subject", value: email.subject },
        { name: "Date", value: email.date }
      ],
      body: {
        data: base64UrlEncode(email.body || '')
      }
    }
  };
}

// ── Mock Core API Methods ──────────────────────────────────────────────────────

/**
 * List message IDs matching a query, filtered from the mock database.
 */
export async function listMessages(query = '', maxResults = 20) {
  const db = await getMockDb();
  let filtered = db.filter(email => !email.labelIds.includes('TRASH'));

  if (query) {
    const q = query.toLowerCase();
    
    // Check specific filter keys
    if (q.includes('is:unread')) {
      filtered = filtered.filter(email => email.labelIds.includes('UNREAD'));
    } else if (q.includes('label:')) {
      const label = q.split('label:')[1].split(' ')[0].toUpperCase();
      filtered = filtered.filter(email => email.labelIds.includes(label));
    } else {
      // Basic text search
      filtered = filtered.filter(email =>
        email.subject.toLowerCase().includes(q) ||
        email.body.toLowerCase().includes(q) ||
        email.from.toLowerCase().includes(q)
      );
    }
  }

  // Sort by date desc
  filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

  return filtered.slice(0, maxResults).map(email => ({
    id: email.id,
    threadId: email.threadId
  }));
}

/**
 * Fetch a single mock message by ID.
 */
export async function getMessage(messageId, format = 'full') {
  const db = await getMockDb();
  const email = db.find(e => e.id === messageId);
  if (!email) {
    throw new Error(`Message not found: ${messageId}`);
  }
  return formatMockMessage(email);
}

/**
 * Fetch an entire mock thread by ID.
 */
export async function getThread(threadId, format = 'full') {
  const db = await getMockDb();
  const threadEmails = db.filter(e => e.threadId === threadId);
  
  // Sort thread messages chronologically
  threadEmails.sort((a, b) => new Date(a.date) - new Date(b.date));

  return {
    id: threadId,
    messages: threadEmails.map(formatMockMessage)
  };
}

/**
 * Modify labels on a message locally.
 */
export async function modifyMessage(messageId, { addLabelIds = [], removeLabelIds = [] } = {}) {
  const db = await getMockDb();
  const index = db.findIndex(email => email.id === messageId);
  if (index !== -1) {
    let labels = db[index].labelIds || [];
    // Add new labels
    for (const l of addLabelIds) {
      if (!labels.includes(l)) labels.push(l);
    }
    // Remove labels
    labels = labels.filter(l => !removeLabelIds.includes(l));
    db[index].labelIds = labels;
    
    await saveMockDb(db);
    return formatMockMessage(db[index]);
  }
  throw new Error(`Message not found: ${messageId}`);
}

/**
 * Move a message to Trash in the mock database.
 */
export async function trashMessage(messageId) {
  return modifyMessage(messageId, { addLabelIds: ['TRASH'], removeLabelIds: ['INBOX', 'UNREAD'] });
}

/**
 * Restore a message from Trash in the mock database.
 */
export async function untrashMessage(messageId) {
  return modifyMessage(messageId, { addLabelIds: ['INBOX'], removeLabelIds: ['TRASH'] });
}

/**
 * Mock sending a message (appends the reply to the mock database).
 */
export async function sendMessage(raw, threadId) {
  const mimeText = base64UrlDecode(raw);
  
  // Parse fields from mime content
  const toMatch = mimeText.match(/To:\s*([^\r\n]+)/i);
  const subjectMatch = mimeText.match(/Subject:\s*([^\r\n]+)/i);
  const parts = mimeText.split('\r\n\r\n');
  const bodyText = parts.slice(1).join('\r\n\r\n');

  const newEmail = {
    id: 'msg-' + Date.now(),
    threadId: threadId || ('thread-' + Date.now()),
    labelIds: ['SENT'],
    snippet: bodyText.slice(0, 100).replace(/\r?\n/g, ' '),
    date: new Date().toISOString(),
    from: 'me <user@example.com>',
    to: toMatch ? toMatch[1].trim() : 'unknown@example.com',
    subject: subjectMatch ? subjectMatch[1].trim() : 'Sent Message',
    body: bodyText
  };

  await insertMockEmail(newEmail);
  return formatMockMessage(newEmail);
}

/**
 * Mock creating a draft (appends draft to local database).
 */
export async function createDraft(raw, threadId) {
  const mimeText = base64UrlDecode(raw);
  
  const toMatch = mimeText.match(/To:\s*([^\r\n]+)/i);
  const subjectMatch = mimeText.match(/Subject:\s*([^\r\n]+)/i);
  const parts = mimeText.split('\r\n\r\n');
  const bodyText = parts.slice(1).join('\r\n\r\n');

  const newEmail = {
    id: 'msg-' + Date.now(),
    threadId: threadId || ('thread-' + Date.now()),
    labelIds: ['DRAFT'],
    snippet: bodyText.slice(0, 100).replace(/\r?\n/g, ' '),
    date: new Date().toISOString(),
    from: 'me <user@example.com>',
    to: toMatch ? toMatch[1].trim() : '',
    subject: subjectMatch ? subjectMatch[1].trim() : '',
    body: bodyText
  };

  await insertMockEmail(newEmail);
  return {
    id: 'draft-' + newEmail.id,
    message: formatMockMessage(newEmail)
  };
}

/**
 * Return list of available system & user labels.
 */
export async function listLabels() {
  return [
    { id: "INBOX", name: "INBOX", type: "system" },
    { id: "UNREAD", name: "UNREAD", type: "system" },
    { id: "STARRED", name: "STARRED", type: "system" },
    { id: "TRASH", name: "TRASH", type: "system" },
    { id: "SENT", name: "SENT", type: "system" },
    { id: "DRAFT", name: "DRAFT", type: "system" },
    { id: "WORK", name: "WORK", type: "user" },
    { id: "PERSONAL", name: "PERSONAL", type: "user" }
  ];
}

/**
 * Return mock profile email.
 */
export async function getProfile() {
  return {
    emailAddress: 'mock-user@example.com',
    messagesTotal: 100,
    threadsTotal: 50,
    historyId: '12345'
  };
}

/**
 * Batch modify labels on multiple messages.
 */
export async function batchModify(ids, { addLabelIds = [], removeLabelIds = [] } = {}) {
  for (const id of ids) {
    await modifyMessage(id, { addLabelIds, removeLabelIds });
  }
  return null;
}

/**
 * Search messages.
 */
export async function searchMessages(query, maxResults = 20) {
  const stubs = await listMessages(query, maxResults);
  const messages = await Promise.all(stubs.map((s) => getMessage(s.id)));
  return messages;
}

// ── Convenience Helpers ────────────────────────────────────────────────────────

export const archiveMessage = (messageId) =>
  modifyMessage(messageId, { removeLabelIds: ['INBOX'] });

export const markAsRead = (messageId) =>
  modifyMessage(messageId, { removeLabelIds: ['UNREAD'] });

export const markAsUnread = (messageId) =>
  modifyMessage(messageId, { addLabelIds: ['UNREAD'] });

export const labelMessage = (messageId, labelId) =>
  modifyMessage(messageId, { addLabelIds: [labelId] });

export const starMessage = (messageId) =>
  modifyMessage(messageId, { addLabelIds: ['STARRED'] });

export const unstarMessage = (messageId) =>
  modifyMessage(messageId, { removeLabelIds: ['STARRED'] });
