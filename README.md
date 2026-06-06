# InboxCommander

AI-powered Gmail assistant as a Chrome extension (Manifest V3). Reads, summarizes, classifies, drafts replies, and applies labels using Google's Gemini models.

## Features

- **Summarize** individual emails, threads, or your entire inbox
- **Classify** incoming mail by priority and category
- **Draft replies** in your own tone, with your signature
- **Auto-prioritize** what's worth reading first
- **Bulk actions**: archive, label, mark read, trash — gated by risk level
- **Side panel** chat agent with full inbox context
- **Auto-Pilot rules** — natural-language filters (e.g. "newsletters from vendors I haven't ordered from in 6 months") evaluated by Gemini; matching mail gets archived / labeled / marked read automatically under a dedicated low-risk policy
- **Inbox dashboard** — unread count, urgent-mail breakdown, sentiment chart, and thread-timeline view
- **Bring-your-own Gemini key** — no backend, no signup, your data stays local

## How it works

The extension is a privacy-respecting two-token system:

- **Google OAuth** (built-in): authenticates you to your own Gmail via `chrome.identity`
- **Gemini API key** (you provide): used for AI features, stored in `chrome.storage.local`

No data leaves your browser except direct calls to Google APIs you authorize (`gmail.googleapis.com`, `generativelanguage.googleapis.com`).

## Setup

### 1. Prerequisites

