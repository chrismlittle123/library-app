# Library

A phone editor for a git-backed markdown library, installed from Safari as a home screen app.

It keeps a copy of your notes on the phone and syncs them straight to GitHub, so the phone and laptop both just use git. Every edit is saved on the phone first and pushed afterwards. Nothing dirty is ever overwritten: if a note changed on both sides, the phone's version is kept as a separate `(phone conflict …)` file.

The Flashcards tab tests you on the cards in `knowledge/flashcards/flashcards.json`, on a monthly spaced-repetition schedule. Cards come from your notes through GitHub, so they're never in this repo. Grades go to the `life-admin` server, which is where Sumi reads them and the schedule is rebuilt from. That server's key is in `knowledge/flashcards/server-key.txt` in the private notes repo, because this page is public and must never have a secret built into it.

Files with `do not edit` in their header are generated, so they open read-only. Other notes can be deleted or moved to another folder from the editor. Move keeps the filename and needs a connection: writing is saved and synced first, then both paths change in one GitHub commit. A name collision or a change elsewhere stops the move. Deletions and moves each have their own commit, which can be undone with `git revert`.

The house button returns to the library root and clears search. Back keeps your previous folder and search results. In a note, both save your writing before leaving. Move is labelled beside the note’s folder, above the editor.

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
npm run phone      # the app in Chrome at iPhone size
npm run build
node scripts/build-icons.mjs  # export app icons from public/library-mark.svg
```

Playwright has no on-screen keyboard, so keyboard behaviour, autocorrect and dictation can only be tested on an iPhone.

## Install on iPhone

Open the deployed URL in Safari, then Share → **Add to Home Screen**.
