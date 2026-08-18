# WorkBook — Digital Notebook

Scan a school notebook with your camera, get an AI-cleaned digital copy, keep a planner of tests/homework, and let AI build study sheets, web study resources, practice tests, flashcards and a tutor from your own notes.

## Run
```
npm install
npm start          # http://localhost:4980
```
AI: uses `ANTHROPIC_API_KEY` from `.env` (or `../Calorie_Counter/server/.env`) if present, otherwise falls back to the local `claude` CLI (Claude Code subscription). Vision (page reading + edge detection) works in both modes.

## Features
- **Notebooks** — create one, say how many pages you'll scan; progress bar; page grid; **Book view** (flip-through spread: scan on the left, digital copy on the right, or two scans; cover; page-turn animation; keyboard/swipe).
- **Scanner** — live camera (HTTPS/localhost) or phone "Take photo"; AI finds the page corners → drag to fine-tune → perspective straighten → filters (Enhanced keeps ink colors, Soft color, Grayscale, B&W, Original); batch "Page 3 of 20"; AI transcribes each page to Markdown + title + key points + vocab (runs in background while you scan the next).
- **Pages** — enhanced/original toggle, editable transcript, re-read with AI, download, full-text search across all pages.
- **Planner** — month calendar + upcoming list; tests/quizzes/homework/projects; countdowns; "Study" button creates a study set.
- **Study sets** — Study sheet (from your notes), More online (Claude web search → real links + summary), Practice tests (MC/TF/short, AI-graded with feedback, attempts + scores), Flashcards (flip, known/learning, shuffle), Tutor chat.
- **Login** — local accounts (scrypt), cookie sessions. Data in `data/` (JSON + JPGs) — swap `store.js` for Postgres/S3 for cloud.

## Files
`server.js` routes · `ai.js` Claude (API/CLI) · `store.js` storage · `public/js/{app,core,scan,imageproc,book,study}.js` · `public/css/styles.css`
