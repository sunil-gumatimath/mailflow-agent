/**
 * InboxCommander — Side Panel Logic
 * Main AI chat interface controller
 */

import { MESSAGE_TYPES } from '../shared/constants';
import type { ConversationTurn, EmailContext, QueuedAction } from '../shared/types';
import { applyStoredTheme } from '../shared/utils';
import { sendToBackground } from '../shared/messaging';
import { escapeHtml } from '../shared/escape';
import { formatMessageText } from '../shared/markdown';
import type { TimelineEvent } from '../background/ai-provider';

// ─── DOM References ──────────────────────────────────────────────
const $ = <T extends Element = HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);

const dom = {
  get connectionDot() { return $('#connectionDot'); },
  get settingsBtn() { return $('#settingsBtn') as HTMLButtonElement | null; },
  get authSection() { return $('#authSection'); },
  get authBtn() { return $('#authBtn') as HTMLButtonElement | null; },
  get mainContent() { return $('#mainContent'); },
  get chatInput() { return $('#chatInput') as HTMLTextAreaElement | null; },
  get sendBtn() { return $('#sendBtn') as HTMLButtonElement | null; },
  get chatMessages() { return $('#chatMessages'); },
  get quickActions() { return $('#quickActions'); },
  get emailContext() { return $('#emailContext'); },
  get ctxFrom() { return $('#ctxFrom'); },
  get ctxSubject() { return $('#ctxSubject'); },
  get ctxPriority() { return $('#ctxPriority'); },
  get ctxCategory() { return $('#ctxCategory'); },
  get approvalsSection() { return $('#approvalsSection'); },
  get approvalCount() { return $('#approvalCount'); },
  get approvalsList() { return $('#approvalsList'); },
  get historySection() { return $('#historySection'); },
  get historyList() { return $('#historyList'); },
  get toastContainer() { return $('#toastContainer'); },
  get clearChatBtn() { return $('#clearChatBtn') as HTMLButtonElement | null; },
  get summarizeInboxChip() { return $('[data-action="SUMMARIZE_INBOX"]') as HTMLButtonElement | null; },
  get summarizeEmailChip() { return $('#summarizeEmailChip') as HTMLButtonElement | null; },
  get draftReplyChip() { return $('#draftReplyChip') as HTMLButtonElement | null; },
  get draftPanel() { return $('#draftPanel'); },
  get draftInstruction() { return $('#draftInstruction') as HTMLTextAreaElement | null; },
  get draftTone() { return $('#draftTone') as HTMLSelectElement | null; },
  get draftLength() { return $('#draftLength') as HTMLSelectElement | null; },
  get cancelDraftBtn() { return $('#cancelDraftBtn') as HTMLButtonElement | null; },
  get generateDraftBtn() { return $('#generateDraftBtn') as HTMLButtonElement | null; },
  get timelinePanel() { return $('#timelinePanel'); },
  get timelineLoading() { return $('#timelineLoading'); },
  get timelineEventsList() { return $('#timelineEventsList'); },
  get closeTimelineBtn() { return $('#closeTimelineBtn') as HTMLButtonElement | null; },
};

// ─── State ───────────────────────────────────────────────────────
let conversationHistory: ConversationTurn[] = [];
let currentEmailContext: EmailContext | null = null;
let isWaitingForResponse = false;

// ─── Initialization ──────────────────────────────────────────────
async function initSidepanel(): Promise<void> {
  await applyStoredTheme();
  setupEventListeners();
  setupCollapsibleSections();
  await checkAuthStatus();
  await loadConversationHistory();
  await checkPendingQuickAction();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSidepanel);
} else {
  initSidepanel();
}

async function checkPendingQuickAction(): Promise<void> {
  try {
    const { pendingQuickAction, pendingEmailContext } = (await chrome.storage.session.get([
      'pendingQuickAction',
      'pendingEmailContext',
    ])) as {
      pendingQuickAction?: string;
      pendingEmailContext?: GmailContextSnapshot;
    };
    if (pendingQuickAction) {
      await chrome.storage.session.remove(['pendingQuickAction', 'pendingEmailContext']);
      setTimeout(() => {
        handleQuickAction(pendingQuickAction, pendingEmailContext ?? null);
      }, 500);
    }
  } catch {
    // Best-effort: the side panel may not be available in every Chrome version
  }
}

