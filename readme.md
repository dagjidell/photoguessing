# Photo Guessing

A React + Vite web app for running live photo guessing games on GitHub Pages with Firebase Authentication and Firestore.

## What the app supports

- Google sign-in for the Creator / Presenter workspace
- Anonymous player sign-in behind the scenes so player guesses can be stored securely
- Multiple games, each with a 5-character join code
- Draft, published, live, and finished game states
- One page per person with three photo links, optional header, and optional text
- Live presenter navigation where all players follow the active page automatically
- Free-text player guesses that can be edited until the presenter finishes the game
- Final leaderboard sorted by correct answers, plus the revealed correct answers

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Fill in the Firebase web app config values from the `photoguessing` Firebase project.
3. Install dependencies and start the dev server.

```bash
npm install
npm run dev
```

## Required environment variables

```bash
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=photoguessing.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=photoguessing
VITE_FIREBASE_STORAGE_BUCKET=photoguessing.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

## GitHub Pages deployment

The existing GitHub Actions workflow builds the app for Pages. Add these repository secrets so the workflow can inject the Firebase config during the build:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

## Firestore rules

A starter rules file lives at `/home/runner/work/photoguessing/photoguessing/firestore.rules`.

Deploy it with the Firebase CLI after you connect the repository to your Firebase project:

```bash
firebase deploy --only firestore:rules
```

## Data model

- `games/{gameId}`
  - `title`
  - `code`
  - `status`
  - `activePageIndex`
  - `pages[]`
  - `createdBy`
  - `createdAtMs`
  - `updatedAtMs`
- `games/{gameId}/players/{playerId}`
  - `displayName`
  - `normalizedName`
  - `guesses`
  - `joinedAtMs`
  - `updatedAtMs`

## Validation

- Lint with `npm run lint`
- Build with `npm run build`
