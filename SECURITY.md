# Security

InboxCommander is a Chrome extension that reads, summarizes, classifies, drafts, and modifies your Gmail. Security is therefore the most important non-functional concern of this project. This document describes what we do, what you should be aware of, and how to report a vulnerability.

## Threat model

InboxCommander handles four classes of sensitive data:

1. **Your email content** — read from `mail.google.com` via the Gmail API and (for the active thread) via a content script.
2. **Your Gemini API key** — used to call Google's generative-language API.
3. **OAuth tokens** for your Google account — used to call the Gmail API.
4. **AI-generated text** — including Auto-Pilot YES/NO decisions and drafted replies.

Each of these crosses at least one trust boundary:

| Boundary                          | Mitigation                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| Email content → AI prompt         | HTML stripped, length-bounded, wrapped in `--- BEGIN/END UNTRUSTED EMAIL CONTENT ---` markers |
| Email content → innerHTML in UI   | All interpolations go through `escapeHtml` (entity-based, not DOM-based)                      |
| AI response → action execution    | All state-mutating actions go through the action queue with explicit user approval            |
| AI response → Auto-Pilot action   | Rule evaluation failures fall back to `false` (no match); even on `YES`, low-risk actions only auto-execute, and all medium/high-risk rule actions still require approval |
| OAuth client secret               | Stored only in your local `.env` (gitignored) or as a CI secret; never committed              |
| API key                           | Stored in `chrome.storage.local`; never logged; never sent to a third party                   |

## Action risk classification

The action queue (`src/background/action-queue.ts`) classifies every state-mutating action as `LOW`, `MEDIUM`, or `HIGH`. The default approval policy is configurable in settings; the shipped default is:

| Risk   | Actions                                                                 | Default approval      |
| ------ | ----------------------------------------------------------------------- | --------------------- |
| LOW    | `ARCHIVE`, `MARK_READ`, `LABEL`, `STAR`                                  | Auto-execute          |
| MEDIUM | `BATCH_MODIFY`, `DRAFT_REPLY`, `CREATE_DRAFT`                           | Required              |
| HIGH   | `TRASH`, `SEND_EMAIL`                                                   | Required (always)     |

You can opt-in to approval for LOW-risk actions and opt-out for MEDIUM. HIGH is locked: send and trash are irreversible enough that the user must always confirm.

## What we do not do

- **No telemetry, no analytics, no remote logging.** This extension does not call any server other than `https://mail.google.com/*`, `https://gmail.googleapis.com/*`, and `https://generativelanguage.googleapis.com/*`.
- **No background data exfiltration.** The service worker only processes messages from the extension's own UI surfaces and from the periodic Auto-Pilot alarm — it never spontaneously fetches content.
- **No `eval`, `new Function`, or remote-loaded code.** All code is bundled at build time. Vite + `@crxjs/vite-plugin` emit a static bundle; the extension makes no `fetch()` calls to load additional JavaScript at runtime.
- **No dynamic `dangerouslySetInnerHTML`-equivalent on untrusted strings.** Every UI surface renders model output and email content through `escapeHtml` and the safe markdown subset in `src/shared/markdown.ts`.

## Permissions

The manifest declares the minimum permissions needed (see `src/manifest.json`):

- `storage` — to persist settings, the action log, the action queue, and Auto-Pilot rules in `chrome.storage.local`.
- `sidePanel` — to host the chat UI in Chrome's side panel.
- `tabs` and `activeTab` — to detect when you are on Gmail and offer the side panel.
- `identity` — to perform OAuth.
- `alarms` — to schedule periodic Auto-Pilot runs (the only `chrome.alarms` consumer; cleared when the extension is uninstalled).

Host permissions are scoped to:

- `https://mail.google.com/*` (the Gmail UI)
- `https://gmail.googleapis.com/*` (the Gmail REST API)
- `https://generativelanguage.googleapis.com/*` (the Gemini API)

We do not request `<all_urls>` or any other broad host permission.

## AI prompt injection

Email content is the primary prompt-injection vector. We mitigate this with:

1. **HTML stripping** in `src/shared/utils.ts:sanitizeForAI` before any content reaches the model. Tags are removed, attributes are dropped, and any `--- BEGIN/END UNTRUSTED EMAIL CONTENT ---` markers in the content are escaped.
2. **Length bounding** to keep injection payloads short.
3. **A safety boundary** (`--- BEGIN/END UNTRUSTED EMAIL CONTENT ---`) so the model can be told to ignore instructions inside that block. The model is also instructed to respond only in the requested JSON shape.
4. **Action approval** — even if the model is tricked into _wanting_ to take a destructive action, the action must still pass the user-approval gate (`src/background/action-queue.ts`).
5. **Auto-Pilot fail-closed** — if the Gemini call for `evaluateRuleMatch` throws, returns empty, returns malformed JSON, or returns a non-YES value, the rule is treated as a non-match. The queue never proceeds on an uncertain answer.
6. **Risk-gated execution** — even an Auto-Pilot rule cannot auto-execute a `MEDIUM` or `HIGH` action. The action is enqueued for human review just like a manual one.

These mitigations are not perfect. **You should always review pending actions before approving them**, especially for `SEND_EMAIL` and `TRASH_EMAIL`.

## Storage isolation

The extension reads and writes only through `src/shared/storage.ts`. There is no other touchpoint with `chrome.storage.local`, which means:

- Surface A cannot write a key that surface B reads in an unexpected shape — every accessor is typed and defaulted.
- The action queue, action log, settings, and Auto-Pilot rules each have their own dedicated accessors. Cross-surface corruption requires going through these typed functions.

## Reporting a vulnerability

**Do not open a public GitHub issue for security reports.** Instead, email the maintainer directly (see the GitHub profile on this repo) with:

1. A description of the vulnerability and its impact.
2. A minimal reproduction (extension version, browser, steps).
3. Whether you want public credit in the fix's commit message.

We will acknowledge within 72 hours and aim to ship a fix within 14 days for critical issues.

## Scope

In-scope:

- Code execution via the AI prompt path.
- XSS in the side panel / options / popup / content script.
- OAuth token leakage (e.g., token being logged, sent to a non-Google host).
- Storage poisoning (one extension surface corrupting data read by another).
- Manifest issues (over-broad permissions, missing CSP).
- Auto-Pilot bypasses (a way to get a rule's action to execute without the action passing through the queue, or to mark a failed Gemini evaluation as a `YES`).

Out of scope:

- Bugs in Gmail itself.
- Bugs in the Gemini API.
- Social engineering against the user (this extension cannot protect against a user who approves every action blindly).
- Vulnerabilities in dependencies that are not reachable from the extension's code.
