# Changelog

All notable changes to InboxCommander are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Auto-Pilot rules** — natural-language filter descriptions evaluated by Gemini (`evaluateRuleMatch` in `src/background/ai-provider.ts`). Matching mail is automatically archived / labeled / marked-read / starred under a dedicated rule-scoped approval policy. Rule CRUD lives in `src/options/options.ts` and the queue in `src/background/service-worker.ts`. The `RUN_AUTOPILOT` message type drives periodic execution; failures in Gemini evaluation fall back to `false` (no match) and never crash the queue.
- **Inbox dashboard** — unread count, urgent-mail breakdown, and a thread-timeline view (`GET_ANALYTICS`, `GET_THREAD_TIMELINE`, `GET_UNREAD_COUNT` message types). Surfaced in the side panel and the options page.
- **Expanded model lineup** — settings page now exposes Gemini 3 Pro/Flash previews, the Gemini 2.5 family (pro / flash / flash-lite), and Gemini 2.0 (flash / flash-lite). The constants live in `GEMINI_MODELS` and the default is `DEFAULT_GEMINI_MODEL` = `gemini-2.5-flash` (`src/shared/constants.ts`).
- **Persistent conversation history** — chat turns are saved to `chrome.storage.session` via `ConversationTurn` in `src/shared/types.ts` so a side-panel reload restores context.
- **Theme switcher** — `theme: 'light' | 'dark'` in `Settings`, applied at surface-boot via `applyStoredTheme` (`src/shared/utils.ts`).
- **Tests:** Vitest 2 test runner with v8 coverage. 108 tests across 13 files. The new suites cover Auto-Pilot robustness (`ai-provider.autopilot.verify.test.ts`, 18 cases), analytics and timeline handlers (`ai-provider.analytics.verify.test.ts` and `ai-provider.timeline.verify.test.ts`, 4 each), the summarize path (`ai-provider.summarize.test.ts`, 9), the service-worker Auto-Pilot wiring (`service-worker.autopilot.verify.test.ts`, 12), the side panel (`sidepanel.test.ts`), plus the action queue (9) and shared utilities (`escape`, `markdown`, `messaging`, `retry`, `storage`, `utils`).
- **Linting:** ESLint 9 flat config + Prettier 3. CI runs both on every PR.
- **Typed storage layer:** `src/shared/storage.ts` is the single entry point for `chrome.storage.local` reads/writes. Typed accessors include `getSettings`, `updateSettings`, `getApiKey`, `setApiKey`, `getPendingActions`, `setPendingActions`, `getActionLog`, `appendLogEntry`, `clearActionLog`, and the Auto-Pilot rule accessors.
- **Shared helpers:** `sendToBackground` (messaging), `escapeHtml` (XSS-safe HTML escaping), `formatMessageText` (safe markdown subset), and `withBackoff` (retry helper) extracted to `src/shared/`. The popup, options, side panel, and content script all import them.
- **CI workflows:** `.github/workflows/ci.yml` has separate jobs for `lint`, `typecheck`, `test`, and `build`. The `build` job depends on the other three and uses a placeholder OAuth client ID so the pipeline itself is verifiable without exposing the real secret.
- **Release workflow:** `.github/workflows/release.yml` triggers on `v*` tags. It syncs the manifest version to the tag, runs the production build with the real `GOOGLE_OAUTH_CLIENT_ID` repository secret, packages `inboxcommander-vX.Y.Z.zip` plus store-listing icons, and uploads them as a **draft** GitHub release (prerelease if the tag contains `-`).
- **Scripts:** `bun run test`, `bun run test:watch`, `bun run test:coverage`, `bun run lint`, `bun run format`, `bun run format:check`, `bun run setup`, `bun run clean`, `bun run preview`.

### Changed

- **TypeScript strictness:** `noUnusedLocals` and `noUnusedParameters` are now `true`. Dead code is caught at typecheck. Pre-existing dead code (`$$` in `sidepanel.ts`, `PLACEHOLDER` in `vite.config.ts`) was removed.
- **Migrations:** Popup, options, side panel, and content script no longer define local `sendToBackground`, `escapeHtml`, or `formatMessageText` — they all import from `src/shared/`.
- **Action risk model:** Trashed emails and sent messages are now permanently `HIGH` risk and always require explicit approval. Archive, mark-read, label, and star remain `LOW` and auto-execute by default; `BATCH_MODIFY` is `MEDIUM`. The full per-action risk mapping is in `src/background/action-queue.ts` and the approval matrix is configurable in settings.

### Removed

- Triplicated `sendToBackground` (one in each UI surface).
- Triplicated `escapeHtml` (one in options, one in side panel, plus DOM-based vs entity-based variants).
- Local `formatMessageText` in `sidepanel.ts` (now `src/shared/markdown.ts`).

## [1.0.0] — 2026-06-05

### Initial release

- AI-powered email assistant for Gmail with a side panel chat interface.
- Supported actions: archive, trash, label, mark read, star/unstar, batch modify, draft, send reply, summarize.
- Risk-gated approval flow: low-risk actions can be auto-executed; medium and high require explicit user approval.
- Settings page for API key, model selection, writing tone, and email signature.
- 500-entry rolling action log.
- Local-storage only — no server, no telemetry.
- Manifest v3, Chrome extension.
