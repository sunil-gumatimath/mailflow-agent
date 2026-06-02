# InboxCommander

AI-powered Gmail assistant as a Chrome extension (Manifest V3). Reads, summarizes, classifies, drafts replies, and applies labels using Google's Gemini models.

## Features

- **Summarize** individual emails, threads, or your entire inbox
- **Classify** incoming mail by priority and category
- **Draft replies** in your own tone, with your signature
- **Auto-prioritize** what's worth reading first
- **Bulk actions**: archive, label, mark read, trash — gated by risk level
- **Side panel** chat agent with full inbox context
- **Bring-your-own Gemini key** — no backend, no signup, your data stays local

## How it works

The extension is a privacy-respecting two-token system:
- **Google OAuth** (built-in): authenticates you to your own Gmail via `chrome.identity`
- **Gemini API key** (you provide): used for AI features, stored in `chrome.storage.local`

No data leaves your browser except direct calls to Google APIs you authorize.

## Setup

### 1. Prerequisites
- [Bun](https://bun.sh) (or Node 18+)
- Chrome / Edge / Brave (any Chromium browser)

### 2. Get a Google OAuth client ID (one-time per fork)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or use existing)
3. **APIs & Services** -> **Library** -> enable **Gmail API**
4. **APIs & Services** -> **OAuth consent screen** -> configure (External, add the Gmail scopes below, add yourself as a test user)
5. **APIs & Services** -> **Credentials** -> **Create credentials** -> **OAuth client ID**
   - Application type: **Chrome extension** (not Web application)
   - Item ID: paste your unpacked extension's ID from `chrome://extensions`
6. Copy the generated `....apps.googleusercontent.com` value

Then create a `.env` file in the project root (it's gitignored):
```bash
bun run setup   # copies .env.example to .env
```
Open `.env` and paste your client ID:
```
GOOGLE_OAUTH_CLIENT_ID=123456789-abc...xyz.apps.googleusercontent.com
```

The build reads this at compile time and injects it into the generated `manifest.json` — no secrets in git.

### 3. Build & load
```bash
bun install
bun run build
```

Then `chrome://extensions` -> enable **Developer mode** -> **Load unpacked** -> select the project root folder.

### 4. Configure
- Right-click the extension icon -> **Options**
- Paste your **Gemini API key** (get one free at [aistudio.google.com](https://aistudio.google.com/apikey))
- Click **Test API Key** to verify
- Click **Sign in with Google** to connect your Gmail
- Save

That's it. Open Gmail and click the extension icon to start.

## Development

```bash
bun run dev          # watch mode
bun run typecheck    # tsc --noEmit
bun run build        # production build
```

## Project structure

```
src/
  background/        # service worker (Gmail API, AI, action queue)
  content/           # content script injected into mail.google.com
  popup/             # toolbar popup
  sidepanel/         # persistent side panel chat UI
  options/           # settings page
  shared/            # types, constants, utils
src/manifest.json    # extension manifest (source of truth)
```

## Privacy

- Your Gemini API key is stored locally in `chrome.storage.local` and only sent to `generativelanguage.googleapis.com`
- Gmail content is fetched via the official Gmail API with your own OAuth grant
- The extension makes zero requests to any third-party server
- See the [OAuth scopes](src/manifest.json) for exactly what Gmail access is requested

## Contributing

Pull requests welcome. For major changes, open an issue first.

## License

[MIT](LICENSE)
