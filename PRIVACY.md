# InboxCommander — Privacy Policy

**Effective:** 2026-06-07

InboxCommander is a Chrome extension that helps you triage, summarize, classify, draft, and reply to Gmail messages using Google AI (Gemini). This policy describes what the extension accesses, stores, and transmits.

## TL;DR

- **No backend.** The extension runs entirely in your browser. We do not operate any servers.
- **No telemetry.** No analytics, no tracking, no third-party data sharing.
- **Local-only storage.** All settings, the action log, the action queue, Auto-Pilot rules, and your Gemini API key are stored in `chrome.storage.local` on your device. Conversation history is stored in `chrome.storage.session` and is cleared when the browser session ends.
- **Direct API calls only.** The only network requests the extension makes are to Google's Gmail API and Google's Gemini API, using your OAuth token and your Gemini API key.

## What the extension accesses

When you connect your Google account, the extension requests these OAuth scopes (declared in `src/manifest.json`):

| Scope                                          | Why                                                                                                              |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `https://www.googleapis.com/auth/gmail.modify` | Read, label, archive, mark read / unread, star, and trash messages you ask it to                                 |
| `https://www.googleapis.com/auth/gmail.send`   | Send drafts and replies you approve                                                                              |
| `https://www.googleapis.com/auth/gmail.labels` | Apply existing labels to messages you ask it to                                                                  |

These scopes are used **only** for actions you explicitly trigger or approve through the extension's UI. There is no background harvesting of email content. Auto-Pilot only fetches and processes messages at the moment a rule is being evaluated, and only against the rules you enabled.

When you use an AI feature (summarize, classify, draft, chat, Auto-Pilot evaluation, analytics, thread timeline), the relevant email content and your prompt are sent to **Google's Gemini API** at `https://generativelanguage.googleapis.com/v1beta` using your own Gemini API key, which is stored locally in your browser.

## What is stored locally

In `chrome.storage.local` (persists across browser restarts; cleared when you uninstall):

- **Extension settings** — your writing tone, signature, name, model choice, theme, and per-risk-level approval preferences
- **Gemini API key** — encrypted at rest by Chrome's storage isolation
- **Action queue** — pending actions awaiting your approval
- **Action log** — the last 500 actions you approved, rejected, edited, or that failed (you can clear this from the settings page)
- **Auto-Pilot rules** — your natural-language filters and the actions they trigger

In `chrome.storage.session` (cleared when the browser session ends):

- **Conversation history** — the side-panel chat turns for the current browser session; restored if you reload the side panel within the same session, discarded on browser restart

Nothing else is stored. No cookies, no fingerprinting, no cross-site state, no IndexedDB, no Service Worker caches beyond what Chrome itself maintains.

## What is sent off-device, and to whom

| Data                                | Destination                                              | When                                                                                          |
| ----------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Gmail message content (the active thread, search results, fetched headers/bodies) | `gmail.googleapis.com`                                | When you (a) open a thread in Gmail and the content script hydrates the side panel, (b) trigger Summarize / Classify / Draft / Chat / Auto-Pilot, (c) take a Gmail action (label, archive, trash, mark read, etc.). |
| The same content + your prompt      | `generativelanguage.googleapis.com` (Gemini Developer API) | Only for AI features: summarize, classify, draft, chat, analytics, thread timeline, and Auto-Pilot rule evaluation. The model id you picked (default `gemini-2.5-flash`) is sent in the request URL. The API key is sent in the `x-goog-api-key` header. |

The extension does not make requests to any other origin. There is no fallback server, no analytics endpoint, no error-reporting service, and no remote-loaded code.

## What is NOT done

- ❌ No analytics or telemetry of any kind
- ❌ No email content is sent to any server other than Google's Gmail and Gemini APIs
- ❌ No data is sold, shared, or transferred to any third party
- ❌ No background reading of your inbox — the extension only reads messages you point it at (current open thread, inbox quick actions, or messages returned by a search you ran) or that an Auto-Pilot rule you enabled is currently evaluating
- ❌ No remote code execution — the bundled JavaScript is the only code that runs; no code is fetched at runtime
- ❌ No use of `eval`, `new Function`, or any other dynamic code path
- ❌ No tracking pixels, no fingerprinting, no cookies set on Gmail or any other origin

## Permissions explained

The manifest declares only the permissions it uses:

- `identity` — perform the OAuth handshake with Google (`chrome.identity.launchWebAuthFlow`)
- `storage` — store settings, action log, action queue, and Auto-Pilot rules in `chrome.storage.local`
- `sidePanel` — show the AI chat and dashboard in Chrome's side panel
- `tabs` — detect when you're on Gmail so the side panel can hydrate
- `activeTab` — interact with the open Gmail tab when you click the toolbar icon
- `alarms` — schedule periodic Auto-Pilot runs

Host permissions are limited to `https://mail.google.com/*`, `https://gmail.googleapis.com/*`, and `https://generativelanguage.googleapis.com/*`.

## Your control

- **Disconnect** — Go to the extension's settings page → Disconnect. This revokes the OAuth token cached in the extension and resets the session-scoped state.
- **Clear the action log** — Settings page → Clear log.
- **Edit or disable Auto-Pilot rules** — Settings → Auto-Pilot. Rules can be edited, disabled, or deleted at any time; the actions they had previously queued remain in the action log.
- **Uninstall** — Removes the extension and all data it stored in `chrome.storage.local`. Session-scoped conversation history is removed automatically on browser restart.
- **Revoke via Google** — https://myaccount.google.com/permissions → InboxCommander → Remove access. This is the canonical place to revoke the OAuth grant.

## Children

The extension is not directed at children under 13 and we do not knowingly collect any data from children.

## Changes to this policy

Material changes will be posted to the project's GitHub repository with a date stamp. Continued use of the extension after a change constitutes acceptance.

## Contact

Open an issue at the project's GitHub repository: https://github.com/sunil-gumatimath/InboxCommander/issues
