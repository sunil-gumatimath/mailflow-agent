/**
 * options/options.ts
 * Settings page logic
 */

import { DEFAULT_SETTINGS, MESSAGE_TYPES, GEMINI_MODELS, DEFAULT_GEMINI_MODEL } from '../shared/constants';
import type { Settings, AutoPilotRule } from '../shared/types';
import { applyStoredTheme } from '../shared/utils';
import { sendToBackground } from '../shared/messaging';
import { escapeHtml } from '../shared/escape';
import { getRules, saveRules } from '../shared/storage';
import type { GmailLabel } from '../background/gmail-api';
import type { AnalyticsResult } from '../background/ai-provider';

const $ = <T extends Element = HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);

const dom = {
  get apiKeyInput() { return $('#apiKey') as HTMLInputElement | null; },
  get toggleApiKeyBtn() { return $('#toggleApiKey') as HTMLButtonElement | null; },
  get testApiBtn() { return $('#testApiBtn') as HTMLButtonElement | null; },
  get testApiStatus() { return $('#apiStatus'); },
  get geminiModel() { return $('#geminiModel') as HTMLSelectElement | null; },
  
  get approveLow() { return $('#approvalLow') as HTMLInputElement | null; },
  get approveMedium() { return $('#approvalMedium') as HTMLInputElement | null; },
  get approveHigh() { return $('#approvalHigh') as HTMLInputElement | null; },
  
  get toneSelect() { return $('#writingTone') as HTMLSelectElement | null; },
  get signatureText() { return $('#emailSignature') as HTMLTextAreaElement | null; },
  get userName() { return $('#userName') as HTMLInputElement | null; },
  
  get maxEmails() { return $('#maxEmails') as HTMLInputElement | null; },
  
  get connectedEmail() { return $('#accountEmail'); },
  get accountIndicator() { return $('#accountIndicator'); },
  get accountStatusText() { return $('#accountStatusText'); },
  get disconnectBtn() { return $('#disconnectBtn') as HTMLButtonElement | null; },
  
  get saveBar() { return $('#saveBar') as HTMLElement | null; },
  get saveBtn() { return $('#saveBtn') as HTMLButtonElement | null; },
  get themeDark() { return $('#themeDark'); },
  get themeLight() { return $('#themeLight'); },
  
  get clearLogBtn() { return $('#clearLogBtn') as HTMLButtonElement | null; },
  get actionLog() { return $('#actionLog'); },
  get toastContainer() { return $('#toastContainer'); },
  
  // Auto-Pilot
  get rulesList() { return $('#rulesList'); },
  get newRuleBtn() { return $('#newRuleBtn') as HTMLButtonElement | null; },
  get ruleModal() { return $('#ruleModal') as HTMLElement | null; },
  get modalTitle() { return $('#modalTitle'); },
  get ruleNameInput() { return $('#ruleNameInput') as HTMLInputElement | null; },
  get ruleFilterInput() { return $('#ruleFilterInput') as HTMLTextAreaElement | null; },
  get actionArchive() { return $('#actionArchive') as HTMLInputElement | null; },
  get actionMarkRead() { return $('#actionMarkRead') as HTMLInputElement | null; },
  get actionStar() { return $('#actionStar') as HTMLInputElement | null; },
  get actionLabelSelect() { return $('#actionLabelSelect') as HTMLSelectElement | null; },
  get cancelRuleBtn() { return $('#cancelRuleBtn') as HTMLButtonElement | null; },
  get saveRuleBtn() { return $('#saveRuleBtn') as HTMLButtonElement | null; },
  get runRulesBtn() { return $('#runRulesBtn') as HTMLButtonElement | null; },

  // Dashboard
  get refreshDashboardBtn() { return $('#refreshDashboardBtn') as HTMLButtonElement | null; },
  get dashboardStatus() { return $('#dashboardStatus'); },
  get dashboardLoading() { return $('#dashboardLoading'); },
  get dashboardContent() { return $('#dashboardContent'); },
  get metricCount() { return $('#metricCount'); },
  get metricUrgentCount() { return $('#metricUrgentCount'); },
  get metricOverallMood() { return $('#metricOverallMood'); },
  get categoryChart() { return $('#categoryChart'); },
  get sentimentChart() { return $('#sentimentChart'); },
};