interface GmailContextSnapshot {
  view: 'inbox' | 'thread' | 'compose' | null;
  threadId: string | null;
  emailId: string | null;
  url?: string;
}

// ─── Auth ────────────────────────────────────────────────────────
async function checkAuthStatus(): Promise<void> {
  try {
    const response = await sendToBackground({ type: MESSAGE_TYPES.AUTH_STATUS });
    updateAuthUI(response?.authenticated ?? false, response?.email);
  } catch {
    updateAuthUI(false);
  }
}

function updateAuthUI(authenticated: boolean, email?: string | null): void {
  if (authenticated) {
    if (dom.authSection) dom.authSection.hidden = true;
    if (dom.mainContent) dom.mainContent.hidden = false;
    dom.connectionDot?.classList.add('connected');
    if (dom.connectionDot) {
      dom.connectionDot.title = `Connected: ${email ?? 'Gmail'}`;
    }
    fetchPendingApprovals();
    fetchActionHistory();
    requestCurrentEmailContext();
  } else {
    if (dom.authSection) dom.authSection.hidden = false;
    if (dom.mainContent) dom.mainContent.hidden = true;
    dom.connectionDot?.classList.remove('connected');
    if (dom.connectionDot) {
      dom.connectionDot.title = 'Not connected';
    }
  }
}

async function handleLogin(): Promise<void> {
  if (!dom.authBtn) return;
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
  } catch {
    showToast('Connection failed. Please try again.', 'error');
  } finally {
    dom.authBtn.disabled = false;
    dom.authBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
      Connect to Gmail`;
  }
}

// ─── Chat ────────────────────────────────────────────────────────
async function handleSendMessage(): Promise<void> {
  if (!dom.chatInput || !dom.sendBtn) return;
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
      emailContext: currentEmailContext ?? null,
      conversationHistory: conversationHistory.slice(-10),
    };

    const response = await sendToBackground(payload);
    loadingEl.remove();

    if (response?.error) {
      addMessage('agent', `⚠️ ${response.error}`);
    } else {
      addMessage('agent', response?.reply ?? 'I couldn\'t process that request. Please try again.');
    }
  } catch {
    loadingEl.remove();
    addMessage('agent', '😔 Something went wrong. Please try again.');
  } finally {
    isWaitingForResponse = false;
    dom.sendBtn.disabled = false;
  }
}

function addMessage(role: string, text: string): void {
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
      <div class="message__role">${role === 'user' ? 'You' : 'InboxCommander'}</div>
      <div class="message__text">${formatMessageText(text)}</div>
      <div class="message__time">${timestamp}</div>
    </div>
  `;

  if (dom.chatMessages) {
    dom.chatMessages.appendChild(messageEl);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  }

  // Persist to session storage
  saveConversationHistory();
}

function showLoadingIndicator(): HTMLElement {
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
  if (dom.chatMessages) {
    dom.chatMessages.appendChild(el);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  }
  return el;
}

