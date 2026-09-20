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
- **Review** — one daily spaced-repetition queue across every study set (Leitner boxes 0–5, rate again/hard/good/easy, keys 1–4); Home shows what's due.
- **Study plan** — AI schedules the days until the test with checkable tasks; today's tasks show on Home.
- **Grades** — classes with weighted categories, drop-lowest, current grade and letter, GPA, and a "what do I need on the final" calculator.
- **Page tools** — explain simply, summary, practice questions, translate, read aloud, and a tutor chat scoped to one page. Zoomable scan.
- **Vocab bank** — every term the AI found in a notebook, searchable; one click makes flashcards from it (no AI call).
- **Planner extras** — assignment steps (AI "break it down"), overdue warning, subtask progress on rows.
- **Trash** — deleted pages and notebooks are kept 30 days; Undo toast + Settings → Trash.
- **Command palette** — ⌘K / Ctrl+K / `/` searches pages, notebooks, sets and planner items and runs actions; `?` lists keyboard shortcuts.
- **Scan input** — camera, photos, paste (⌘V), drag-and-drop, and PDF import. Image processing runs in a Web Worker; images upload as raw JPEG (no base64).
- **Dark mode** — Auto (follows the device), Light or Dark.
- **Exports** — notebook or page as Markdown, flashcards as TSV (Anki/Quizlet), study sheet as Markdown, print/PDF.
- **Shared links** — friends can save a copy of a shared study set or notebook to their own account.
- **Login** — local accounts (scrypt), cookie sessions, change password. Data in `data/` (JSON + JPGs) locally, Postgres on Cloud Foundry.

## Files
`server.js` routes · `ai.js` Claude / OpenAI-compatible / CLI · `store.js` storage + trash · `notify.js` reminders · `public/js/{app,core,scan,scanworker,imageproc,book,study,review,grades,palette,extras,push}.js` · `public/css/styles.css`