let currentSettings: Settings = { ...DEFAULT_SETTINGS };
let rules: AutoPilotRule[] = [];
let editingRuleId: string | null = null;

async function initOptions(): Promise<void> {
  await applyStoredTheme();
  populateModelOptions();
  await loadSettings();
  await checkAuthStatus();
  await loadActionLog();
  await loadRules();
  await populateLabelOptions();
  setupEventListeners();
  setupSidebarNav();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOptions);
} else {
  initOptions();
}

function populateModelOptions(): void {
  if (!dom.geminiModel) return;
  dom.geminiModel.innerHTML = GEMINI_MODELS
    .map((m) => `<option value="${m.id}">${m.label}</option>`)
    .join('');
}

async function loadSettings(): Promise<void> {
  const { extension_settings } = (await chrome.storage.local.get('extension_settings')) as { extension_settings?: Partial<Settings> };
  if (extension_settings) {
    currentSettings = { ...DEFAULT_SETTINGS, ...extension_settings };
  }
  
  // Populate UI
  const { geminiApiKey } = (await chrome.storage.local.get('geminiApiKey')) as { geminiApiKey?: string };
  if (geminiApiKey && dom.apiKeyInput) dom.apiKeyInput.value = geminiApiKey;
  
  if (dom.approveLow) dom.approveLow.checked = currentSettings.approvalRequired.low;
  if (dom.approveMedium) dom.approveMedium.checked = currentSettings.approvalRequired.medium;
  if (dom.approveHigh) dom.approveHigh.checked = currentSettings.approvalRequired.high;
  
  if (dom.geminiModel) dom.geminiModel.value = currentSettings.geminiModel || DEFAULT_GEMINI_MODEL;

  if (dom.toneSelect) dom.toneSelect.value = currentSettings.writingTone || 'professional';
  if (dom.signatureText) dom.signatureText.value = currentSettings.emailSignature || '';
  if (dom.userName) dom.userName.value = currentSettings.userName || '';
  if (dom.maxEmails) dom.maxEmails.value = String(currentSettings.maxEmails || 50);

  updateThemeUI(currentSettings.theme || 'light');
}

async function checkAuthStatus(): Promise<void> {
  try {
    const response = await sendToBackground({ type: MESSAGE_TYPES.AUTH_STATUS });
    if (response?.authenticated) {
      if (dom.connectedEmail) dom.connectedEmail.textContent = response.email || 'Connected';
      if (dom.accountIndicator) dom.accountIndicator.classList.add('connected');
      if (dom.accountStatusText) dom.accountStatusText.textContent = 'Connected';
      if (dom.disconnectBtn) dom.disconnectBtn.hidden = false;
    } else {
      setDisconnected();
    }
  } catch {
    setDisconnected();
  }
}

function setDisconnected(): void {
  if (dom.connectedEmail) dom.connectedEmail.textContent = 'Not connected';
  if (dom.accountIndicator) dom.accountIndicator.classList.remove('connected');
  if (dom.accountStatusText) dom.accountStatusText.textContent = 'Disconnected';
  if (dom.disconnectBtn) dom.disconnectBtn.hidden = true;
}

async function loadActionLog(): Promise<void> {
  const { actionQueue_log } = (await chrome.storage.local.get('actionQueue_log')) as { actionQueue_log?: LogItem[] };
  renderActionLog(actionQueue_log ?? []);
}

interface LogItem {
  status: 'executed' | 'failed' | 'pending' | 'approved' | 'rejected' | string;
  timestamp: number;
  reason?: string;
  type: string;
}

