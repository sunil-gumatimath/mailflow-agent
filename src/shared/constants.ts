/**
 * Shared constants for InboxCommander extension.
 * Imported by sidepanel, popup, options, content script, and service worker.
 */

// ─── Message Types ───────────────────────────────────────────────
export const MESSAGE_TYPES = {
  // Auth
  AUTH_LOGIN: 'AUTH_LOGIN',
  AUTH_LOGOUT: 'AUTH_LOGOUT',
  AUTH_STATUS: 'AUTH_STATUS',
  AUTH_STATUS_RESPONSE: 'AUTH_STATUS_RESPONSE',

  // Chat / AI
  CHAT: 'CHAT',

  // Quick Actions
  SUMMARIZE_INBOX: 'SUMMARIZE_INBOX',
  PRIORITY_EMAILS: 'PRIORITY_EMAILS',
  UNREAD_EMAILS: 'UNREAD_EMAILS',
  SUMMARIZE_EMAIL: 'SUMMARIZE_EMAIL',
  DRAFT_REPLY: 'DRAFT_REPLY',
  ARCHIVE_EMAIL: 'ARCHIVE_EMAIL',
  LABEL_EMAIL: 'LABEL_EMAIL',
  TRASH_EMAIL: 'TRASH_EMAIL',

  // Email Context (from content script)
  EMAIL_CONTEXT_UPDATE: 'EMAIL_CONTEXT_UPDATE',
  EMAIL_CONTEXT_CLEAR: 'EMAIL_CONTEXT_CLEAR',

  // Approvals
  GET_PENDING_APPROVALS: 'GET_PENDING_APPROVALS',
  APPROVE_ACTION: 'APPROVE_ACTION',
  REJECT_ACTION: 'REJECT_ACTION',
  EDIT_ACTION: 'EDIT_ACTION',

  // Action History
  GET_ACTION_HISTORY: 'GET_ACTION_HISTORY',

  // Settings
  GET_SETTINGS: 'GET_SETTINGS',
  SAVE_SETTINGS: 'SAVE_SETTINGS',
  TEST_API_KEY: 'TEST_API_KEY',

  // Emails / Profile / Search
  GET_PROFILE: 'GET_PROFILE',
  GET_EMAILS: 'GET_EMAILS',
  GET_EMAIL: 'GET_EMAIL',
  GET_THREAD: 'GET_THREAD',
  SEARCH_EMAILS: 'SEARCH_EMAILS',
  CLASSIFY_EMAIL: 'CLASSIFY_EMAIL',
  SUMMARIZE_THREAD: 'SUMMARIZE_THREAD',
  SEND_EMAIL: 'SEND_EMAIL',
  MARK_READ: 'MARK_READ',
  CREATE_DRAFT: 'CREATE_DRAFT',
  GET_LABELS: 'GET_LABELS',
  GET_UNREAD_COUNT: 'GET_UNREAD_COUNT',
  BATCH_MODIFY: 'BATCH_MODIFY',
  CLEAR_LOG: 'CLEAR_LOG',
};

// ─── Risk Levels ─────────────────────────────────────────────────
export const RISK_LEVELS = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
};

// ─── Email Priority ──────────────────────────────────────────────
export const PRIORITIES = {
  URGENT: 'URGENT',
  HIGH: 'HIGH',
  NORMAL: 'NORMAL',
  LOW: 'LOW',
};

// ─── Email Categories ────────────────────────────────────────────
export const CATEGORIES = {
  WORK: 'WORK',
  PERSONAL: 'PERSONAL',
  NEWSLETTER: 'NEWSLETTER',
  PROMOTION: 'PROMOTION',
  FINANCE: 'FINANCE',
  SOCIAL: 'SOCIAL',
  UPDATES: 'UPDATES',
};

// ─── Action Statuses ─────────────────────────────────────────────
export const ACTION_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
};

// ─── Gemini Models ───────────────────────────────────────────────
// Current models available through the Gemini Developer API
// (generateContent). `id` is sent to the API; `label` is shown in the UI.
export const GEMINI_MODELS = [
  { id: 'gemini-3-pro-preview', label: 'Gemini 3 Pro (Preview)' },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (Preview)' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash-Lite' },
];

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

// ─── Default Settings ────────────────────────────────────────────
export const DEFAULT_SETTINGS = {
  geminiModel: DEFAULT_GEMINI_MODEL,
  approvalRequired: {
    low: false,
    medium: true,
    high: true,
  },
  writingTone: 'professional',
  emailSignature: '',
  userName: '',
  maxEmails: 50,
  theme: 'light',
};

// ─── Extension Info ──────────────────────────────────────────────
export const EXTENSION_INFO = {
  name: 'InboxCommander',
  version: '1.0.0',
};

// ─── API Bases ───────────────────────────────────────────────────
export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