// ─── Quick Actions ───────────────────────────────────────────────
async function handleQuickAction(
  actionType: string,
  pendingContext: GmailContextSnapshot | null = null,
): Promise<void> {
  // If user requested SUMMARIZE_INBOX but we have an active open email context,
  // target that email instead as expected.
  if (actionType === 'SUMMARIZE_INBOX' && currentEmailContext) {
    actionType = 'SUMMARIZE_EMAIL';
  }

  // Map the popup-passed context (if any) to the format expected by the
  // service worker for SUMMARIZE_EMAIL.
  const pendingContextPayload =
    pendingContext && pendingContext.view === 'thread' && (pendingContext.emailId || pendingContext.threadId)
      ? { emailId: pendingContext.emailId ?? null, threadId: pendingContext.threadId ?? null }
      : null;

  const labels: Record<string, string> = {
    SUMMARIZE_INBOX: 'Summarize my inbox',
    SUMMARIZE_EMAIL: 'Summarize this email',
    PRIORITY_EMAILS: 'Show priority emails',
    UNREAD_EMAILS: 'Show unread emails',
    DRAFT_REPLY: 'Draft a reply',
  };

  // Summarize Email needs the currently open email.
  if (actionType === 'SUMMARIZE_EMAIL') {
    if (pendingContextPayload) {
      await runInboxAction(
        MESSAGE_TYPES.SUMMARIZE_EMAIL,
        'Summarize this email',
        pendingContextPayload,
      );
    } else if (currentEmailContext) {
      await runInboxAction(
        MESSAGE_TYPES.SUMMARIZE_EMAIL,
        'Summarize this email',
        {
          emailId: currentEmailContext.emailId,
          threadId: currentEmailContext.threadId,
        }
      );
    } else {
      showToast('Open an email first to summarize it', 'warning');
    }
    return;
  }

  // Inbox-wide actions have dedicated background handlers that read the inbox.
  const inboxActions: Record<string, string> = {
    SUMMARIZE_INBOX: MESSAGE_TYPES.SUMMARIZE_INBOX,
    PRIORITY_EMAILS: MESSAGE_TYPES.PRIORITY_EMAILS,
    UNREAD_EMAILS: MESSAGE_TYPES.UNREAD_EMAILS,
  };

  const backgroundType = inboxActions[actionType];
  if (backgroundType) {
    await runInboxAction(backgroundType, labels[actionType] ?? actionType);
    return;
  }

  // Drafting a reply needs the currently open email.
  if (actionType === 'DRAFT_REPLY') {
    if (currentEmailContext) {
      handleContextAction('DRAFT_REPLY');
    } else {
      showToast('Open an email first to draft a reply', 'warning');
    }
    return;
  }

  // Anything else falls back to a plain chat message.
  if (dom.chatInput) {
    dom.chatInput.value = labels[actionType] ?? actionType;
    handleSendMessage();
  }
}

/** Run an inbox-wide or context quick action against its dedicated background handler. */
async function runInboxAction(type: string, label: string, extraPayload: Record<string, any> = {}): Promise<void> {
  if (isWaitingForResponse) return;

  addMessage('user', label);
  isWaitingForResponse = true;
  if (dom.sendBtn) dom.sendBtn.disabled = true;

  const loadingEl = showLoadingIndicator();

  try {
    const response = await sendToBackground({ type, ...extraPayload });
    loadingEl.remove();
    if (response?.error) {
      addMessage('agent', `⚠️ ${response.error}`);
    } else {
      addMessage('agent', response?.reply ?? response?.summary ?? 'No results found.');
    }
  } catch {
    loadingEl.remove();
    addMessage('agent', '😔 Something went wrong. Please try again.');
  } finally {
    isWaitingForResponse = false;
    if (dom.sendBtn) dom.sendBtn.disabled = false;
  }
}

// ─── Email Context ───────────────────────────────────────────────
/**
 * Ask the active Gmail tab for the email currently open, then have the
 * service worker rebuild and broadcast the full context (including the body).
 * Needed when the side panel is opened *after* an email is already open —
 * the content script only broadcasts on navigation changes.
 */
async function requestCurrentEmailContext(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.includes('mail.google.com')) return;

    try {
      const ctx = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CURRENT_CONTEXT' });
      if (ctx?.view === 'thread' && (ctx.threadId || ctx.emailId)) {
        // Triggers EMAIL_CONTEXT_UPDATE broadcast from the service worker.
        await sendToBackground({
          type: 'GMAIL_CONTEXT_CHANGE',
          context: { 
            view: 'thread', 
            threadId: ctx.threadId, 
            emailId: ctx.emailId, 
            url: ctx.url 
          },
        });
      }
    } catch (msgErr) {
      console.warn('[InboxCommander] Failed to communicate with content script:', msgErr);
      showToast('Please refresh Gmail to enable email-specific features', 'warning');
    }
  } catch (err) {
    console.error('[InboxCommander] Error querying active tab:', err);
  }
}

