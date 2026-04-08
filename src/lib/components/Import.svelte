<script>
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { db } from '$lib/db';
  import { encryptData } from '$lib/crypto';

  // --- PROPS ---
  let { 
    allCards = [], 
    usedDecks = [], 
    TAG_PRESETS = [], 
    getTagColor = () => '#2dd4bf', 
    onComplete, 
    onCancel 
  } = $props();

  // --- STATE ---
  let importStep = $state('upload'); // 'upload', 'processing', 'refine'
  
  // New Import State
  let importPreview = $state([]);
  let ocrStatus = $state('');
  let parseMode = $state('words');
  let globalTag = $state('');
  let selectedExistDeck = $state('');
  let importNewDeckName = $state('');
  let isTranslating = $state(false);
  
  // Workers & Libs
  let createWorker;
  let pdfjsLib;
  let activeWorker = null;
  let lastOcrText = "";
  let fileInput = $state();
  let Html5QrcodeScanner;
  let scanner;
  let showScanner = $state(false);

  // --- 2. NEW IMPORT / OCR LOGIC ---
  onMount(async () => {
    if (browser) {
      try {
        const Tesseract = await import('tesseract.js');
        createWorker = Tesseract.createWorker;
        const pdfData = await import('pdfjs-dist');
        pdfjsLib = pdfData;
        const version = pdfjsLib.version || '5.5.207'; 
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;

        // Dynamically import the scanner library so it doesn't block the initial render
        const html5Qrcode = await import('html5-qrcode');
        Html5QrcodeScanner = html5Qrcode.Html5QrcodeScanner;

      } catch (e) {
        console.error("Library load error:", e);
        ocrStatus = "Security Block: Check Console";
      }
    }
  });

  onDestroy(async () => {
    if (activeWorker) await activeWorker.terminate();
    if (scanner) {
      await scanner.clear().catch(() => {}); // Gracefully clear scanner on component destroy
    }
  });

  function smartSplitFrench(text) {
    const rawWords = text.replace(/[.,!?;:]/g, ' ')
                         .replace(/([ldnjtsm])['’]\s*/gi, "$1' ") 
                         .split(/\s+/)
                         .filter(w => w.length > 0);
    const results = [];
    const sticky = ['le', 'la', 'l', 'les', 'un', 'une', 'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses', 'ce', 'c', 'd', 'des', "l'", "d'", "j'", "n'", "s'", "m'", "t'"];
    for (let i = 0; i < rawWords.length; i++) {
      let current = rawWords[i];
      let lower = current.toLowerCase();
      if (sticky.includes(lower) && i + 1 < rawWords.length) {
        results.push(current + (current.endsWith("'") ? "" : " ") + rawWords[i+1]);
        i++; 
      } else if (current.length > 0) {
        results.push(current);
      }
    }
    return results;
  }

  async function translateRow(index) {
    const card = importPreview[index];
    if (!card.french || card.french === "[Edit Me]") return;
    const previousStatus = ocrStatus;
    ocrStatus = "Translating...";
    try {
      const resp = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(card.french)}&langpair=fr|en`);
      if (resp.status === 429) {
        alert("🚨 Translation Limit Reached!");
        ocrStatus = "";
        return "LIMIT_REACHED"; 
      }
      const data = await resp.json();
      importPreview[index].english = data.responseData.translatedText;
    } catch (err) {
      console.error("Translation failed", err);
    } finally { 
      if (ocrStatus === "Translating...") ocrStatus = previousStatus; 
    }
  }

  async function translateAll() {
    if (isTranslating) return;
    isTranslating = true;
    try {
    for (let i = 0; i < importPreview.length; i++) {
      if (importPreview[i].english === "Click 🌐 to translate" || importPreview[i].english === "[Edit Me]") {
        ocrStatus = `Auto-Translating ${i + 1}/${importPreview.length}...`;
        const result = await translateRow(i);
        if (result === "LIMIT_REACHED") break;
        await new Promise(r => setTimeout(r, 300)); 
      }
    }
    } finally {
      isTranslating = false;
    ocrStatus = "";
    }
  }

  // Cycles columns: French -> English -> Pronunciation -> French
  function rotateColumns() {
    importPreview = importPreview.map(card => ({
      ...card,
      french: card.english,
      english: card.pronunciation || "",
      pronunciation: card.french
    }));
  }

  // Swaps English and Pronunciation while leaving French intact
  function swapTranslatePronunciation() {
    importPreview = importPreview.map(card => ({
      ...card,
      english: card.pronunciation || "",
      pronunciation: card.english
    }));
  }

  async function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    importStep = 'processing';
    if (file.type === "application/pdf") {
      await processPDF(file);
    } else if (file.type.startsWith("image/")) {
      await processImage(file);
    } else {
      parseMode = null; 
      processTextFile(file);
    }
    event.target.value = ''; // Allow re-uploading the same file
  }

  async function processImage(source) {
    try {
      ocrStatus = "Initializing OCR...";
      if (!activeWorker) {
        activeWorker = await createWorker('fra+eng', 1, {
          workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@v5.0.0/dist/worker.min.js',
          corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@v5.0.0/tesseract-core.wasm.js'
        });
      }
      const { data: { text } } = await activeWorker.recognize(source);
      lastOcrText = text; 
      createPreviewFromLines(text.split('\n'), true); 
      importStep = 'refine';
    } catch (e) {
      ocrStatus = "OCR Blocked.";
    }
  }

  async function processPDF(file) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({
        data: arrayBuffer,
        disableWorker: true,
        disableFontFace: true,
        disableRange: true,
        disableAutoFetch: true
      });
      const pdf = await loadingTask.promise;
      let fullText = "";

      ocrStatus = "OCR Engine Starting...";
      if (!activeWorker) {
        activeWorker = await createWorker('fra+eng', 1, {
          workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@v5.0.0/dist/worker.min.js',
          corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@v5.0.0/tesseract-core.wasm.js'
        });
      }

      const maxPages = Math.min(pdf.numPages, 5); // Limit pages for performance
      for (let i = 1; i <= maxPages; i++) {
        ocrStatus = `OCR Scanning Page ${i}...`;
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        await page.render({ canvasContext: context, viewport }).promise;
        const { data: { text } } = await activeWorker.recognize(canvas);
        fullText += text + "\n";
      }

      lastOcrText = fullText;
      createPreviewFromLines(fullText.split('\n'), true);
      importStep = 'refine';
    } catch (e) {
      ocrStatus = `Error: ${e.message}`;
    }
  }

  function processTextFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const lines = text.split(/\r?\n/).filter(line => line.trim() !== "");
      createPreviewFromLines(lines, false); 
      importStep = 'refine';
    };
    reader.onerror = () => {
      alert("Failed to read file.");
      importStep = 'upload';
    };
    reader.readAsText(file);
  }

  function createPreviewFromLines(lines, isOCR) {
    let rawData = [];
    const cleanLines = lines.filter(line => {
      const t = line.trim();
      if (/^[\d\s\/\-\.]+$/.test(t)) return false;
      return t.length >= 2;
    });

    if (isOCR) {
      const fullText = cleanLines.join(' ');
      if (parseMode === 'sentences') {
        rawData = fullText.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 5).map(f => ({ f, e: "Click 🌐 to translate", p: null }));
      } else {
        rawData = smartSplitFrench(fullText).map(f => ({ f, e: "Click 🌐 to translate", p: null }));
      }
    } else {
      rawData = cleanLines.map(line => {
        const parts = line.split(/[,|\t;]/);
        return { 
          f: parts[0]?.trim() || "", 
          e: parts[1]?.trim() || "[Edit Me]",
          p: parts.length > 2 ? (parts[2]?.trim() || "") : null
        };
      });
    }

    importPreview = rawData.map(item => {
      const tags = [];
      const cleanF = item.f.toLowerCase().trim();
      if (cleanF.startsWith('le ') || cleanF.startsWith("l'")) tags.push('Masculine');
      if (cleanF.startsWith('la ')) tags.push('Feminine');
      return { french: item.f, english: item.e, pronunciation: item.p, tags, tempId: crypto.randomUUID() };
    });
    ocrStatus = "";
  }

  function toggleImportTag(tempId, tag) {
    const index = importPreview.findIndex(c => c.tempId === tempId);
    if (index === -1) return;
    const card = importPreview[index];
    const hasTag = card.tags.includes(tag);
    importPreview[index].tags = hasTag ? card.tags.filter(t => t !== tag) : [...card.tags, tag];
  }

  function toggleParseMode(mode) {
    parseMode = mode;
    createPreviewFromLines(lastOcrText.split('\n'), true);
  }

  async function finalImport() {
    if (isTranslating) return;
    try {
      const finalDeck = importNewDeckName || selectedExistDeck || "General";
      const allExisting = await db.getAllCards();
      
      // Create a map to quickly find existing cards by French text
      const existingMap = new Map(allExisting.map(c => [c.french?.toLowerCase().trim(), c]));
      
      const database = await db.init();
      const transaction = database.transaction(['customCards'], 'readwrite');
      const store = transaction.objectStore('customCards');
      
      let addedCount = 0;

      // Snapshot to avoid Proxy issues with IndexedDB/Set
      const cardsToImport = $state.snapshot(importPreview);

      cardsToImport.forEach(card => {
        const cleanF = card.french?.toLowerCase().trim();
        if (!cleanF) return;

        const existing = existingMap.get(cleanF);
        const finalTags = [...new Set([...(existing?.tags || []), ...card.tags, ...(globalTag ? [globalTag] : [])])];
        
        // .put() updates if the ID matches, ensuring 3rd column info is saved over old data
        store.put({ 
          id: existing ? existing.id : crypto.randomUUID(),
          french: card.french, 
          english: card.english, 
          pronunciation: card.pronunciation,
          tags: finalTags, 
          deck: existing ? existing.deck : finalDeck, 
          created: existing ? existing.created : Date.now() 
        });
        addedCount++;
      });

      transaction.oncomplete = async () => {
        // Auto-Sync to Cloud if user is logged in
        const savedPhrase = localStorage.getItem('fledge_vault_phrase');
        const savedUserID = localStorage.getItem('fledge_user_id');

        if (savedPhrase && savedUserID) {
          try {
            const allCards = await db.getAllCards();
            const encryptedData = await encryptData(allCards, savedPhrase);
            
            await fetch('/api/locker', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ lockerId: savedUserID, encryptedData })
            });
          } catch (syncErr) {
            console.error("Cloud auto-sync failed after import:", syncErr);
          }
        }
        
        onComplete(addedCount);
      };
      
      transaction.onerror = (e) => {
        console.error("IDB Transaction Error:", e);
        alert("Database error: Transaction failed.");
      };

    } catch (err) {
      console.error("Final Import Error:", err);
      alert("Something went wrong during import.");
    }
  }
</script>

<div class="manager-window custom-scrollbar">
  <!-- HEADER -->
  {#if importStep === 'refine'}
     <!-- Refine step has its own internal header -->
  {:else}
    <div class="header">
      <h3 class="title">Import / Restore</h3>
      <button class="btn-close" onclick={onCancel}>×</button>
    </div>
  {/if}

  <!-- STEP 1: UPLOAD -->
  {#if importStep === 'upload'}
    <div class="upload-zone choice-card" role="button" tabindex="0" onclick={() => fileInput.click()} onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInput.click()}>
      <span class="choice-icon">📁</span>
      <h4>Upload Document</h4>
      <p>Select a <b>CSV, TXT, PDF, or Image</b>.</p>
    </div>
    <input type="file" accept=".csv,.txt,.pdf,image/*" bind:this={fileInput} onchange={handleFileSelect} hidden />

  <!-- STEP 2: PROCESSING -->
  {:else if importStep === 'processing'}
    <div class="processing-zone">
      <div class="spinner"></div>
      <p>{ocrStatus || "Processing..."}</p>
    </div>

  <!-- STEP 3: REFINE -->
  {:else if importStep === 'refine'}
    <div class="import-refine">
      <div class="settings-grid">
        <div class="header-row">
          <span class="small-label">Items: {importPreview.length}</span>
          <div style="display: flex; gap: 8px;">
            <button class="btn-swap-ghost" onclick={translateAll} disabled={isTranslating}>
              {isTranslating ? 'Translating...' : '🌐 Auto-Translate'}
            </button>
            <button class="btn-swap-ghost" onclick={rotateColumns}>🔄 Shift Order</button>
            <button class="btn-swap-ghost" onclick={swapTranslatePronunciation}>⇄ Swap E/P</button>
          </div>
        </div>

        {#if parseMode !== null}
          <div class="mode-toggle-row" style="display: flex; gap: 5px; margin-bottom: 10px;">
             <button class="btn-swap-ghost {parseMode === 'words' ? 'active' : ''}" onclick={() => toggleParseMode('words')}>Words</button>
             <button class="btn-swap-ghost {parseMode === 'sentences' ? 'active' : ''}" onclick={() => toggleParseMode('sentences')}>Sentences</button>
          </div>
        {/if}

        <div class="deck-selector">
          <select bind:value={selectedExistDeck}>
            <option value="">-- Deck --</option>
            {#each usedDecks as d}<option value={d}>{d}</option>{/each}
          </select>
          <input type="text" placeholder="New Deck..." bind:value={importNewDeckName} />
        </div>
        
        <div class="global-tag-row">
          <span class="small-label">Global Tag:</span>
          <select class="global-tag-select" bind:value={globalTag} style="color: {getTagColor(globalTag)}">
            <option value="" style="color: white;">None</option>
            {#each TAG_PRESETS as tag}
              <option value={tag} style="color: {getTagColor(tag)}">{tag}</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="import-list custom-scrollbar">
        {#each importPreview as card, i (card.tempId)}
          <div class="import-row">
            <button class="btn-del-top" onclick={() => importPreview = importPreview.filter(p => p.tempId !== card.tempId)}>✕</button>
            <div class="row-inputs">
              <div class="flex-row">
                <span class="slot-label fr">FR</span>
                <input class="f-input" bind:value={card.french} />
                <button class="mini-btn" onclick={() => translateRow(i)} disabled={isTranslating}>🌐</button>
              </div>
              <div class="flex-row">
                <span class="slot-label en">EN</span>
                <input class="e-input" bind:value={card.english} />
              </div>
              <div class="flex-row">
                <span class="slot-label pr">PR</span>
                <input class="p-input" bind:value={card.pronunciation} placeholder="Pronunciation (optional)..." />
              </div>
              <div class="row-tags">
                {#each TAG_PRESETS as tag}
                  {@const isActive = card.tags.includes(tag) || globalTag === tag}
                  <button class="tag-chip {isActive ? 'active' : ''}" 
                          style="{isActive ? `background: ${getTagColor(tag)}; color: #0f172a;` : 'background: transparent; color: #8C9BAB; border: 1px solid #334155;'}" 
                          onclick={() => toggleImportTag(card.tempId, tag)} 
                          disabled={globalTag === tag}>{tag}</button>
                {/each}
              </div>
            </div>
          </div>
        {/each}
      </div>

      <div class="action-footer">
        <button class="btn-secondary" onclick={onCancel} disabled={isTranslating}>Cancel</button>
        <button class="btn-primary" onclick={finalImport} disabled={isTranslating}>
          {isTranslating ? 'Fetching Translations...' : 'Import All'}
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .manager-window { background: #0f172a; border-radius: 16px; padding: 20px; border: 1px solid rgba(255,255,255,0.05); color: white; max-height: 80vh; overflow-y: auto; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .title { margin: 0; color: #60a5fa; text-transform: uppercase; font-size: 0.9rem; letter-spacing: 1px; }
  .btn-close { background: none; border: none; color: #8C9BAB; font-size: 1.5rem; cursor: pointer; }
  
  /* CHOICE UI */
  .choice-card { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); padding: 20px; border-radius: 16px; text-align: center; cursor: pointer; transition: 0.2s; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .choice-card:hover { background: rgba(96, 165, 250, 0.1); border-color: #60a5fa; transform: translateY(-2px); }
  .choice-icon { font-size: 2rem; display: block; margin-bottom: 10px; }
  .choice-card h4 { margin: 0 0 5px 0; color: white; }
  .choice-card p { margin: 0; font-size: 0.9rem; color: #8C9BAB; }
  
  /* RESTORE & INPUTS */
  input { width: 100%; background: #1e293b; color: white; border: 1px solid #334155; padding: 12px; border-radius: 8px; font-family: inherit; box-sizing: border-box; }
  input:focus { border-color: #60a5fa; outline: none; }
  
  /* ACTION BUTTONS */
  .action-footer { display: flex; gap: 10px; margin-top: 15px; }
  .btn-primary { flex: 2; background: #2dd4bf; color: #0f172a; border: none; padding: 12px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 1rem; }
  .btn-secondary { flex: 1; background: #334155; color: white; border: none; padding: 12px; border-radius: 8px; cursor: pointer; font-size: 1rem; }
  
  
  /* PROCESSING */
  .processing-zone { padding: 40px; text-align: center; background: rgba(30, 41, 59, 0.5); border-radius: 12px; }
  .spinner { width: 30px; height: 30px; border: 3px solid #2dd4bf; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 15px; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* REFINE GRID */
  .settings-grid { background: #1e293b; padding: 10px; border-radius: 8px; margin-bottom: 10px; }
  .header-row, .deck-selector { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 8px; align-items: center; }
  .global-tag-row { display: flex; align-items: center; gap: 10px; margin-top: 5px; }
  .global-tag-select { flex: 1; background: #1e293b; border: 1px solid #334155; border-radius: 4px; padding: 5px; color: white; }
  .deck-selector input, .deck-selector select { flex: 1; background: #0f172a; border: 1px solid #334155; color: white; padding: 5px; border-radius: 4px; }
  
  .btn-swap-ghost { background: transparent; border: 1px solid rgba(45, 212, 191, 0.3); color: rgba(45, 212, 191, 0.8); padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; cursor: pointer; }
  .btn-swap-ghost.active { background: rgba(45, 212, 191, 0.2); border-color: #2dd4bf; }
  
  .import-list { max-height: 400px; overflow-y: auto; }
  .import-row { background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; margin-bottom: 8px; position: relative; display: flex; gap: 10px; }
  .btn-del-top { position: absolute; top: 8px; right: 8px; background: transparent; border: none; color: #ef4444; cursor: pointer; font-size: 1.2rem; line-height: 0.5; }
  .row-inputs { flex: 1; display: flex; flex-direction: column; gap: 4px; }
  .flex-row { display: flex; gap: 5px; width: 90%; }
  .slot-label { font-size: 0.55rem; font-weight: 900; padding: 2px 4px; border-radius: 4px; min-width: 22px; text-align: center; display: inline-flex; align-items: center; justify-content: center; height: 14px; margin-top: 4px; flex-shrink: 0; }
  .slot-label.fr { background: rgba(45, 212, 191, 0.1); color: #2dd4bf; border: 1px solid rgba(45, 212, 191, 0.2); }
  .slot-label.en { background: rgba(140, 155, 171, 0.1); color: #8C9BAB; border: 1px solid rgba(140, 155, 171, 0.2); }
  .slot-label.pr { background: rgba(251, 191, 36, 0.1); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.2); }

  .f-input { flex: 1; background: transparent; border: none; color: #2dd4bf; border-bottom: 1px solid #334155; }
  .e-input { background: transparent; border: none; color: #8C9BAB; width: 90%; }
  .p-input { background: transparent; border: none; color: #fbbf24; font-size: 0.8rem; font-style: italic; width: 90%; }
  .tag-chip { font-size: 0.6rem; padding: 2px 6px; border-radius: 4px; cursor: pointer; margin-right: 4px; }
  .mini-btn { background: transparent; border: 1px solid #334155; border-radius: 4px; cursor: pointer; padding: 2px 4px; color: white; }
  
  .upload-zone { border: 2px dashed rgba(255, 255, 255, 0.1); padding: 40px; }
  
  .custom-scrollbar::-webkit-scrollbar { width: 8px; }
  .custom-scrollbar::-webkit-scrollbar-track { background: #0f172a; border-radius: 10px; }
  .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; border: 2px solid #0f172a; }
</style>