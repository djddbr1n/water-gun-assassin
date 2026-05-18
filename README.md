# 💧 Water Gun Assassin

A real-time multiplayer water gun assassination game built with React, Vite, Firebase, and Tailwind CSS. Designed for week-long games with friends.

## Game Rules

- Players join a game via a 6-character code
- An admin starts the game — players are auto-sorted into teams of 2–3
- Teams are assigned targets in a circular chain (A → B → C → A)
- To eliminate: click **💦 Eliminated!** on a target player — they are immediately marked as out
- If a player thinks an elimination was unfair, they can file a **Dispute** with a message to the admin
- The admin can **Restore Player** (un-eliminate and fix the target chain) or confirm the elimination stands
- When all players on a team are eliminated, that team is out and the eliminating team inherits the eliminated team's original target
- Real-time leaderboard shows individual elimination counts and team survival status
- Game ends when only 1 team remains

## Rejoining a Game

Since games can last a week or more, every player gets a personal **rejoin link** shown in the lobby and on the game page. Bookmark it to re-enter the game from any device at any time — no login required.

Players who have previously joined on a device will also see a **Rejoin a game** section on the home page.

## How to Play

1. One player clicks **Create a Game** and enters their name — they become the admin
2. Share the 6-character code with friends
3. Friends click **Join a Game**, enter the code and their name
4. Once 4+ players have joined, the admin clicks **Start Game**
5. Teams are formed and targets assigned automatically
6. On the **My Team** tab, see your team and your target team
7. When you eliminate a target in real life, click **💦 Eliminated!** — they're immediately marked out
8. If you were wrongly eliminated, go to the **Eliminations** tab and file a dispute with a message
9. The admin reviews disputes and can restore players or confirm the elimination
10. Track standings on the **Leaderboard** tab
11. Last team standing wins!

## Admin Controls

The game creator has extra powers in the **Eliminations** tab:
- View all open disputes with the player's message
- **↩ Restore Player** — un-eliminates the player, restores their team if needed, and fixes the target chain
- **✓ Elimination Stands** — dismisses the dispute, elimination stays

## Setup

### 1. Install dependencies

```bash
cd water-gun-assassin
npm install
```

### 2. Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project** and follow the steps
3. In the project dashboard, click **Firestore Database** in the left sidebar
4. Click **Create database** and choose **Start in test mode**
5. Select a region and click **Enable**

### 3. Get your Firebase config

1. In the Firebase console, go to **Project Settings** (gear icon)
2. Under **Your apps**, click **Add app** → choose the **Web** icon (`</>`)
3. Register the app (name it anything)
4. Copy the `firebaseConfig` object values

### 4. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in your Firebase project values:

```
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123
```

### 5. Run the development server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### 6. Deploy to Vercel

Connect your GitHub repo to [vercel.com](https://vercel.com), add the 6 Firebase env variables in the Vercel dashboard, and deploy. Every `git push` auto-redeploys.

## Tech Stack

- **React 18** + **Vite 5**
- **Firebase 10** (Firestore real-time listeners)
- **React Router v6**
- **Tailwind CSS v3**
- **Vercel** (hosting)
