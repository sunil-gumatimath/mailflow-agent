import { defineConfig, loadEnv } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest.json';

const PLACEHOLDER = '__GOOGLE_OAUTH_CLIENT_ID__';

function resolveClientId(env: Record<string, string>): string {
  const raw = env.GOOGLE_OAUTH_CLIENT_ID;
  if (!raw || raw.trim() === '' || raw.includes('REPLACE') || raw.includes('your_client_id')) {
    throw new Error(
      [
        '',
        '────────────────────────────────────────────────────────────',
        ' GOOGLE_OAUTH_CLIENT_ID is not set.',
        '',
        ' Create a Chrome-extension OAuth client at:',
        '   https://console.cloud.google.com/apis/credentials',
        '',
        ' Then either:',
        '   • Copy .env.example to .env and fill in the value, or',
        '   • Export it:  $env:GOOGLE_OAUTH_CLIENT_ID="...apps.googleusercontent.com"',
        '────────────────────────────────────────────────────────────',
        '',
      ].join('\n'),
    );
  }
  if (!raw.endsWith('.apps.googleusercontent.com')) {
    throw new Error(
      `GOOGLE_OAUTH_CLIENT_ID looks invalid: "${raw}". Expected value to end with .apps.googleusercontent.com`,
    );
  }
  return raw.trim();
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const clientId = resolveClientId(env);

  const finalManifest = {
    ...manifest,
    oauth2: {
      ...(manifest.oauth2 ?? {}),
      client_id: clientId,
    },
  };

  return {
    root: 'src',
    build: {
      outDir: '..',
      emptyOutDir: false,
    },
    plugins: [crx({ manifest: finalManifest })],
  };
});