- [Bun](https://bun.sh) **1.0+** (used as both the package manager and the test runner)
- Chrome / Edge / Brave (any Chromium browser that supports Manifest V3)

### 2. Get a Google OAuth client ID (one-time per fork)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or use existing)
3. **APIs & Services** → **Library** → enable **Gmail API**
4. **APIs & Services** → **OAuth consent screen** → configure (External, add the Gmail scopes below, add yourself as a test user)
5. **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID**
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

Then `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the project root folder.

### 4. Configure

- Right-click the extension icon → **Options**
- Paste your **Gemini API key** (get one free at [aistudio.google.com](https://aistudio.google.com/apikey))
- Pick a model (default: `gemini-2.5-flash`; 2.0 / 2.5 / 3-preview variants are all available — see [Supported models](#supported-models))
- Click **Test API Key** to verify
- Click **Sign in with Google** to connect your Gmail
- Save

That's it. Open Gmail and click the extension icon to start.

## Supported actions

| Action          | Risk level | Approval default            | Notes                                                       |
| --------------- | ---------- | --------------------------- | ----------------------------------------------------------- |
| `ARCHIVE`       | LOW        | Auto (configurable)         | Removes `INBOX` label                                       |
| `MARK_READ`     | LOW        | Auto (configurable)         | Removes `UNREAD` label                                      |
| `LABEL`         | LOW        | Auto (configurable)         | Adds a Gmail label id                                       |
| `STAR`          | LOW        | Auto (configurable)         | Adds `STARRED`                                              |
| `BATCH_MODIFY`  | MEDIUM     | Required                    | Bulk label/archive/mark-read                                |
| `DRAFT_REPLY`   | MEDIUM     | Required                    | Creates a draft — never sends                                |
| `CREATE_DRAFT`  | MEDIUM     | Required                    | Same as above                                               |
| `TRASH`         | HIGH       | Required                    | Moves to Gmail trash (recoverable for 30 days)              |
| `SEND_EMAIL`    | HIGH       | Required                    | Sends a real message — irreversible                         |

Risk level and per-level approval are configured on the settings page. Defaults: `low` auto-executes, `medium` and `high` always require explicit approval.

## Auto-Pilot rules

Auto-Pilot lets you describe a filter in plain English. InboxCommander sends the filter and the message metadata to Gemini, which returns `YES` or `NO`. On `YES` the rule's actions (`archive`, `markRead`, `star`, `labelId`) are queued and executed under the rule's own approval policy. Failed evaluations fall back to a `false` (no match) and never crash the queue.

Add and toggle rules from **Settings → Auto-Pilot**.

## Supported models

The settings page exposes the current Gemini Developer API lineup. The full list is exported from `src/shared/constants.ts` as `GEMINI_MODELS`; the default is `DEFAULT_GEMINI_MODEL` = `gemini-2.5-flash`.

| Model id                       | Display label              |
| ------------------------------ | -------------------------- |
| `gemini-3-pro-preview`         | Gemini 3 Pro (Preview)     |
| `gemini-3-flash-preview`       | Gemini 3 Flash (Preview)   |
| `gemini-2.5-pro`               | Gemini 2.5 Pro             |
| `gemini-2.5-flash`             | Gemini 2.5 Flash (default) |
| `gemini-2.5-flash-lite`        | Gemini 2.5 Flash-Lite      |
| `gemini-2.0-flash`             | Gemini 2.0 Flash           |
| `gemini-2.0-flash-lite`        | Gemini 2.0 Flash-Lite      |

## Development

```bash
bun run dev              # Vite watch mode
bun run typecheck        # tsc --noEmit (strict)
bun run test             # Vitest (one-shot) — 108 tests across 13 files
bun run test:watch       # Vitest watch
bun run test:coverage    # Vitest with v8 coverage
bun run lint             # ESLint 9 flat config
bun run format           # Prettier write
bun run format:check     # Prettier check (used in CI)
bun run build            # typecheck + Vite production build
bun run setup            # copy .env.example → .env
bun run clean            # remove built artifacts at repo root
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full contributor guide, [`CHANGELOG.md`](CHANGELOG.md) for what changed recently, and [`SECURITY.md`](SECURITY.md) for the security policy and how to report vulnerabilities.

## Project structure

```
src/
  background/        # service worker (Gmail API, AI, action queue, auth)
  content/           # content script injected into mail.google.com
  popup/             # toolbar popup
  sidepanel/         # persistent side panel chat UI + dashboard
  options/           # settings page (API key, model, Auto-Pilot rules, log)
  shared/            # types, constants, utils, storage, messaging, escape, markdown, retry
src/manifest.json    # extension manifest (source of truth)

# Build-time config
vite.config.ts       # Vite + CRX build (injects OAuth client ID from .env)
vitest.config.ts     # Vitest test runner
eslint.config.js     # ESLint 9 flat config
.prettierrc.json     # Prettier config

# Docs
README.md            # this file
PRIVACY.md           # privacy policy
CHANGELOG.md         # release notes
CONTRIBUTING.md      # contributor guide
SECURITY.md          # security policy & vulnerability reporting
```

`src/shared/` is the single place for code reused across surfaces (popup, options, sidepanel, content, service worker). If you find yourself copy-pasting logic between them, extract it to `shared/` instead.

## CI

Every push and PR runs four independent GitHub Actions jobs against the Bun toolchain (`.github/workflows/ci.yml`):

- **lint** — `bun run lint` + `bun run format:check`
- **typecheck** — `bun run typecheck`
- **test** — `bun run test`
- **build** — depends on the other three; runs `bun run build` with a placeholder OAuth client ID to verify the build pipeline

A separate `release.yml` workflow runs on `v*` tags and uses the real `GOOGLE_OAUTH_CLIENT_ID` repository secret.

## Privacy

- Your Gemini API key is stored locally in `chrome.storage.local` and only sent to `generativelanguage.googleapis.com`
- Gmail content is fetched via the official Gmail API with your own OAuth grant
- The extension makes zero requests to any third-party server
- See [`PRIVACY.md`](PRIVACY.md) for the full policy and [`src/manifest.json`](src/manifest.json) for the OAuth scopes requested

## Publishing to the Chrome Web Store

### 1. Verify the OAuth app

The Gmail scopes (`gmail.modify`, `gmail.send`, `gmail.labels`) are **sensitive scopes** and Google requires OAuth app verification before public use. In Google Cloud Console:

- Submit your app for verification (privacy policy URL, demo video, use-case description)
- Add a link to [`PRIVACY.md`](PRIVACY.md) hosted publicly (e.g. on your repo's GitHub Pages or your website)
- While unverified, add testers via the OAuth consent screen — only those users can sign in

### 2. Cut a release

The repo ships a GitHub Actions release workflow (`.github/workflows/release.yml`) that builds and packages the extension when you push a tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Add `GOOGLE_OAUTH_CLIENT_ID` as a repository secret first (Settings → Secrets and variables → Actions → New repository secret). The workflow will:

1. Sync the manifest version to the tag (e.g. tag `v1.2.3` writes `"version": "1.2.3"` into `src/manifest.json`)
2. Run the full `bun run build` with your real OAuth client ID injected
3. Package the built extension into `inboxcommander-vX.Y.Z.zip` (the `manifest.json` + `service-worker-loader.js` + the built `assets/`, `content/`, `options/`, `popup/`, `sidepanel/` directories)
4. Stage store-listing icons (16/48/128 PNGs derived from `src/assets/icons/logo.png`)
5. Upload the zip and icons to a **draft** GitHub release (prerelease tag if the tag contains a `-`)

### 3. Upload to the Chrome Web Store

1. Pay the one-time $5 developer fee at https://chrome.google.com/webstore/devconsole/
2. Create a new item, upload `inboxcommander-vX.Y.Z.zip`
3. Fill in the store listing:
   - **Icon**: 128×128 PNG (auto-generated by the workflow, or use `src/assets/icons/logo.png`)
   - **Screenshots**: 1280×800 or 640×400, at least one required
   - **Privacy policy URL**: link to your hosted `PRIVACY.md`
   - **Description / category / language** as appropriate
4. Submit for review (typically 1–3 business days)

### 4. Replace the placeholder icons before launch

The shipped `src/assets/icons/logo.png` is a clean default. For a real launch, replace it with a branded version:

```bash
# Edit src/assets/icons/logo.png in your design tool, then:
cp src/assets/icons/logo.png store-listing-128.png
```

PNG versions are required by the Chrome Web Store listing.

## Contributing

Pull requests welcome. For major changes, open an issue first. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup, testing, and PR conventions.

## License

[MIT](LICENSE)
