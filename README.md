# Vault

A phone editor for a git-backed markdown vault, installed from Safari as a home screen app.

This is the editor test. It holds dummy notes only: nothing connects to GitHub, and nothing leaves the phone. Syncing and search come later, if typing in it feels right on a real iPhone.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests for the formatting commands
npm run test:e2e   # WebKit at iPhone sizes (first: npx playwright install webkit)
npm run lint
npm run build
```

Playwright has no on-screen keyboard, so keyboard behaviour, autocorrect and dictation can only be tested on an iPhone.

## Install on iPhone

Open the deployed URL in Safari, then Share → **Add to Home Screen**.
