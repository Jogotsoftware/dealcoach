# DealCoach Desktop Widget

Standalone Electron desktop widget for DealCoach. Tasks, AI Chat, Deals, and Email generation — all connected to the existing Supabase backend.

## Setup

```bash
cd desktop
npm install
```

## Run

```bash
npm start
```

## Build

```bash
# macOS
npm run build-mac

# Windows
npm run build-win
```

## Features

- **Tasks**: View, create, and complete tasks across all deals. Filters: My Tasks, High Priority, By Deal. Real-time updates via Supabase subscriptions.
- **Chat (Ask Coach)**: AI coaching chatbot per deal. Session history. Action badges when AI creates tasks or updates fields.
- **Deals**: View all deals, create new ones (auto-triggers AI research), open in web app.
- **Emails**: Generate AI emails from templates, copy to clipboard, open in mail client.

## Architecture

- Single HTML file (`index.html`) with embedded CSS and vanilla JS — no build step
- Electron main process (`main.js`) provides frameless window, system tray, and IPC
- Supabase JS client loaded from CDN for database queries
- Edge functions called via fetch for AI features (chat, email, research)
- Dark theme matching the web app design