function renderActionLog(log: LogItem[]): void {
  if (!dom.actionLog) return;
  if (!log || !log.length) {
    dom.actionLog.innerHTML = `
      <div class="empty-state">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span>No actions recorded yet</span>
      </div>
    `;
    return;
  }
  
  dom.actionLog.innerHTML = log.slice(0, 50).map(item => {
    const statusIcon = {
      executed: '✓',
      failed: '✗',
      pending: '…',
      approved: '✓',
      rejected: '✗',
    }[item.status] ?? '…';
    
    const statusClass = {
      executed: 'success',
      approved: 'success',
      failed: 'error',
      rejected: 'error',
      pending: 'pending',
    }[item.status] ?? 'pending';

    const time = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    return `
      <div class="log-item">
        <span class="log-item__icon status-${statusClass}">${statusIcon}</span>
        <span class="log-item__text">${escapeHtml(item.reason || item.type)}</span>
        <span class="log-item__time">${time}</span>
      </div>
    `;
  }).join('');
}

function updateThemeUI(theme: string): void {
  const isLight = theme === 'light';
  document.documentElement.dataset.theme = isLight ? 'light' : 'dark';
  dom.themeLight?.classList.toggle('active', isLight);
  dom.themeDark?.classList.toggle('active', !isLight);
  dom.themeLight?.setAttribute('aria-pressed', String(isLight));
  dom.themeDark?.setAttribute('aria-pressed', String(!isLight));
}

function setupSidebarNav(): void {
  const links = document.querySelectorAll<HTMLAnchorElement>('.nav-link[data-section]');
  
  links.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const sectionId = link.dataset.section;
      if (!sectionId) return;

      const section = document.getElementById(sectionId);
      if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      links.forEach(l => l.classList.remove('active'));
      link.classList.add('active');
    });
  });

  // Track scroll position to highlight current nav link
  const sections = Array.from(document.querySelectorAll<HTMLElement>('.card[id]'));
  const content = document.querySelector('.content');
  if (!content) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          links.forEach(l => {
            l.classList.toggle('active', l.dataset.section === id);
          });
        }
      });
    },
    { rootMargin: '-20% 0px -60% 0px' }
  );

  sections.forEach(section => observer.observe(section));
}

