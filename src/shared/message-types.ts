import type { ExtensionMessage, ExtensionResponse } from './types';
export { MESSAGE_TYPES } from './constants';

/**
 * Create a well-formed message object to send via chrome.runtime.sendMessage.
 */
export function createMessage(type: string, data: any = {}): ExtensionMessage {
  return {
    type,
    data,
    timestamp: Date.now(),
  };
}

/**
 * Create a standardised response object returned from the service worker.
 */
export function createResponse(success: boolean, data: any = null, error: string | null = null): ExtensionResponse {
  return {
    success,
    data,
    error,
    timestamp: Date.now(),
  };
}