function updateEmailContext(context: EmailContext | null): void {
  if (!context) {
    currentEmailContext = null;
    if (dom.emailContext) dom.emailContext.hidden = true;
    if (dom.summarizeInboxChip) dom.summarizeInboxChip.style.display = '';
    if (dom.summarizeEmailChip) dom.summarizeEmailChip.style.display = 'none';
    if (dom.draftReplyChip) dom.draftReplyChip.style.display = 'none';
    hideDraftPanel();
    hideTimelinePanel();
    return;
  }

  // Merge updates for the same thread so a later, partial update (e.g. one
  // emitted by the content script without the email body) can't wipe richer
  // data we already received from the service worker.
  if (currentEmailContext && currentEmailContext.threadId === context.threadId) {
    currentEmailContext = {
      ...currentEmailContext,
      ...context,
      emailId: context.emailId ?? currentEmailContext.emailId,
      body: context.body ?? currentEmailContext.body,
      priority: context.priority ?? currentEmailContext.priority,
      category: context.category ?? currentEmailContext.category,
    };
  } else {
    currentEmailContext = context;
    hideDraftPanel();
    hideTimelinePanel();
  }

  const ctx = currentEmailContext;
  if (dom.emailContext) dom.emailContext.hidden = false;
  if (dom.ctxFrom) dom.ctxFrom.textContent = ctx.from ?? '—';
  if (dom.ctxSubject) dom.ctxSubject.textContent = ctx.subject ?? '—';

  const priority = ctx.priority ?? 'NORMAL';
  if (dom.ctxPriority) {
    dom.ctxPriority.textContent = priority;
    (dom.ctxPriority as HTMLElement).dataset.priority = priority;
  }

  const category = ctx.category ?? 'WORK';
  if (dom.ctxCategory) {
    dom.ctxCategory.textContent = category;
    (dom.ctxCategory as HTMLElement).dataset.category = category;
  }

  if (dom.summarizeInboxChip) dom.summarizeInboxChip.style.display = 'none';
  if (dom.summarizeEmailChip) dom.summarizeEmailChip.style.display = '';
  if (dom.draftReplyChip) dom.draftReplyChip.style.display = '';
}

function handleContextAction(actionType: string): void {
  if (!currentEmailContext) {
    showToast('No email selected', 'warning');
    return;
  }

  if (actionType === 'LABEL_EMAIL') {
    handleLabelAction();
    return;
  }

  if (actionType === 'DRAFT_REPLY') {
    showDraftPanel();
    return;
  }

  if (actionType === 'VIEW_TIMELINE') {
    showTimelinePanel();
    return;
  }

  const isTextAction = ['SUMMARIZE_EMAIL', 'SUMMARIZE_THREAD'].includes(actionType);

  if (isTextAction) {
    const labels: Record<string, string> = {
      SUMMARIZE_EMAIL: 'Summarize this email',
      SUMMARIZE_THREAD: 'Summarize this thread',
    };

    // Redirect through the clean chat flow with loading state and user message
    runInboxAction(
      (MESSAGE_TYPES as Record<string, string>)[actionType] || actionType,
      labels[actionType] ?? actionType,
      {
        emailId: currentEmailContext.emailId,
        threadId: currentEmailContext.threadId,
      }
    );
    return;
  }

  // Mutating actions go to background and queue
  const payload = {
    type: (MESSAGE_TYPES as Record<string, string>)[actionType] || actionType,
    emailId: currentEmailContext.emailId,
    threadId: currentEmailContext.threadId,
  };

  sendToBackground(payload).then((response) => {
    if (response?.error) {
      showToast(response.error, 'error');
    } else {
      showToast(`${actionType.replace('_', ' ')} initiated`, 'success');
      // Refresh pending approvals and log history
      fetchPendingApprovals();
      fetchActionHistory();
    }
  });
}