function setupEventListeners(): void {
  // Input changes
  const inputs = [
    dom.apiKeyInput, dom.geminiModel, dom.approveLow, dom.approveMedium, dom.approveHigh,
    dom.toneSelect, dom.signatureText, dom.userName, dom.maxEmails
  ];
  
  inputs.forEach(input => {
    if (input) {
      input.addEventListener('input', showSaveBar);
      input.addEventListener('change', showSaveBar);
    }
  });

  dom.themeDark?.addEventListener('click', () => {
    if (currentSettings.theme !== 'dark') {
      currentSettings.theme = 'dark';
      updateThemeUI('dark');
      showSaveBar();
    }
  });

  dom.themeLight?.addEventListener('click', () => {
    if (currentSettings.theme !== 'light') {
      currentSettings.theme = 'light';
      updateThemeUI('light');
      showSaveBar();
    }
  });
  
  dom.toggleApiKeyBtn?.addEventListener('click', () => {
    if (!dom.apiKeyInput || !dom.toggleApiKeyBtn) return;
    const type = dom.apiKeyInput.type === 'password' ? 'text' : 'password';
    dom.apiKeyInput.type = type;
    // Swap the eye icon
    const svg = type === 'password'
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
    dom.toggleApiKeyBtn.innerHTML = svg;
  });
  
  dom.testApiBtn?.addEventListener('click', async () => {
    if (!dom.apiKeyInput || !dom.testApiBtn || !dom.testApiStatus) return;
    const apiKey = dom.apiKeyInput.value.trim();
    if (!apiKey) {
      dom.testApiStatus.textContent = 'API Key is required';
      dom.testApiStatus.className = 'status-text error';
      return;
    }
    
    dom.testApiBtn.disabled = true;
    dom.testApiStatus.textContent = 'Testing…';
    dom.testApiStatus.className = 'status-text loading';
    
    try {
      // Temporarily set it
      const model = dom.geminiModel?.value || DEFAULT_GEMINI_MODEL;
      let res: Response | undefined;
      const retries = 3;
      let delayMs = 1000;
      for (let i = 0; i < retries; i++) {
        try {
          res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              system_instruction: {
                parts: [{ text: 'You are a helpful email assistant.' }]
              },
              contents: [{ parts: [{ text: "Hello" }] }],
              generationConfig: { temperature: 0.7, maxOutputTokens: 64 }
            })
          });
          
          // Retry on transient errors (503 Service Unavailable / 429 Rate Limit)
          if ((res.status === 503 || res.status === 429) && i < retries - 1) {
            console.warn(`[InboxCommander] Gemini API returned ${res.status}. Retrying in ${delayMs}ms... (Attempt ${i + 1}/${retries})`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            delayMs *= 2;
            continue;
          }
          break;
        } catch (err) {
          if (i === retries - 1) throw err;
          console.warn(`[InboxCommander] Fetch failed. Retrying in ${delayMs}ms... (Attempt ${i + 1}/${retries})`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          delayMs *= 2;
        }
      }
      
      if (res && res.ok) {
        dom.testApiStatus.textContent = 'Connection successful';
        dom.testApiStatus.className = 'status-text success';
        showToast('API key verified successfully', 'success');
        showSaveBar();
        await chrome.storage.local.set({ geminiApiKey: apiKey });
      } else {
        let reason = res ? `HTTP ${res.status}` : 'Unknown error';
        if (res) {
          try {
            const text = await res.text();
            console.warn('[Gemini Test API error response]', text);
            const body = JSON.parse(text);
            reason = body?.error?.message || body?.message || reason;
          } catch {
            // keep HTTP status as fallback
          }
        }
        dom.testApiStatus.textContent = reason;
        dom.testApiStatus.className = 'status-text error';
      }
    } catch {
      dom.testApiStatus.textContent = 'Network error';
      dom.testApiStatus.className = 'status-text error';
    } finally {
      dom.testApiBtn.disabled = false;
    }
  });
  
  dom.disconnectBtn?.addEventListener('click', async () => {
    if (confirm('Are you sure you want to disconnect your Gmail account?')) {
      await sendToBackground({ type: MESSAGE_TYPES.AUTH_LOGOUT });
      await checkAuthStatus();
      showToast('Account disconnected', 'success');
    }
  });

  dom.clearLogBtn?.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear the action log?')) {
      await sendToBackground({ type: MESSAGE_TYPES.CLEAR_LOG });
      renderActionLog([]);
      showToast('Action log cleared', 'success');
    }
  });
  
  dom.saveBtn?.addEventListener('click', async () => {
    if (!dom.saveBtn) return;
    dom.saveBtn.textContent = 'Saving…';
    dom.saveBtn.disabled = true;
    
    const newSettings: Settings = {
      ...currentSettings,
      geminiModel: dom.geminiModel?.value || DEFAULT_GEMINI_MODEL,
      approvalRequired: {
        low: dom.approveLow?.checked ?? false,
        medium: dom.approveMedium?.checked ?? true,
        high: dom.approveHigh?.checked ?? true,
      },
      writingTone: dom.toneSelect?.value ?? 'professional',
      emailSignature: dom.signatureText?.value ?? '',
      userName: dom.userName?.value ?? '',
      maxEmails: parseInt(dom.maxEmails?.value || '50', 10) || 50,
    };
    
    await chrome.storage.local.set({ 
      extension_settings: newSettings,
      geminiApiKey: dom.apiKeyInput?.value.trim() ?? ''
    });
    currentSettings = newSettings;
    
    showToast('Settings saved', 'success');
    hideSaveBar();
    dom.saveBtn.disabled = false;
    dom.saveBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      Save Changes
    `;
  });

  // Auto-Pilot Events
  dom.newRuleBtn?.addEventListener('click', () => {
    editingRuleId = null;
    if (dom.modalTitle) dom.modalTitle.textContent = 'Create Auto-Pilot Rule';
    if (dom.ruleNameInput) dom.ruleNameInput.value = '';
    if (dom.ruleFilterInput) dom.ruleFilterInput.value = '';
    if (dom.actionArchive) dom.actionArchive.checked = false;
    if (dom.actionMarkRead) dom.actionMarkRead.checked = false;
    if (dom.actionStar) dom.actionStar.checked = false;
    if (dom.actionLabelSelect) dom.actionLabelSelect.value = '';
    if (dom.ruleModal) dom.ruleModal.hidden = false;
  });

  dom.cancelRuleBtn?.addEventListener('click', () => {
    if (dom.ruleModal) dom.ruleModal.hidden = true;
  });

  dom.saveRuleBtn?.addEventListener('click', async () => {
    const name = dom.ruleNameInput?.value.trim() ?? '';
    const filter = dom.ruleFilterInput?.value.trim() ?? '';
    if (!name || !filter) {
      showToast('Name and filter are required', 'error');
      return;
    }

    const ruleActions = {
      archive: dom.actionArchive?.checked ?? false,
      markRead: dom.actionMarkRead?.checked ?? false,
      star: dom.actionStar?.checked ?? false,
      labelId: dom.actionLabelSelect?.value || null,
    };

    if (editingRuleId) {
      // Edit
      rules = rules.map(r => r.id === editingRuleId ? {
        ...r,
        name,
        filter,
        actions: ruleActions,
      } : r);
      showToast('Rule updated', 'success');
    } else {
      // Create
      const newRule: AutoPilotRule = {
        id: Math.random().toString(36).substring(2, 9),
        name,
        filter,
        actions: ruleActions,
        enabled: true,
        createdAt: Date.now(),
      };
      rules.push(newRule);
      showToast('Rule created', 'success');
    }

    await saveRules(rules);
    renderRules();
    if (dom.ruleModal) dom.ruleModal.hidden = true;
  });

  dom.runRulesBtn?.addEventListener('click', async () => {
    if (!dom.runRulesBtn) return;
    const originalText = dom.runRulesBtn.innerHTML;
    dom.runRulesBtn.disabled = true;
    dom.runRulesBtn.textContent = 'Running...';
    try {
      const res = await sendToBackground({ type: MESSAGE_TYPES.RUN_AUTOPILOT });
      if (res?.success) {
        showToast('Auto-pilot rules check completed', 'success');
      } else {
        showToast(res?.error || 'Failed to run rules', 'error');
      }
    } catch {
      showToast('Error running rules', 'error');
    } finally {
      dom.runRulesBtn.disabled = false;
      dom.runRulesBtn.innerHTML = originalText;
    }
  });

  // Rule item card actions (edit, delete, toggle)
  dom.rulesList?.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    
    // Toggle active rule
    if (target.classList.contains('rule-toggle-input')) {
      const checkbox = target as HTMLInputElement;
      const ruleId = checkbox.dataset.id;
      rules = rules.map(r => r.id === ruleId ? { ...r, enabled: checkbox.checked } : r);
      await saveRules(rules);
      return;
    }

    // Edit Rule button
    const editBtn = target.closest('.edit-rule-btn') as HTMLElement | null;
    if (editBtn) {
      const ruleId = editBtn.dataset.id;
      const rule = rules.find(r => r.id === ruleId);
      if (rule) {
        editingRuleId = rule.id;
        if (dom.modalTitle) dom.modalTitle.textContent = 'Edit Auto-Pilot Rule';
        if (dom.ruleNameInput) dom.ruleNameInput.value = rule.name;
        if (dom.ruleFilterInput) dom.ruleFilterInput.value = rule.filter;
        if (dom.actionArchive) dom.actionArchive.checked = rule.actions.archive;
        if (dom.actionMarkRead) dom.actionMarkRead.checked = rule.actions.markRead;
        if (dom.actionStar) dom.actionStar.checked = rule.actions.star;
        if (dom.actionLabelSelect) dom.actionLabelSelect.value = rule.actions.labelId || '';
        if (dom.ruleModal) dom.ruleModal.hidden = false;
      }
      return;
    }

    // Delete Rule button
    const deleteBtn = target.closest('.delete-rule-btn') as HTMLElement | null;
    if (deleteBtn) {
      const ruleId = deleteBtn.dataset.id;
      if (confirm('Are you sure you want to delete this rule?')) {
        rules = rules.filter(r => r.id !== ruleId);
        await saveRules(rules);
        renderRules();
        showToast('Rule deleted', 'success');
      }
      return;
    }
  });

  // Dashboard Events
  dom.refreshDashboardBtn?.addEventListener('click', refreshDashboard);
}

function showSaveBar(): void {
  if (dom.saveBar) {
    dom.saveBar.hidden = false;
  }
}

function hideSaveBar(): void {
  if (dom.saveBar) {
    dom.saveBar.hidden = true;
  }
}

function showToast(message: string, type: 'success' | 'error' = 'success'): void {
  const container = dom.toastContainer;
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icon = type === 'success'
    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';

  toast.innerHTML = `${icon}<span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('removing');
    toast.addEventListener('animationend', () => toast.remove());
  }, 2800);
}

