/**
 * MailFlow-agent — Side Panel Logic
 * Main AI chat interface controller
 */

import { MESSAGE_TYPES, RISK_LEVELS, ACTION_STATUS, EXTENSION_INFO } from '../shared/constants.js';

// ─── DOM References ──────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  connectionDot:   $('#connectionDot'),
  settingsBtn:     $('#settingsBtn'),
  authSection:     $('#authSection'),
  authBtn:         $('#authBtn'),
  mainContent:     $('#mainContent'),
  chatInput:       $('#chatInput'),
  sendBtn:         $('#sendBtn'),
  chatMessages:    $('#chatMessages'),
  quickActions:    $('#quickActions'),
  emailContext:    $('#emailContext'),
  ctxFrom:         $('#ctxFrom'),
  ctxSubject:      $('#ctxSubject'),
  ctxPriority:     $('#ctxPriority'),
  ctxCategory:     $('#ctxCategory'),
  approvalsSection: $('#approvalsSection'),
  approvalCount:   $('#approvalCount'),
  approvalsList:   $('#approvalsList'),
  historySection:  $('#historySection'),
  historyList:     $('#historyList'),
  toastContainer:  $('#toastContainer'),
};

// ─── State ───────────────────────────────────────────────────────
let conversationHistory = [];
let currentEmailContext = null;
let isWaitingForResponse = false;

// ─── Initialization ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  setupCollapsibleSections();
  await checkAuthStatus();
  await loadConversationHistory();
});

// ─── Auth ────────────────────────────────────────────────────────
async function checkAuthStatus() {
  try {
    const response = await sendToBackground({ type: MESSAGE_TYPES.AUTH_STATUS });
    updateAuthUI(response?.authenticated ?? false, response?.email);
  } catch {
    updateAuthUI(false);
  }
}

function updateAuthUI(authenticated, email) {
  if (authenticated) {
    dom.authSection.hidden = true;
    dom.mainContent.hidden = false;
    dom.connectionDot.classList.add('connected');
    dom.connectionDot.title = `Connected: ${email ?? 'Gmail'}`;
    fetchPendingApprovals();
    fetchActionHistory();
  } else {
    dom.authSection.hidden = false;
    dom.mainContent.hidden = true;
    dom.connectionDot.classList.remove('connected');
    dom.connectionDot.title = 'Not connected';
  }
}

