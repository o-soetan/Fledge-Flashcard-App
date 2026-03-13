# Whst this is
- Core Functionality: An offline-capable flashcard app to help users learn French vocabulary.
- Target User: French language learners who want to study anywhere, even without an internet connection.
- Key Features:
    Offline-First: Uses IndexedDB to store all user data locally in the browser.
    Vocabulary Management: Users can organize words with tags (like noun/verb, gender) and perform bulk actions.
    Data Import: Users can import their existing vocabulary lists from CSV, TXT, Exported files from other instance of the app, PDF, or Photo files.

 
**Context.md**(Top level) routes you to the right workspace. This file is the map.


## Folder Structure
Fledge/
├── src/
│   ├── lib/
│   │   ├── components/
│   │   │   ├── addnew.svelte
│   │   │   ├── AudioRecorder.svelte
│   │   │   ├── Context.md        <- You are here!>
│   │   │   ├── Counter.svelte
│   │   │   ├── Dashboard.svelte
│   │   │   ├── Export.svelte
│   │   │   ├── Header.svelte
│   │   │   ├── Import.svelte
│   │   │   ├── Settings.svelte
│   │   │   ├── Study.svelte
│   │   │   └── tagDecks.svelte
│   │   └── db.js
│   │   └── fetcher.js
│   ├── routes/
│   │   ├── +layout.svelte
│   │   └── +page.svelte
│   ├── app.css
│   └── app.html
├── .gitignore
├── .npmrc
├── Context.md
├── package-lock.json
├── package.json
├── README.md
├── svelte.config.js
└── vite.config.js