// ─── Auto-Pilot Helper Functions ───────────────────────────────────

async function loadRules(): Promise<void> {
  rules = await getRules();
  renderRules();
}

function renderRules(): void {
  if (!dom.rulesList) return;
  if (rules.length === 0) {
    dom.rulesList.innerHTML = `
      <div class="empty-state">
        <span>No automation rules configured yet.</span>
      </div>
    `;
    return;
  }

  dom.rulesList.innerHTML = rules.map(rule => {
    const activeActions = [];
    if (rule.actions.archive) activeActions.push('<span class="badge badge-sm">Archive</span>');
    if (rule.actions.markRead) activeActions.push('<span class="badge badge-sm">Read</span>');
    if (rule.actions.star) activeActions.push('<span class="badge badge-sm">Star</span>');
    if (rule.actions.labelId) {
      activeActions.push(`<span class="badge badge-sm">Label: ${escapeHtml(rule.actions.labelId)}</span>`);
    }

    return `
      <div class="rule-item-card">
        <div class="rule-item-header">
          <div class="rule-item-name">${escapeHtml(rule.name)}</div>
          <div class="rule-item-filter"><em>If matching:</em> "${escapeHtml(rule.filter)}"</div>
          <div class="rule-item-badges">${activeActions.join('')}</div>
        </div>
        <div class="rule-item-actions">
          <label class="switch-row rule-toggle-row">
            <input type="checkbox" class="rule-toggle-input" data-id="${rule.id}" ${rule.enabled ? 'checked' : ''} />
            <span class="switch-track" style="margin: 0;"></span>
          </label>
          <button class="icon-btn edit-rule-btn" data-id="${rule.id}" title="Edit Rule" aria-label="Edit Rule">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn delete-rule-btn" data-id="${rule.id}" title="Delete Rule" aria-label="Delete Rule" style="color: var(--red);">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function populateLabelOptions(): Promise<void> {
  if (!dom.actionLabelSelect) return;
  try {
    const response = await sendToBackground({ type: MESSAGE_TYPES.GET_LABELS });
    if (response?.success && response.data) {
      const labelsList = response.data;
      // Skip system categories that aren't user-addressable or filter out non-essential labels
      const userLabels = labelsList.filter((l: GmailLabel) => l.type === 'user' || ['INBOX', 'STARRED', 'UNREAD', 'SPAM', 'TRASH'].includes(l.id));

      const optionsHtml = userLabels.map((l: GmailLabel) => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('');
      dom.actionLabelSelect.innerHTML = `<option value="">(None)</option>${optionsHtml}`;
    }
  } catch (err) {
    console.warn('[InboxCommander] Failed to populate labels in rule builder:', err);
  }
}

// ─── Dashboard Helper Functions ────────────────────────────────────

async function refreshDashboard(): Promise<void> {
  if (!dom.refreshDashboardBtn || !dom.dashboardLoading || !dom.dashboardContent || !dom.dashboardStatus) return;

  dom.refreshDashboardBtn.disabled = true;
  dom.dashboardLoading.hidden = false;
  dom.dashboardContent.style.opacity = '0.5';
  dom.dashboardStatus.textContent = 'Analyzing inbox...';

  try {
    const res = await sendToBackground({
      type: MESSAGE_TYPES.GET_ANALYTICS,
      maxResults: parseInt(dom.maxEmails?.value || '50', 10) || 50,
    });

    if (res?.success && res.data) {
      const report: AnalyticsResult = res.data;
      if (dom.metricCount) dom.metricCount.textContent = String(report.totalAnalyzed);
      if (dom.metricUrgentCount) dom.metricUrgentCount.textContent = String(report.urgentCount);
      if (dom.metricOverallMood) dom.metricOverallMood.textContent = String(report.overallMood);

      // Render Categories
      if (dom.categoryChart) {
        if (report.categories?.length) {
          dom.categoryChart.innerHTML = report.categories.map((c) => {
            const pct = report.totalAnalyzed > 0 ? Math.round((c.count / report.totalAnalyzed) * 100) : 0;
            return `
              <div class="chart-bar-row">
                <div class="chart-bar-label-row">
                  <span class="chart-bar-label">${escapeHtml(c.name)}</span>
                  <span>${c.count} (${pct}%)</span>
                </div>
                <div class="chart-bar-outer">
                  <div class="chart-bar-inner" style="width: ${pct}%"></div>
                </div>
              </div>
            `;
          }).join('');
        } else {
          dom.categoryChart.innerHTML = '<div class="empty-state" style="padding: 12px 0;">No categories analyzed.</div>';
        }
      }

      // Render Sentiment
      if (dom.sentimentChart) {
        if (report.sentiments?.length) {
          dom.sentimentChart.innerHTML = report.sentiments.map((s) => {
            const pct = report.totalAnalyzed > 0 ? Math.round((s.count / report.totalAnalyzed) * 100) : 0;
            return `
              <div class="chart-bar-row">
                <div class="chart-bar-label-row">
                  <span class="chart-bar-label">${escapeHtml(s.name)}</span>
                  <span>${s.count} (${pct}%)</span>
                </div>
                <div class="chart-bar-outer">
                  <div class="chart-bar-inner" style="width: ${pct}%"></div>
                </div>
              </div>
            `;
          }).join('');
        } else {
          dom.sentimentChart.innerHTML = '<div class="empty-state" style="padding: 12px 0;">No sentiment data available.</div>';
        }
      }

      dom.dashboardStatus.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
      showToast('Dashboard updated', 'success');
    } else {
      showToast(res?.error || 'Failed to refresh dashboard', 'error');
      dom.dashboardStatus.textContent = 'Update failed';
    }
  } catch (err) {
    console.error('[InboxCommander] refreshDashboard error:', err);
    showToast('Failed to connect to background worker', 'error');
    dom.dashboardStatus.textContent = 'Network error';
  } finally {
    dom.dashboardLoading.hidden = true;
    dom.dashboardContent.style.opacity = '1';
    dom.refreshDashboardBtn.disabled = false;
  }
}


