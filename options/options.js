/**
 * options/options.js
 * Settings page logic
 */

import { DEFAULT_SETTINGS, MESSAGE_TYPES } from '../shared/constants.js';

const $ = (sel) => document.querySelector(sel);

const dom = {
  apiKeyInput: $('#apiKey'),
  toggleApiKeyBtn: $('#toggleApiKey'),
  testApiBtn: $('#testApiBtn'),
  testApiStatus: $('#apiStatus'),
  
  approveLow: $('#approvalLow'),
  approveMedium: $('#approvalMedium'),
  approveHigh: $('#approvalHigh'),
  
  toneSelect: $('#writingTone'),
  signatureText: $('#emailSignature'),
  userName: $('#userName'),
  
  maxEmails: $('#maxEmails'),
  
  connectedEmail: $('#accountEmail'),
  disconnectBtn: $('#disconnectBtn'),
  
  saveFloatBtn: $('#saveBtn'),
  themeDark: $('#themeDark'),
  themeLight: $('#themeLight'),
  
  clearLogBtn: $('#clearLogBtn'),
  actionLog: $('#actionLog'),
};

let currentSettings = { ...DEFAULT_SETTINGS };

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await checkAuthStatus();
  await loadActionLog();
  setupEventListeners();
});

async function loadSettings() {
  const { extension_settings } = await chrome.storage.local.get('extension_settings');
  if (extension_settings) {
    currentSettings = { ...DEFAULT_SETTINGS, ...extension_settings };
  }
  
  // Populate UI
  const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
  if (geminiApiKey) dom.apiKeyInput.value = geminiApiKey;
  
  dom.approveLow.checked = currentSettings.approvalRequired.low;
  dom.approveMedium.checked = currentSettings.approvalRequired.medium;
  dom.approveHigh.checked = currentSettings.approvalRequired.high;
  
  dom.toneSelect.value = currentSettings.writingTone || 'professional';
  dom.signatureText.value = currentSettings.emailSignature || '';
  dom.userName.value = currentSettings.userName || '';
  dom.maxEmails.value = currentSettings.maxEmails || 50;

  updateThemeUI(currentSettings.theme || 'dark');
}

async function checkAuthStatus() {
  try {
    const response = await sendToBackground({ type: MESSAGE_TYPES.AUTH_STATUS });
    if (response?.authenticated) {
      dom.connectedEmail.textContent = response.email || 'Connected';
      dom.disconnectBtn.hidden = false;
    } else {
      dom.connectedEmail.textContent = 'Not connected';
      dom.disconnectBtn.hidden = true;
    }
  } catch {
    dom.connectedEmail.textContent = 'Not connected';
    dom.disconnectBtn.hidden = true;
  }
}

async function loadActionLog() {
  const { actionQueue_log } = await chrome.storage.local.get('actionQueue_log');
  renderActionLog(actionQueue_log ?? []);
}

function renderActionLog(log) {
  if (!log || !log.length) {
    dom.actionLog.innerHTML = `
      <div class="empty-state">
        <span class="empty-state__icon">📋</span>
        <span class="empty-state__text">No actions recorded</span>
      </div>
    `;
    return;
  }
  
  dom.actionLog.innerHTML = log.slice(0, 50).map(item => {
    const statusIcon = {
      executed: '✅',
      failed: '❌',
      pending: '⏳',
      approved: '✅',
      rejected: '🚫',
    }[item.status] ?? '⏳';
    
    const time = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    return `
      <div class="log-item">
        <span class="log-item__icon">${statusIcon}</span>
        <span class="log-item__text">${escapeHtml(item.reason || item.type)}</span>
        <span class="log-item__time">${time}</span>
      </div>
    `;
  }).join('');
}

function updateThemeUI(theme) {
  if (theme === 'light') {
    dom.themeLight.classList.add('active');
    dom.themeDark.classList.remove('active');
  } else {
    dom.themeDark.classList.add('active');
    dom.themeLight.classList.remove('active');
  }
}