async function handleLogin() {
  try {
    dom.authBtn.disabled = true;
    dom.authBtn.textContent = 'Connecting...';
    const response = await sendToBackground({ type: MESSAGE_TYPES.AUTH_LOGIN });
    if (response && !response.error) {
      updateAuthUI(true, response.email);
      showToast('Connected to Gmail!', 'success');
    } else {
      showToast(response?.error ?? 'Authentication failed', 'error');
    }
  } catch (err) {
    showToast('Connection failed. Please try again.', 'error');
  } finally {
    dom.authBtn.disabled = false;
    dom.authBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
      Connect to Gmail`;
  }
}

// ─── Chat ────────────────────────────────────────────────────────
async function handleSendMessage() {
  const text = dom.chatInput.value.trim();
  if (!text || isWaitingForResponse) return;

  // Add user message
  addMessage('user', text);
  dom.chatInput.value = '';
  autoResizeTextarea();
  isWaitingForResponse = true;
  dom.sendBtn.disabled = true;

  // Show loading
  const loadingEl = showLoadingIndicator();

  try {
    const payload = {
      type: MESSAGE_TYPES.CHAT,
      message: text,
      context: currentEmailContext ?? undefined,
      history: conversationHistory.slice(-10), // Last 10 messages for context
    };

    const response = await sendToBackground(payload);
    loadingEl.remove();

    if (response?.error) {
      addMessage('agent', `⚠️ ${response.error}`);
    } else {
      addMessage('agent', response?.reply ?? 'I couldn\'t process that request. Please try again.');
      // Render action suggestions if present
      if (response?.actions?.length) {
        renderActionSuggestions(response.actions);
      }
    }
  } catch (err) {
    loadingEl.remove();
    addMessage('agent', '😔 Something went wrong. Please try again.');
  } finally {
    isWaitingForResponse = false;
    dom.sendBtn.disabled = false;
  }
}

function addMessage(role, text) {
  const timestamp = formatTime(new Date());
  conversationHistory.push({ role, text, timestamp });

  const messageEl = document.createElement('div');
  messageEl.className = `message message--${role} fade-in`;
  messageEl.innerHTML = `
    <div class="message__avatar">
      ${role === 'user'
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>'
      }
    </div>
    <div class="message__content">
      <div class="message__role">${role === 'user' ? 'You' : 'MailFlow-agent'}</div>
      <div class="message__text">${escapeHtml(text)}</div>
      <div class="message__time">${timestamp}</div>
    </div>
  `;

  dom.chatMessages.appendChild(messageEl);
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;

  // Persist to session storage
  saveConversationHistory();
}

function showLoadingIndicator() {
  const el = document.createElement('div');
  el.className = 'message message--agent loading-indicator';
  el.innerHTML = `
    <div class="message__avatar">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
    </div>
    <div class="message__content">
      <div class="loading-dots"><span></span><span></span><span></span></div>
    </div>
  `;
  dom.chatMessages.appendChild(el);
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  return el;
}

function renderActionSuggestions(actions) {
  const lastAgentMsg = dom.chatMessages.querySelector('.message--agent:last-child .message__content');
  if (!lastAgentMsg) return;

  actions.forEach((action) => {
    const card = document.createElement('div');
    card.className = 'action-card';
    card.innerHTML = `
      <div class="action-card__title">${escapeHtml(action.title ?? action.type)}</div>
      <div class="action-card__desc">${escapeHtml(action.description ?? '')}</div>
    `;
    card.addEventListener('click', () => {
      sendToBackground({ type: action.type, ...action.payload });
      showToast(`Action "${action.title}" triggered`, 'info');
    });
    lastAgentMsg.appendChild(card);
  });
}

// ─── Quick Actions ───────────────────────────────────────────────
function handleQuickAction(actionType) {
  const labels = {
    SUMMARIZE_INBOX: 'Summarize my inbox',
    PRIORITY_EMAILS: 'Show priority emails',
    UNREAD_EMAILS: 'Show unread emails',
    DRAFT_REPLY: 'Draft a reply',
  };

  const text = labels[actionType] ?? actionType;
  dom.chatInput.value = text;
  handleSendMessage();
}

// ─── Email Context ───────────────────────────────────────────────
function updateEmailContext(context) {
  currentEmailContext = context;

  if (!context) {
    dom.emailContext.hidden = true;
    return;
  }

  dom.emailContext.hidden = false;
  dom.ctxFrom.textContent = context.from ?? '—';
  dom.ctxSubject.textContent = context.subject ?? '—';

  const priority = context.priority ?? 'NORMAL';
  dom.ctxPriority.textContent = priority;
  dom.ctxPriority.dataset.priority = priority;

  const category = context.category ?? 'WORK';
  dom.ctxCategory.textContent = category;
  dom.ctxCategory.dataset.category = category;
}

function handleContextAction(actionType) {
  if (!currentEmailContext) {
    showToast('No email selected', 'warning');
    return;
  }

  const payload = {
    type: MESSAGE_TYPES[actionType],
    emailId: currentEmailContext.emailId,
    threadId: currentEmailContext.threadId,
  };

  sendToBackground(payload).then((response) => {
    if (response?.reply) {
      addMessage('agent', response.reply);
    }
    if (response?.error) {
      showToast(response.error, 'error');
    } else {
      showToast(`${actionType.replace('_', ' ')} initiated`, 'success');
    }
  });
}

// ─── Pending Approvals ──────────────────────────────────────────
async function fetchPendingApprovals() {
  try {
    const response = await sendToBackground({ type: MESSAGE_TYPES.GET_PENDING_APPROVALS });
    const approvals = response?.approvals ?? [];
    renderApprovals(approvals);
  } catch {
    // Silent fail — approvals section just won't show
  }
}

function renderApprovals(approvals) {
  if (!approvals.length) {
    dom.approvalsSection.hidden = true;
    return;
  }

  dom.approvalsSection.hidden = false;
  dom.approvalCount.textContent = approvals.length;

  dom.approvalsList.innerHTML = approvals.map((a) => {
    const riskBadge = `<span class="badge badge--risk" data-risk="${a.risk ?? 'MEDIUM'}">${a.risk ?? 'MEDIUM'}</span>`;
    const icon = getActionIcon(a.actionType);
    return `
      <div class="approval-card" data-id="${a.id}">
        <div class="approval-card__header">
          <div class="approval-card__icon">${icon}</div>
          <div class="approval-card__info">
            <div class="approval-card__type">${escapeHtml(a.actionType ?? 'Action')}</div>
            <div class="approval-card__desc">${escapeHtml(a.description ?? '')}</div>
          </div>
          ${riskBadge}
        </div>
        <div class="approval-card__actions">
          <button class="btn btn--success btn--sm" data-approve="${a.id}">✓ Approve</button>
          <button class="btn btn--secondary btn--sm" data-edit="${a.id}">✎ Edit</button>
          <button class="btn btn--danger btn--sm" data-reject="${a.id}">✕ Reject</button>
        </div>
      </div>
    `;
  }).join('');

  // Bind approval actions
  dom.approvalsList.querySelectorAll('[data-approve]').forEach((btn) => {
    btn.addEventListener('click', () => handleApproval(btn.dataset.approve, 'approve'));
  });
  dom.approvalsList.querySelectorAll('[data-reject]').forEach((btn) => {
    btn.addEventListener('click', () => handleApproval(btn.dataset.reject, 'reject'));
  });
  dom.approvalsList.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => handleApproval(btn.dataset.edit, 'edit'));
  });
}

async function handleApproval(id, action) {
  const typeMap = {
    approve: MESSAGE_TYPES.APPROVE_ACTION,
    reject: MESSAGE_TYPES.REJECT_ACTION,
    edit: MESSAGE_TYPES.EDIT_ACTION,
  };

  try {
    const response = await sendToBackground({ type: typeMap[action], actionId: id });
    showToast(response?.message ?? `Action ${action}d`, action === 'approve' ? 'success' : 'info');
    fetchPendingApprovals();
    fetchActionHistory();
  } catch {
    showToast(`Failed to ${action} action`, 'error');
  }
}

// ─── Action History ──────────────────────────────────────────────
async function fetchActionHistory() {
  try {
    const response = await sendToBackground({ type: MESSAGE_TYPES.GET_ACTION_HISTORY });
    const history = response?.history ?? [];
    renderHistory(history);
  } catch {
    // Silent fail
  }
}

function renderHistory(history) {
  if (!history.length) {
    dom.historyList.innerHTML = `
      <div class="empty-state">
        <span class="empty-state__icon">📋</span>
        <span class="empty-state__text">No actions yet</span>
      </div>
    `;
    return;
  }

  dom.historyList.innerHTML = history.slice(0, 20).map((item) => {
    const statusIcon = {
      [ACTION_STATUS.COMPLETED]: '✅',
      [ACTION_STATUS.FAILED]: '❌',
      [ACTION_STATUS.PENDING]: '⏳',
      [ACTION_STATUS.APPROVED]: '✅',
      [ACTION_STATUS.REJECTED]: '🚫',
    }[item.status] ?? '⏳';

    return `
      <div class="history-item">
        <span class="history-item__icon">${statusIcon}</span>
        <span class="history-item__text">${escapeHtml(item.description ?? item.type ?? 'Action')}</span>
        <span class="history-item__time">${formatTime(new Date(item.timestamp))}</span>
      </div>
    `;
  }).join('');
}

// ─── Collapsible Sections ────────────────────────────────────────
function setupCollapsibleSections() {
  document.querySelectorAll('[data-collapse]').forEach((header) => {
    header.addEventListener('click', () => {
      const targetId = header.dataset.collapse;
      const body = document.getElementById(targetId);
      if (!body) return;

      body.classList.toggle('section-body--collapsed');
      header.classList.toggle('collapsed');
    });
  });
}

// ─── Event Listeners ─────────────────────────────────────────────
function setupEventListeners() {
  // Auth
  dom.authBtn.addEventListener('click', handleLogin);

  // Settings
  dom.settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Chat input
  dom.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });
  dom.chatInput.addEventListener('input', autoResizeTextarea);
  dom.sendBtn.addEventListener('click', handleSendMessage);

  // Quick actions
  dom.quickActions.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip?.dataset.action) {
      handleQuickAction(chip.dataset.action);
    }
  });

  // Email context actions
  document.querySelectorAll('[data-ctx-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      handleContextAction(btn.dataset.ctxAction);
    });
  });

  // Listen for messages from content script / service worker
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
      case MESSAGE_TYPES.EMAIL_CONTEXT_UPDATE:
        updateEmailContext(message.context);
        break;
      case MESSAGE_TYPES.EMAIL_CONTEXT_CLEAR:
        updateEmailContext(null);
        break;
      case MESSAGE_TYPES.AUTH_STATUS_RESPONSE:
        updateAuthUI(message.authenticated, message.email);
        break;
      default:
        break;
    }
    sendResponse({ received: true });
    return true;
  });
}

// ─── Textarea Auto-Resize ────────────────────────────────────────
function autoResizeTextarea() {
  dom.chatInput.style.height = 'auto';
  dom.chatInput.style.height = Math.min(dom.chatInput.scrollHeight, 100) + 'px';
}

// ─── Toast Notifications ─────────────────────────────────────────
function showToast(message, type = 'info') {
  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ',
  };

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `<span>${icons[type] ?? ''}</span> ${escapeHtml(message)}`;
  dom.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('removing');
    toast.addEventListener('animationend', () => toast.remove());
  }, 3000);
}

// ─── Persistence ─────────────────────────────────────────────────
async function saveConversationHistory() {
  try {
    await chrome.storage.session.set({ conversationHistory });
  } catch {
    // Session storage may not be available
  }
}

async function loadConversationHistory() {
  try {
    const data = await chrome.storage.session.get('conversationHistory');
    if (data.conversationHistory?.length) {
      conversationHistory = data.conversationHistory;
      // Re-render messages (skip the welcome message already in DOM)
      conversationHistory.forEach(({ role, text, timestamp }) => {
        const messageEl = document.createElement('div');
        messageEl.className = `message message--${role}`;
        messageEl.innerHTML = `
          <div class="message__avatar">
            ${role === 'user'
              ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
              : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>'
            }
          </div>
          <div class="message__content">
            <div class="message__role">${role === 'user' ? 'You' : 'MailFlow-agent'}</div>
            <div class="message__text">${escapeHtml(text)}</div>
            <div class="message__time">${timestamp}</div>
          </div>
        `;
        dom.chatMessages.appendChild(messageEl);
      });
      dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
    }
  } catch {
    // Ignore
  }
}

// ─── Helpers ─────────────────────────────────────────────────────
function sendToBackground(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response && typeof response === 'object' && 'success' in response) {
        if (response.success) {
          resolve(response.data);
        } else {
          resolve({ error: response.error || 'Unknown error' });
        }
      } else {
        resolve(response);
      }
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatTime(date) {
  if (!(date instanceof Date) || isNaN(date)) return 'Just now';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getActionIcon(type) {
  const icons = {
    ARCHIVE_EMAIL: '📦',
    TRASH_EMAIL: '🗑️',
    LABEL_EMAIL: '🏷️',
    DRAFT_REPLY: '✏️',
    SEND_EMAIL: '📤',
    SUMMARIZE_EMAIL: '📝',
  };
  return icons[type] ?? '⚡';
}
