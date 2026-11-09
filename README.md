# Library

A phone editor for a git-backed markdown library, installed from Safari as a home screen app.

It keeps a copy of your notes on the phone and syncs them straight to GitHub, so the phone and laptop both just use git. Every edit is saved on the phone first and pushed afterwards. Nothing dirty is ever overwritten: if a note changed on both sides, the phone's version is kept as a separate `(phone conflict …)` file.

The Flashcards tab tests you on the cards in `knowledge/flashcards/flashcards.json`, on a monthly spaced-repetition schedule. Cards come from your notes through GitHub, so they're never in this repo. Grades go to the `life-admin` server, which is where Sumi reads them and the schedule is rebuilt from.

Files with `do not edit` in their header are generated, so they open read-only. The app has no delete or rename, on purpose.

Your notes and GitHub key never go in this repo. They're stored only on the phone, and the page's content security policy only lets it connect to itself, GitHub and the `life-admin` server, which never receives the key.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests, including the sync engine
# Full flow in WebKit, against the real API and the private throwaway repo:
# (first: npx playwright install webkit)
LIBRARY_TEST_TOKEN=$(gh auth token) npm run test:e2e
npm run lint
npm run build
```

Playwright has no on-screen keyboard, so keyboard behaviour, autocorrect and dictation can only be tested on an iPhone.

## Install on iPhone

Open the deployed URL in Safari, then Share → **Add to Home Screen**.
