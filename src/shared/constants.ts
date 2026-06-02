/**
 * Shared constants for MailFlow-agent extension.
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
  CHAT_RESPONSE: 'CHAT_RESPONSE',
  CHAT_STREAM: 'CHAT_STREAM',

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

  // Side Panel
  OPEN_SIDE_PANEL: 'OPEN_SIDE_PANEL',
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

// ─── Default Settings ────────────────────────────────────────────
export const DEFAULT_SETTINGS = {
  geminiApiKey: '',
  approvalRequired: {
    low: false,
    medium: true,
    high: true,
  },
  writingTone: 'professional',
  emailSignature: '',
  userName: '',
  maxEmails: 50,
  theme: 'dark',
};

// ─── Extension Info ──────────────────────────────────────────────
export const EXTENSION_INFO = {
  name: 'MailFlow-agent',
  version: '1.0.0',
};

// ─── API Bases ───────────────────────────────────────────────────
export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

