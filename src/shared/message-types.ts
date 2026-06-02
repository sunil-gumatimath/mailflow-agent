import type { ExtensionResponse } from './types';
export { MESSAGE_TYPES } from './constants';

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
