<script>
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { db } from '$lib/db';
  import { decryptData } from '$lib/crypto';

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
  let importStep = $state('choice'); // 'choice', 'restore', 'upload', 'processing', 'refine'
  
  // Restore State
  let importBlob = $state('');
  let passphrase = $state('');
  let restoreStatus = $state('');
  let isRestoreError = $state(false);

  // New Import State
  let importPreview = $state([]);
  let ocrStatus = $state('');
  let parseMode = $state('words');
  let swapColumns = $state(false);
  let globalTag = $state('');
  let selectedExistDeck = $state('');
  let importNewDeckName = $state('');
  
  // Workers & Libs
  let createWorker;
  let pdfjsLib;
  let activeWorker = null;
  let lastOcrText = "";
  let fileInput = $state();
  let Html5QrcodeScanner;
  let scanner;
  let showScanner = $state(false);

  // --- 1. RESTORE (E2EE) LOGIC ---
  async function handleRestoreBlob() {
    if (!importBlob) {
      restoreStatus = 'Please paste a link or scan a QR code.';
      isRestoreError = true;
      return;
    }

    let link = importBlob.trim();
    let keyToUse = passphrase.trim();

    try {
      restoreStatus = 'Analyzing Link...';
      isRestoreError = false;
      
      let id, key;
      try {
         const urlObj = new URL(link.startsWith('http') ? link : `https://${link}`);
         id = urlObj.searchParams.get('id');
         key = urlObj.searchParams.get('key');
      } catch (e) {
         throw new Error("Invalid Link format.");
      }

      if (!id) throw new Error("Link missing Locker ID.");

      if (key && !keyToUse) {
          keyToUse = key;
          passphrase = key;
      }

      restoreStatus = 'Downloading backup...';
      const res = await fetch(`/api/locker?id=${id}`);
      if (!res.ok) throw new Error('Backup not found or expired (24h limit).');
      const json = await res.json();
      const dataToDecrypt = json.encryptedData;

      if (!keyToUse) throw new Error('Passphrase required.');

      restoreStatus = 'Decrypting...';

      // 1. Decrypt
      const cards = await decryptData(dataToDecrypt, keyToUse);
      
      // 2. Import to DB
      restoreStatus = `Decryption successful! Importing ${cards.length} cards...`;
      await db.importCards(cards);
      
      // 3. Notify parent
      onComplete(cards.length);
    } catch (e) {
      console.error(e);
      restoreStatus = 'Failed! Incorrect passphrase or corrupted data.';
      isRestoreError = true;
    }
  }

  function toggleScanner() {
    if (!Html5QrcodeScanner) {
      alert("Scanner library is still loading. Please try again in a moment.");
      return;
    }
    
    if (showScanner) {
      if (scanner) {
        scanner.clear().catch(console.error);
        scanner = null;
      }
      showScanner = false;
    } else {
      showScanner = true;
      // Use a timeout to ensure the #qr-reader div is in the DOM
      setTimeout(() => {
        const onScanSuccess = (decodedText, decodedResult) => {
          importBlob = decodedText;
          try {
            const url = new URL(decodedText);
            const key = url.searchParams.get('key');
            if (key) passphrase = key;
          } catch (e) { /* ignore */ }

          toggleScanner(); // Stop scanning on success
        };
        scanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: { width: 250, height: 250 } });
        scanner.render(onScanSuccess, (errorMessage) => { /* ignore scan errors */ });
      }, 100);
    }
  }

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
    for (let i = 0; i < importPreview.length; i++) {
      if (importPreview[i].english === "Click 🌐 to translate" || importPreview[i].english === "[Edit Me]") {
        ocrStatus = `Auto-Translating ${i + 1}/${importPreview.length}...`;
        const result = await translateRow(i);
        if (result === "LIMIT_REACHED") break;
        await new Promise(r => setTimeout(r, 300)); 
      }
    }
    ocrStatus = "";
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
        rawData = fullText.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 5).map(f => ({ f, e: "Click 🌐 to translate" }));
      } else {
        rawData = smartSplitFrench(fullText).map(f => ({ f, e: "Click 🌐 to translate" }));
      }
    } else {
      rawData = cleanLines.map(line => {
        const parts = line.split(/[,|\t;]/);
        return { 
          f: swapColumns ? (parts[1]?.trim() || "") : parts[0].trim(), 
          e: swapColumns ? parts[0].trim() : (parts[1]?.trim() || "[Edit Me]") 
        };
      });
    }

    importPreview = rawData.map(item => {
      const tags = [];
      const cleanF = item.f.toLowerCase().trim();
      if (cleanF.startsWith('le ') || cleanF.startsWith("l'")) tags.push('Masculine');
      if (cleanF.startsWith('la ')) tags.push('Feminine');
      return { french: item.f, english: item.e, tags, tempId: crypto.randomUUID() };
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
    try {
      const finalDeck = importNewDeckName || selectedExistDeck || "General";
      const database = await db.init();
      const transaction = database.transaction(['customCards'], 'readwrite');
      const store = transaction.objectStore('customCards');
      
      const existingFrench = new Set(allCards.map(c => c.french?.toLowerCase().trim()));
      let addedCount = 0;

      // Snapshot to avoid Proxy issues with IndexedDB/Set
      const cardsToImport = $state.snapshot(importPreview);

      cardsToImport.forEach(card => {
        const cleanF = card.french?.toLowerCase().trim();
        if (cleanF && !existingFrench.has(cleanF)) {
          const finalTags = [...new Set([...card.tags, ...(globalTag ? [globalTag] : [])])];
          
          store.add({ 
            id: crypto.randomUUID(),
            french: card.french, 
            english: card.english, 
            tags: finalTags, 
            deck: finalDeck, 
            created: Date.now() 
          });
          addedCount++;
        }
      });

      transaction.oncomplete = () => {
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

  <!-- STEP 1: CHOICE -->
  {#if importStep === 'choice'}
    <div class="choice-container">
      <!-- CHOICE A: RESTORE -->
      <button class="choice-card" onclick={() => importStep = 'restore'}>
        <span class="choice-icon">🔄</span>
        <h4>Restore Library</h4>
        <p>Restore your entire library from a secure backup.</p>
      </button>

      <div class="choice-divider">OR</div>

      <!-- CHOICE B: IMPORT -->
      <button class="choice-card" onclick={() => importStep = 'upload'}>
        <span class="choice-icon">📄</span>
        <h4>New Data Import</h4>
        <p>Import new cards from <b>PDF, Photos, or CSV</b>.</p>
      </button>
    </div>

  <!-- STEP 2A: RESTORE (BLOB) -->
  {:else if importStep === 'restore'}
    <div class="content">
      <p class="desc">Scan the QR code from your old device or paste the Recovery Link.</p>

      <div class="field">
        <label>Recovery Link</label>
        <textarea 
          bind:value={importBlob} 
          placeholder="https://..." 
          rows="2"
        ></textarea>
        
        {#if !showScanner}
        <div class="scan-controls">
          <button class="btn-swap-ghost" onclick={toggleScanner}>📷 Scan QR Code</button>
        </div>
        {/if}

        {#if showScanner}
          <div id="qr-reader"></div>
        {/if}
      </div>

      <div class="field">
        <label>Passphrase</label>
        <input 
          type="text" 
          bind:value={passphrase} 
          placeholder="e.g. apple-table-neon-jump"
        />
      </div>

      <div class="action-footer">
        <button class="btn-secondary" onclick={() => showScanner ? toggleScanner() : importStep = 'choice'}>{showScanner ? 'Stop Scan' : 'Back'}</button>
        <button class="btn-restore" onclick={handleRestoreBlob}>Restore Data</button>
      </div>

      {#if restoreStatus}
        <div class="status {isRestoreError ? 'error' : 'success'}">
          {restoreStatus}
        </div>
      {/if}
    </div>

  <!-- STEP 2B: UPLOAD (NEW IMPORT) -->
  {:else if importStep === 'upload'}
    <div class="upload-zone choice-card" role="button" tabindex="0" onclick={() => fileInput.click()} onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInput.click()}>
      <span class="choice-icon">📁</span>
      <h4>Upload Document</h4>
      <p>Select a <b>CSV, TXT, PDF, or Image</b>.</p>
      <button class="btn-swap-ghost" style="margin-top: 20px;" onclick={(e) => { e.stopPropagation(); importStep = 'choice'; }}>Back</button>
    </div>
    <input type="file" accept=".csv,.txt,.pdf,image/*" bind:this={fileInput} onchange={handleFileSelect} hidden />

  <!-- STEP 3: PROCESSING -->
  {:else if importStep === 'processing'}
    <div class="processing-zone">
      <div class="spinner"></div>
      <p>{ocrStatus || "Processing..."}</p>
      <button class="btn-swap-ghost" onclick={() => importStep = 'choice'}>Cancel</button>
    </div>

  <!-- STEP 4: REFINE -->
  {:else if importStep === 'refine'}
    <div class="import-refine">
      <div class="settings-grid">
        <div class="header-row">
          <span class="small-label">Items: {importPreview.length}</span>
          <div style="display: flex; gap: 8px;">
            <button class="btn-swap-ghost" onclick={translateAll}>🌐 Auto-Translate</button>
            <button class="btn-swap-ghost" onclick={() => { swapColumns = !swapColumns; createPreviewFromLines(importPreview.map(p => `${p.french},${p.english}`), false); }}>🔄 Swap Cols</button>
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
              <div class="flex-row"><input class="f-input" bind:value={card.french} /><button class="mini-btn" onclick={() => translateRow(i)}>🌐</button></div>
              <input class="e-input" bind:value={card.english} />
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
        <button class="btn-secondary" onclick={onCancel}>Cancel</button>
        <button class="btn-primary" onclick={finalImport}>Import All</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .manager-window { background: #0f172a; border-radius: 16px; padding: 20px; border: 1px solid rgba(255,255,255,0.05); color: white; max-height: 80vh; overflow-y: auto; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .title { margin: 0; color: #60a5fa; text-transform: uppercase; font-size: 0.9rem; letter-spacing: 1px; }
  .btn-close { background: none; border: none; color: #8C9BAB; font-size: 1.5rem; cursor: pointer; }
  
  .desc { color: #8C9BAB; font-size: 0.85rem; margin-bottom: 20px; }
  
  /* CHOICE UI */
  .choice-container { display: flex; flex-direction: column; gap: 15px; }
  .choice-card { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); padding: 20px; border-radius: 16px; text-align: center; cursor: pointer; transition: 0.2s; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .choice-card:hover { background: rgba(96, 165, 250, 0.1); border-color: #60a5fa; transform: translateY(-2px); }
  .choice-icon { font-size: 2rem; display: block; margin-bottom: 10px; }
  .choice-card h4 { margin: 0 0 5px 0; color: white; }
  .choice-card p { margin: 0; font-size: 0.9rem; color: #8C9BAB; }
  .choice-divider { text-align: center; font-size: 0.7rem; color: #475569; letter-spacing: 2px; margin: 5px 0; }
  
  /* RESTORE & INPUTS */
  .field { margin-bottom: 15px; }
  label { display: block; color: #94a3b8; font-size: 0.75rem; font-weight: bold; margin-bottom: 6px; text-transform: uppercase; }
  textarea, input { width: 100%; background: #1e293b; color: white; border: 1px solid #334155; padding: 12px; border-radius: 8px; font-family: inherit; box-sizing: border-box; }
  textarea:focus, input:focus { border-color: #60a5fa; outline: none; }
  .scan-controls { text-align: center; margin: -5px 0 15px 0; }
  #qr-reader { width: 100%; margin-top: 15px; border-radius: 8px; overflow: hidden; border: 1px solid #334155; }
  :global(#qr-reader video) { width: 100% !important; height: auto !important; }
  :global(#qr-reader__dashboard_section_swaplink) { display: none !important; }
  :global(#qr-reader__dashboard_section_csr > div:first-child) { display: none !important; }

  
  /* ACTION BUTTONS */
  .action-footer { display: flex; gap: 10px; margin-top: 15px; }
  .btn-restore { flex: 2; background: #60a5fa; color: #0f172a; border: none; padding: 12px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 1rem; }
  .btn-primary { flex: 2; background: #2dd4bf; color: #0f172a; border: none; padding: 12px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 1rem; }
  .btn-secondary { flex: 1; background: #334155; color: white; border: none; padding: 12px; border-radius: 8px; cursor: pointer; font-size: 1rem; }
  
  .status { margin-top: 15px; padding: 10px; border-radius: 6px; font-size: 0.9rem; text-align: center; }
  .status.error { background: rgba(239, 68, 68, 0.2); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); }
  .status.success { background: rgba(45, 212, 191, 0.2); color: #2dd4bf; border: 1px solid rgba(45, 212, 191, 0.3); }
  
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
  .f-input { flex: 1; background: transparent; border: none; color: #2dd4bf; border-bottom: 1px solid #334155; }
  .e-input { background: transparent; border: none; color: #8C9BAB; width: 90%; }
  .tag-chip { font-size: 0.6rem; padding: 2px 6px; border-radius: 4px; cursor: pointer; margin-right: 4px; }
  .mini-btn { background: transparent; border: 1px solid #334155; border-radius: 4px; cursor: pointer; padding: 2px 4px; color: white; }
  
  .upload-zone { border: 2px dashed rgba(255, 255, 255, 0.1); padding: 40px; }
  
  .custom-scrollbar::-webkit-scrollbar { width: 8px; }
  .custom-scrollbar::-webkit-scrollbar-track { background: #0f172a; border-radius: 10px; }
  .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; border: 2px solid #0f172a; }
</style>