async function handleLabelAction(): Promise<void> {
  if (!currentEmailContext?.emailId) {
    showToast('No email selected', 'warning');
    return;
  }

  try {
    const labels = await sendToBackground({ type: MESSAGE_TYPES.GET_LABELS });
    const labelList = Array.isArray(labels) ? labels : [];
    const userLabels = labelList.filter((label: any) => label?.id && label?.name && label.type !== 'system');
    const choices = userLabels.map((label: any) => label.name).join(', ');
    const requested = window.prompt(
      choices ? `Apply which label?\n\nAvailable labels: ${choices}` : 'Apply which label ID?',
      '',
    );
    if (requested === null) return;

    const value = requested.trim();
    if (!value) {
      showToast('Label is required', 'warning');
      return;
    }

    const match = labelList.find((label: any) =>
      label?.id === value || String(label?.name ?? '').toLowerCase() === value.toLowerCase()
    );
    const labelId = match?.id ?? value;
    const labelName = match?.name ?? value;

    const response = await sendToBackground({
      type: MESSAGE_TYPES.LABEL_EMAIL,
      messageId: currentEmailContext.emailId,
      labelId,
      reason: `Apply label: ${labelName}`,
    });

    if (response?.error) {
      showToast(response.error, 'error');
    } else {
      showToast('Label action queued', 'success');
      fetchPendingApprovals();
      fetchActionHistory();
    }
  } catch {
    showToast('Failed to load labels', 'error');
  }
}

// ─── Pending Approvals ──────────────────────────────────────────
async function fetchPendingApprovals(): Promise<void> {
  try {
    const response = await sendToBackground({ type: MESSAGE_TYPES.GET_PENDING_APPROVALS });
    const approvals = response?.approvals ?? [];
    renderApprovals(approvals);
  } catch {
    // Silent fail — approvals section just won't show
  }
}