function setupEventListeners() {
  // Input changes
  const inputs = [
    dom.apiKeyInput, dom.approveLow, dom.approveMedium, dom.approveHigh,
    dom.toneSelect, dom.signatureText, dom.userName, dom.maxEmails
  ];
  
  inputs.forEach(input => {
    input.addEventListener('input', showSaveButton);
    input.addEventListener('change', showSaveButton);
  });

  dom.themeDark.addEventListener('click', () => {
    if (currentSettings.theme !== 'dark') {
      currentSettings.theme = 'dark';
      updateThemeUI('dark');
      showSaveButton();
    }
  });

  dom.themeLight.addEventListener('click', () => {
    if (currentSettings.theme !== 'light') {
      currentSettings.theme = 'light';
      updateThemeUI('light');
      showSaveButton();
    }
  });
  
  dom.toggleApiKeyBtn.addEventListener('click', () => {
    const type = dom.apiKeyInput.type === 'password' ? 'text' : 'password';
    dom.apiKeyInput.type = type;
    dom.toggleApiKeyBtn.textContent = type === 'password' ? '👁️' : '🙈';
  });
  
  dom.testApiBtn.addEventListener('click', async () => {
    const apiKey = dom.apiKeyInput.value.trim();
    if (!apiKey) {
      dom.testApiStatus.textContent = '❌ API Key required';
      dom.testApiStatus.className = 'api-status error';
      return;
    }
    
    dom.testApiBtn.disabled = true;
    dom.testApiStatus.textContent = '⏳ Testing...';
    dom.testApiStatus.className = 'api-status loading';
    
    try {
      // Temporarily set it
      await chrome.storage.local.set({ geminiApiKey: apiKey });
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: "Hello" }] }] })
      });
      
      if (res.ok) {
        dom.testApiStatus.textContent = '✅ Connection successful';
        dom.testApiStatus.className = 'api-status success';
        showSaveButton();
      } else {
        dom.testApiStatus.textContent = '❌ Invalid API Key';
        dom.testApiStatus.className = 'api-status error';
      }
    } catch (e) {
      dom.testApiStatus.textContent = '❌ Network error';
      dom.testApiStatus.className = 'api-status error';
    } finally {
      dom.testApiBtn.disabled = false;
    }
  });
  
  dom.disconnectBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to disconnect your Gmail account?')) {
      await sendToBackground({ type: MESSAGE_TYPES.AUTH_LOGOUT });
      await checkAuthStatus();
    }
  });

  dom.clearLogBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear the action log?')) {
      await chrome.storage.local.set({ actionQueue_log: [] });
      renderActionLog([]);
    }
  });
  
  dom.saveFloatBtn.addEventListener('click', async () => {
    dom.saveFloatBtn.textContent = 'Saving...';
    
    const newSettings = {
      ...currentSettings,
      approvalRequired: {
        low: dom.approveLow.checked,
        medium: dom.approveMedium.checked,
        high: dom.approveHigh.checked,
      },
      writingTone: dom.toneSelect.value,
      emailSignature: dom.signatureText.value,
      userName: dom.userName.value,
      maxEmails: parseInt(dom.maxEmails.value, 10) || 50,
    };
    
    await chrome.storage.local.set({ 
      extension_settings: newSettings,
      geminiApiKey: dom.apiKeyInput.value.trim() 
    });
    currentSettings = newSettings;
    
    dom.saveFloatBtn.textContent = '✅ Saved';
    setTimeout(() => {
      hideSaveButton();
    }, 2000);
  });
}

function showSaveButton() {
  dom.saveFloatBtn.hidden = false;
  dom.saveFloatBtn.textContent = 'Save Changes';
}

function hideSaveButton() {
  dom.saveFloatBtn.hidden = true;
}

function sendToBackground(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
