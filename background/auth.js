/**
 * background/auth.js
 * Mock Gmail OAuth2 module to bypass authentication for development/offline testing.
 */

/**
 * Mock OAuth2 token.
 */
export function getAuthToken(interactive = false) {
  return Promise.resolve('mock-oauth-token-12345');
}

export const getAuthTokenSilent = () => Promise.resolve('mock-oauth-token-12345');
export const getAuthTokenInteractive = () => Promise.resolve('mock-oauth-token-12345');

export function removeAuthToken(token) {
  return Promise.resolve();
}

/**
 * Bypasses auth check and always returns true.
 */
export async function isAuthenticated() {
  return true;
}

export async function revokeAuth() {
  return Promise.resolve();
}

/**
 * Returns a fake Response object.
 */
export async function authenticatedFetch(url, options = {}) {
  return new Response(JSON.stringify({ mock: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
