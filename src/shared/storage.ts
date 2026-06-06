/**
 * shared/storage.ts
 * Typed wrapper around chrome.storage.local. All accessors go through here.
 */

import { DEFAULT_SETTINGS } from './constants';
import type { Settings, QueuedAction, AutoPilotRule } from './types';

const KEYS = {
  SETTINGS: 'extension_settings',
  API_KEY: 'geminiApiKey',
  PENDING: 'actionQueue_pending',
  LOG: 'actionQueue_log',
  RULES: 'autopilot_rules',
} as const;

async function getRaw<T>(key: string): Promise<T | undefined> {
  const out = (await chrome.storage.local.get(key)) as Record<string, T | undefined>;
  return out[key];
}

export async function getSettings(): Promise<Settings> {
  const stored = await getRaw<Partial<Settings>>(KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored } as Settings;
}

export async function updateSettings(partial: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const merged = { ...current, ...partial };
  await chrome.storage.local.set({ [KEYS.SETTINGS]: merged });
  return merged;
}

export async function getApiKey(): Promise<string | null> {
  return (await getRaw<string>(KEYS.API_KEY)) ?? null;
}

export async function setApiKey(key: string): Promise<void> {
  await chrome.storage.local.set({ [KEYS.API_KEY]: key });
}

export async function getPendingActions(): Promise<QueuedAction[]> {
  return (await getRaw<QueuedAction[]>(KEYS.PENDING)) ?? [];
}

export async function setPendingActions(actions: QueuedAction[]): Promise<void> {
  await chrome.storage.local.set({ [KEYS.PENDING]: actions });
}

export async function getActionLog(limit = 500): Promise<QueuedAction[]> {
  const log = (await getRaw<QueuedAction[]>(KEYS.LOG)) ?? [];
  return log.slice(0, limit);
}

export async function appendLogEntry(entry: QueuedAction, maxEntries = 500): Promise<void> {
  const log = (await getRaw<QueuedAction[]>(KEYS.LOG)) ?? [];
  const updated = [entry, ...log].slice(0, maxEntries);
  await chrome.storage.local.set({ [KEYS.LOG]: updated });
}

export async function clearActionLog(): Promise<void> {
  await chrome.storage.local.set({ [KEYS.LOG]: [] });
}

export async function getRules(): Promise<AutoPilotRule[]> {
  return (await getRaw<AutoPilotRule[]>(KEYS.RULES)) ?? [];
}

export async function saveRules(rules: AutoPilotRule[]): Promise<void> {
  await chrome.storage.local.set({ [KEYS.RULES]: rules });
}
