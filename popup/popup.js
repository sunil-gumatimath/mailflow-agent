/**
 * popup/popup.js
 * Quick-access popup logic
 */

import { MESSAGE_TYPES } from '../shared/constants.js';

const $ = (sel) => document.querySelector(sel);

const dom = {
  connectionDot: $('#connectionDot'),
  statusText: $('#statusText'),
  userEmail: $('#userEmail'),
  statsSection: $('#statsSection'),
  unreadCount: $('#unreadCount'),
  pendingCount: $('#pendingCount'),
  actionsGrid: $('#actionsGrid'),
  authSection: $('#authSection'),
  authBtn: $('#authBtn'),
  btnSummarize: $('#btnSummarize'),
  btnPriority: $('#btnPriority'),
  btnOpenPanel: $('#btnOpenPanel'),
  settingsBtn: $('#settingsBtn'),
  optionsLink: $('#optionsLink'),
};

document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await checkAuthStatus();
});

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
    dom.connectionDot.classList.add('connected');
    dom.statusText.textContent = 'Connected';
    dom.userEmail.textContent = email ?? '';
    dom.userEmail.hidden = !email;
    dom.statsSection.hidden = false;
    dom.actionsGrid.hidden = false;
    dom.authSection.hidden = true;
    
    // Fetch pending approvals for the stat badge
    fetchPendingApprovalsCount();
  } else {
    dom.connectionDot.classList.remove('connected');
    dom.statusText.textContent = 'Not connected';
    dom.userEmail.hidden = true;
    dom.statsSection.hidden = true;
    dom.actionsGrid.hidden = true;
    dom.authSection.hidden = false;
  }
}

async function fetchPendingApprovalsCount() {
  try {
    const response = await sendToBackground({ type: MESSAGE_TYPES.GET_PENDING_APPROVALS });
    const count = response?.approvals?.length ?? 0;
    dom.pendingCount.textContent = count;
  } catch {
    // Ignore
  }
}

function setupEventListeners() {
  dom.authBtn.addEventListener('click', async () => {
    try {
      dom.authBtn.disabled = true;
      dom.authBtn.textContent = 'Connecting...';
      const response = await sendToBackground({ type: MESSAGE_TYPES.AUTH_LOGIN });
      if (response && !response.error) {
        updateAuthUI(true, response.email);
      } else {
        alert(response?.error ?? 'Authentication failed');
      }
    } finally {
      dom.authBtn.disabled = false;
      dom.authBtn.textContent = 'Sign in with Google';
    }
  });

  dom.btnOpenPanel.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (activeTab?.url?.includes('mail.google.com')) {
        if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function') {
          chrome.sidePanel.open({ tabId: activeTab.id })
            .then(() => window.close())
            .catch((e) => {
              console.error('[MailFlow-agent] Failed to open side panel:', e);
              window.close();
            });
        } else {
          window.close();
        }
      } else {
        chrome.tabs.create({ url: 'https://mail.google.com' }, (newTab) => {
          const listener = (tabId, changeInfo) => {
            if (tabId === newTab.id && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function') {
                chrome.sidePanel.open({ tabId }).catch(() => {});
              }
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
        });
      }
    });
  });

  const triggerChatAction = async (actionText) => {
    try {
      await chrome.storage.session.set({ pendingQuickAction: actionText });
    } catch (e) {}

    chrome.tabs.query({ url: '*://mail.google.com/*' }, (tabs) => {
      if (tabs.length > 0) {
        const gmailTab = tabs[0];
        chrome.tabs.update(gmailTab.id, { active: true });
        chrome.windows.update(gmailTab.windowId, { focused: true });
        
        if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function') {
          chrome.sidePanel.open({ tabId: gmailTab.id })
            .then(() => {
              chrome.runtime.sendMessage({
                type: 'TRIGGER_QUICK_ACTION',
                action: actionText
              }).catch(() => {});
              window.close();
            })
            .catch(() => window.close());
        } else {
          window.close();
        }
      } else {
        chrome.tabs.create({ url: 'https://mail.google.com' }, (newTab) => {
          const listener = (tabId, changeInfo) => {
            if (tabId === newTab.id && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function') {
                chrome.sidePanel.open({ tabId }).catch(() => {});
              }
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
        });
      }
    });
  };

  dom.btnSummarize.addEventListener('click', () => triggerChatAction('SUMMARIZE_INBOX'));
  dom.btnPriority.addEventListener('click', () => triggerChatAction('PRIORITY_EMAILS'));

  dom.settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  dom.optionsLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

function sendToBackground(message) {
  const { type, ...rest } = message;
  const wrappedMessage = {
    type,
    data: rest
  };
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(wrappedMessage, (response) => {
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
