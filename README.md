# MailFlow Agent

Chrome extension (MV3) that reads, summarizes, classifies, drafts, replies to, and labels Gmail with Gemini.

## Load locally

1. Run `bun run build` to compile the TypeScript code (or `bun run dev` for development).
2. Go to `chrome://extensions` → enable **Developer mode** → click **Load unpacked**.
3. Select the **project root** folder (the build emits `manifest.json`, `assets/`, and `service-worker-loader.js` there).
4. Open the extension's **Options** page and paste your Gemini API key.

## Configure

- `manifest.json` → set `oauth2.client_id` to your Google OAuth client ID
- Options page → set Gemini API key