function renderApprovals(approvals: QueuedAction[]): void {
  if (!approvals.length) {
    if (dom.approvalsSection) dom.approvalsSection.hidden = true;
    return;
  }

  if (dom.approvalsSection) dom.approvalsSection.hidden = false;
  if (dom.approvalCount) dom.approvalCount.textContent = String(approvals.length);

  if (dom.approvalsList) {
    dom.approvalsList.innerHTML = approvals.map((a) => {
      const riskBadge = `<span class="badge badge--risk" data-risk="${a.riskLevel ?? 'MEDIUM'}">${a.riskLevel ?? 'MEDIUM'}</span>`;
      const icon = getActionIcon(a.type);
      return `
        <div class="approval-card" data-id="${a.id}">
          <div class="approval-card__header">
            <div class="approval-card__icon">${icon}</div>
            <div class="approval-card__info">
              <div class="approval-card__type">${escapeHtml(a.type ?? 'Action')}</div>
              <div class="approval-card__desc">${escapeHtml(a.reason ?? '')}</div>
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
      const b = btn as HTMLElement;
      b.addEventListener('click', () => {
        if (b.dataset.approve) handleApproval(b.dataset.approve, 'approve');
      });
    });
    dom.approvalsList.querySelectorAll('[data-reject]').forEach((btn) => {
      const b = btn as HTMLElement;
      b.addEventListener('click', () => {
        if (b.dataset.reject) handleApproval(b.dataset.reject, 'reject');
      });
    });
    dom.approvalsList.querySelectorAll('[data-edit]').forEach((btn) => {
      const b = btn as HTMLElement;
      b.addEventListener('click', () => {
        if (b.dataset.edit) handleApproval(b.dataset.edit, 'edit');
      });
    });
  }
}

async function handleApproval(id: string, action: 'approve' | 'reject' | 'edit'): Promise<void> {
  if (action === 'edit') {
    return handleEditAction(id);
  }

  const type = action === 'approve' ? MESSAGE_TYPES.APPROVE_ACTION : MESSAGE_TYPES.REJECT_ACTION;

  try {
    const response = await sendToBackground({ type, actionId: id });
    if (response?.error) {
      showToast(response.error, 'error');
    } else {
      showToast(`Action ${action}d`, action === 'approve' ? 'success' : 'info');
    }
    fetchPendingApprovals();
    fetchActionHistory();
  } catch {
    showToast(`Failed to ${action} action`, 'error');
  }
}

/** Prompt the user to revise a pending action's note, then persist the edit. */
async function handleEditAction(id: string): Promise<void> {
  const card = dom.approvalsList?.querySelector(`.approval-card[data-id="${id}"]`);
  const currentReason = card?.querySelector('.approval-card__desc')?.textContent ?? '';
  const newReason = window.prompt('Edit the note for this action:', currentReason);
  if (newReason === null) return; // user cancelled

  try {
    await sendToBackground({ type: MESSAGE_TYPES.EDIT_ACTION, actionId: id, reason: newReason });
    showToast('Action updated', 'success');
    fetchPendingApprovals();
  } catch {
    showToast('Failed to edit action', 'error');
  }
}

// ─── Action History ──────────────────────────────────────────────
async function fetchActionHistory(): Promise<void> {
  try {
    const response = await sendToBackground({ type: MESSAGE_TYPES.GET_ACTION_HISTORY });
    const history = response?.history ?? [];
    renderHistory(history);
  } catch {
    // Silent fail
  }
}

function renderHistory(history: QueuedAction[]): void {
  if (!dom.historyList) return;
  if (!history.length) {
    dom.historyList.innerHTML = `
      <div class="empty-state">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span>No actions yet</span>
      </div>
    `;
    return;
  }

  dom.historyList.innerHTML = history.slice(0, 20).map((item) => {
    // Statuses are written lowercase by the action queue (executed/failed/…).
    const statusIcon = {
      executed: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
      failed: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
      pending: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
      approved: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
      rejected: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    }[item.status] ?? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';

    return `
      <div class="history-item">
        <span class="history-item__icon">${statusIcon}</span>
        <span class="history-item__text">${escapeHtml(item.reason || item.type || 'Action')}</span>
        <span class="history-item__time">${formatTime(new Date(item.timestamp))}</span>
      </div>
    `;
  }).join('');
}

// ─── Collapsible Sections ────────────────────────────────────────
function setupCollapsibleSections(): void {
  document.querySelectorAll('[data-collapse]').forEach((header) => {
    const h = header as HTMLElement;
    const toggle = () => {
      const targetId = h.dataset.collapse;
      if (!targetId) return;
      const body = document.getElementById(targetId);
      if (!body) return;

      body.classList.toggle('section-body--collapsed');
      h.classList.toggle('collapsed');
      h.setAttribute('aria-expanded', String(!body.classList.contains('section-body--collapsed')));
    };

    h.addEventListener('click', toggle);
    h.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
  });
}

// ─── Event Listeners ─────────────────────────────────────────────
function setupEventListeners(): void {
  // Auth
  dom.authBtn?.addEventListener('click', handleLogin);

  // Settings
  dom.settingsBtn?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Clear chat
  dom.clearChatBtn?.addEventListener('click', () => {
    conversationHistory = [];
    if (dom.chatMessages) {
      dom.chatMessages.innerHTML = `
        <div class="message message--agent fade-in">
          <div class="message__avatar" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>
          <div class="message__content">
            <div class="message__role">InboxCommander</div>
            <div class="message__text">👋 Hello! I can summarize emails, draft replies, search your inbox, and more. What would you like to do?</div>
            <div class="message__time">Just now</div>
          </div>
        </div>
      `;
    }
    saveConversationHistory();
    showToast('Chat cleared', 'info');
  });

  // Chat input
  dom.chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });
  dom.chatInput?.addEventListener('input', autoResizeTextarea);
  dom.sendBtn?.addEventListener('click', handleSendMessage);

  // Quick actions
  dom.quickActions?.addEventListener('click', (e) => {
    const chip = (e.target as Element).closest('.chip') as HTMLElement | null;
    if (chip?.dataset.action) {
      handleQuickAction(chip.dataset.action);
    }
  });

  // Email context actions
  document.querySelectorAll('[data-ctx-action]').forEach((btn) => {
    const b = btn as HTMLElement;
    b.addEventListener('click', () => {
      if (b.dataset.ctxAction) {
        handleContextAction(b.dataset.ctxAction);
      }
    });
  });

  // Listen for messages from content script / service worker
  chrome.runtime.onMessage.addListener((message: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
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
      case 'TRIGGER_QUICK_ACTION':
        if (message.action) {
          handleQuickAction(message.action);
        }
        break;
      default:
        break;
    }
    sendResponse({ received: true });
  });

  // Draft Options Panel Events
  dom.cancelDraftBtn?.addEventListener('click', hideDraftPanel);
  dom.generateDraftBtn?.addEventListener('click', handleGenerateDraft);

  // Preset buttons click handler
  document.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest('.preset-btn') as HTMLElement | null;
    if (btn) {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }
  });

  // Timeline Panel Events
  dom.closeTimelineBtn?.addEventListener('click', hideTimelinePanel);
}

// ─── Textarea Auto-Resize ────────────────────────────────────────
function autoResizeTextarea(): void {
  if (!dom.chatInput) return;
  dom.chatInput.style.height = 'auto';
  dom.chatInput.style.height = Math.min(dom.chatInput.scrollHeight, 100) + 'px';
}

// ─── Toast Notifications ─────────────────────────────────────────
function showToast(message: string, type: 'success' | 'error' | 'warning' | 'info' | string = 'info'): void {
  const icons: Record<string, string> = {
    success: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    error: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    warning: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  };

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `<span>${icons[type] ?? ''}</span> ${escapeHtml(message)}`;
  if (dom.toastContainer) {
    dom.toastContainer.appendChild(toast);
  }

  setTimeout(() => {
    toast.classList.add('removing');
    toast.addEventListener('animationend', () => toast.remove());
  }, 3000);
}

// ─── Persistence ─────────────────────────────────────────────────
async function saveConversationHistory(): Promise<void> {
  try {
    await chrome.storage.session.set({ conversationHistory });
  } catch {
    // Session storage may not be available
  }
}

async function loadConversationHistory(): Promise<void> {
  try {
    const data = (await chrome.storage.session.get('conversationHistory')) as { conversationHistory?: ConversationTurn[] };
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
            <div class="message__role">${role === 'user' ? 'You' : 'InboxCommander'}</div>
            <div class="message__text">${formatMessageText(text)}</div>
            <div class="message__time">${timestamp}</div>
          </div>
        `;
        if (dom.chatMessages) dom.chatMessages.appendChild(messageEl);
      });
      if (dom.chatMessages) dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
    }
  } catch {
    // Ignore
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

function formatTime(date: Date): string {
  if (!(date instanceof Date) || isNaN(date.getTime())) return 'Just now';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getActionIcon(type: string): string {
  const icons: Record<string, string> = {
    ARCHIVE_EMAIL: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>',
    TRASH_EMAIL: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    LABEL_EMAIL: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
    DRAFT_REPLY: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    SEND_EMAIL: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    SUMMARIZE_EMAIL: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
  };
  return icons[type] ?? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
}

// ─── Smart Drafting Operations ───────────────────────────────────

async function showDraftPanel(): Promise<void> {
  if (!dom.draftPanel) return;

  // Clear input
  if (dom.draftInstruction) dom.draftInstruction.value = '';

  // Reset presets
  document.querySelectorAll('.preset-btn').forEach(btn => {
    if ((btn as HTMLElement).dataset.preset === 'custom') {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Pre-fill tone with saved settings tone
  try {
    const response = await sendToBackground({ type: MESSAGE_TYPES.GET_SETTINGS });
    if (response?.success && response.data) {
      const settings = response.data;
      if (dom.draftTone && settings.writingTone) {
        dom.draftTone.value = settings.writingTone;
      }
    }
  } catch (err) {
    console.warn('[InboxCommander] Failed to fetch settings for draft panel default:', err);
  }

  dom.draftPanel.hidden = false;
  if (dom.draftInstruction) dom.draftInstruction.focus();
}

function hideDraftPanel(): void {
  if (dom.draftPanel) dom.draftPanel.hidden = true;
}

async function handleGenerateDraft(): Promise<void> {
  if (!currentEmailContext || isWaitingForResponse) return;

  const presetBtn = document.querySelector('.preset-btn.active') as HTMLElement | null;
  const preset = presetBtn?.dataset.preset ?? 'custom';
  const customText = dom.draftInstruction?.value.trim() ?? '';
  const tone = dom.draftTone?.value ?? 'professional';
  const length = dom.draftLength?.value ?? 'medium';

  let presetInstruction = '';
  if (preset === 'agree') {
    presetInstruction = 'Politely agree and accept the proposal/request.';
  } else if (preset === 'decline') {
    presetInstruction = 'Politely decline the proposal/request.';
  } else if (preset === 'info') {
    presetInstruction = 'Ask for more details or clarification.';
  }

  let finalInstruction: string;
  if (presetInstruction && customText) {
    finalInstruction = `${presetInstruction} Additional instruction: ${customText}`;
  } else if (presetInstruction) {
    finalInstruction = presetInstruction;
  } else {
    finalInstruction = customText || 'Draft a reply.';
  }

  hideDraftPanel();

  await runInboxAction(
    MESSAGE_TYPES.DRAFT_REPLY,
    `Draft reply (${preset === 'custom' ? 'custom' : preset}, tone: ${tone}, length: ${length})`,
    {
      emailId: currentEmailContext.emailId,
      threadId: currentEmailContext.threadId,
      instruction: finalInstruction,
      tone: tone,
      length: length,
    }
  );
}

// ─── Timeline Operations ─────────────────────────────────────────

function showTimelinePanel(): void {
  if (!dom.timelinePanel) return;
  hideDraftPanel(); // Avoid overlapping options
  dom.timelinePanel.hidden = false;
  loadTimeline();
}

function hideTimelinePanel(): void {
  if (dom.timelinePanel) dom.timelinePanel.hidden = true;
}

async function loadTimeline(): Promise<void> {
  if (!currentEmailContext || !dom.timelineLoading || !dom.timelineEventsList) return;

  dom.timelineLoading.hidden = false;
  dom.timelineEventsList.innerHTML = '';

  try {
    const res = await sendToBackground({
      type: MESSAGE_TYPES.GET_THREAD_TIMELINE,
      threadId: currentEmailContext.threadId,
    });

    if (res?.success && res.data?.timeline) {
      const events = res.data.timeline;
      if (events.length === 0) {
        dom.timelineEventsList.innerHTML = '<div class="empty-state" style="padding: 12px 0;">No timeline events extracted.</div>';
        return;
      }

      dom.timelineEventsList.innerHTML = events.map((event: TimelineEvent) => {
        const typeLabel = event.type ? event.type.toUpperCase() : 'UPDATE';
        const senderName = event.sender ? escapeHtml((event.sender.split('<')[0] ?? '').trim()) : 'Unknown';
        
        return `
          <div class="timeline-node" data-type="${escapeHtml(event.type || 'update')}">
            <div class="timeline-node-header">
              <span class="timeline-node-sender">${senderName}</span>
              <span>${escapeHtml(typeLabel)}</span>
            </div>
            <div class="timeline-node-summary">${escapeHtml(event.summary)}</div>
          </div>
        `;
      }).join('');
    } else {
      dom.timelineEventsList.innerHTML = `<div class="empty-state" style="padding: 12px 0; color: var(--red);">Failed to load timeline. ${escapeHtml(res?.error || '')}</div>`;
    }
  } catch (err) {
    console.error('[InboxCommander] loadTimeline failed:', err);
    dom.timelineEventsList.innerHTML = '<div class="empty-state" style="padding: 12px 0; color: var(--red);">Error connecting to background worker.</div>';
  } finally {
    dom.timelineLoading.hidden = true;
  }
}
