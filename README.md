# Vault

A phone editor for a git-backed markdown vault, installed from Safari as a home screen app.

It keeps a copy of your notes on the phone and syncs them straight to GitHub, so the phone and laptop both just use git. Every edit is saved on the phone first and pushed afterwards. Nothing dirty is ever overwritten: if a note changed on both sides, the phone's version is kept as a separate `(phone conflict …)` file.

Files with `do not edit` in their header are generated, so they open read-only. The app has no delete or rename, on purpose.

Your notes and GitHub key never go in this repo. They're stored only on the phone, and the page's content security policy only lets it connect to itself and GitHub.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests, including the sync engine
# Full flow in WebKit, against the real API and the private throwaway repo:
# (first: npx playwright install webkit)
VAULT_TEST_TOKEN=$(gh auth token) npm run test:e2e
npm run lint
npm run build
```

Playwright has no on-screen keyboard, so keyboard behaviour, autocorrect and dictation can only be tested on an iPhone.

## Install on iPhone

Open the deployed URL in Safari, then Share → **Add to Home Screen**.
