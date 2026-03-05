<script>
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { db } from '$lib/db';

  export let allCards = [];
  export let usedDecks = [];
  export let TAG_PRESETS = [];
  export let getTagColor;
  export let onComplete;
  export let onCancel;

  let createWorker;
  let pdfjsLib;
  let activeWorker = null; 

  // --- STEP MANAGEMENT ---
  let importStep = 'choice'; 
  
  let importPreview = [];
  let importNewDeckName = "";
  let selectedExistDeck = "";
  let globalTag = ""; 
  let swapColumns = false;
  let fileInput;
  let restoreInput; 
  let ocrStatus = "";
  
  let parseMode = 'words'; 
  let lastOcrText = ""; 
  let currentFile = null;

  // --- 1. RESTORE PREVIOUS DATA LOGIC ---
  async function handleRestoreJSON(event) {
    const file = event.target.files[0];
    if (!file) return;

    ocrStatus = "Restoring Library...";
    importStep = 'processing';

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const rawData = JSON.parse(e.target.result);
        const database = await db.init();
        
        const restoredCards = await Promise.all(rawData.map(async (card) => {
          if (card.audio && Array.isArray(card.audio)) {
            card.audio = await Promise.all(card.audio.map(async (b64) => {
              if (!b64 || typeof b64 !== 'string') return null;
              const res = await fetch(b64);
              return await res.blob();
            }));
          }
          return card;
        }));

        const tx = database.transaction(['customCards'], 'readwrite');
        const store = tx.objectStore('customCards');
        
        restoredCards.forEach(c => store.put(c)); 
        
        tx.oncomplete = () => {
          alert(`Successfully restored ${restoredCards.length} cards.`);
          window.location.reload(); 
        };
      } catch (err) {
        alert("Failed to restore: Invalid JSON backup file.");
        importStep = 'choice';
      }
    };
    reader.readAsText(file);
  }

  // --- 2. OCR/FILE LOGIC ---
  onMount(async () => {
    if (browser) {
      try {
        const Tesseract = await import('tesseract.js');
        createWorker = Tesseract.createWorker;
        const pdfData = await import('pdfjs-dist');
        pdfjsLib = pdfData;
        const version = pdfjsLib.version || '5.5.207'; 
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
      } catch (e) {
        console.error("Library load error:", e);
        ocrStatus = "Security Block: Check Console";
      }
    }
  });

  onDestroy(async () => {
    if (activeWorker) await activeWorker.terminate();
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
      importPreview = [...importPreview]; 
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
    currentFile = file;
    importStep = 'processing';
    if (file.type === "application/pdf") {
      await processPDF(file);
    } else if (file.type.startsWith("image/")) {
      await processImage(file);
    } else {
      parseMode = null; 
      processTextFile(file);
    }
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

  async function forceOCR() {
    if (currentFile) {
        ocrStatus = "Force Switching to OCR...";
        await processPDF(currentFile, true);
    }
  }

  async function processPDF(file, skipNative = false) {
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
      let hasNativeText = false;

      if (!skipNative) {
        ocrStatus = "Checking PDF layer...";
        try {
          const maxPages = Math.min(pdf.numPages, 10);
          for (let i = 1; i <= maxPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await Promise.race([
              page.getTextContent(),
              new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 2000))
            ]);
            const pageText = textContent.items.map(item => item.str).join(' ');
            if (pageText.trim().length > 10) {
              hasNativeText = true;
              fullText += pageText + "\n";
            }
          }
        } catch (innerErr) {
          hasNativeText = false;
        }
      }

      if (!hasNativeText || skipNative) {
        ocrStatus = "OCR Engine Starting...";
        if (!activeWorker) {
          activeWorker = await createWorker('fra+eng', 1, {
            workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@v5.0.0/dist/worker.min.js',
            corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@v5.0.0/tesseract-core.wasm.js'
          });
        }
        fullText = ""; 
        for (let i = 1; i <= Math.min(pdf.numPages, 10); i++) {
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
    importPreview = importPreview.map(c => {
      if (c.tempId === tempId) {
        const hasTag = c.tags.includes(tag);
        return { ...c, tags: hasTag ? c.tags.filter(t => t !== tag) : [...c.tags, tag] };
      }
      return c;
    });
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
      
      const existingFrench = new Set((allCards || []).map(c => c.french?.toLowerCase().trim()));
      let addedCount = 0;

      importPreview.forEach(card => {
        const cleanF = card.french?.toLowerCase().trim();
        if (cleanF && !existingFrench.has(cleanF)) {
          const finalTags = [...new Set([...card.tags, ...(globalTag ? [globalTag] : [])])];
          
          // The fix: Ensure 'id' is present because your DB keyPath requires it.
          store.add({ 
            id: crypto.randomUUID(), // This provides the missing value the error is complaining about
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
  {#if importStep === 'choice'}
    <div class="choice-container">
      <div class="choice-card" on:click={() => restoreInput.click()}>
        <span class="choice-icon">🔄</span>
        <h4>Restore Library</h4>
        <p>Import a <b>.json</b> backup file (includes audio and decks).</p>
        <input type="file" accept=".json" bind:this={restoreInput} on:change={handleRestoreJSON} hidden />
      </div>

      <div class="choice-divider">OR</div>

      <div class="choice-card" on:click={() => importStep = 'upload'}>
        <span class="choice-icon">📄</span>
        <h4>New Data Import</h4>
        <p>Convert <b>PDF, Photos, or CSV</b> into new study cards.</p>
      </div>
      
      <button class="btn-secondary full-width" on:click={onCancel}>Cancel</button>
    </div>

  {:else if importStep === 'upload'}
    <div class="upload-zone choice-card" on:click={() => fileInput.click()}>
      <span class="choice-icon">📁</span>
      <h4>Upload Document</h4>
      <p>Select a <b>CSV, TXT, PDF, or Image</b> to begin parsing.</p>
      <input type="file" accept=".csv,.txt,.pdf,image/*" bind:this={fileInput} on:change={handleFileSelect} hidden />
      <button class="btn-swap-ghost" style="margin-top: 20px;" on:click|stopPropagation={() => importStep = 'choice'}>Back</button>
    </div>

  {:else if importStep === 'processing'}
    <div class="processing-zone">
      <div class="spinner"></div>
      <p>{ocrStatus || "Working..."}</p>
      <div style="display: flex; gap: 10px; justify-content: center; margin-top: 15px;">
        <button class="btn-swap-ghost" on:click={() => importStep = 'choice'}>Cancel</button>
        {#if ocrStatus.includes("Checking PDF") || ocrStatus.includes("Reading")}
            <button class="btn-swap-ghost" on:click={forceOCR} style="border-color: #f59e0b; color: #f59e0b;">Skip to OCR</button>
        {/if}
      </div>
    </div>

  {:else}
    <div class="import-refine">
      <div class="settings-grid">
        <div class="header-row">
          <span class="small-label">Items: {importPreview.length}</span>
          <div style="display: flex; gap: 8px;">
            <button class="btn-swap-ghost" on:click={translateAll}>🌐 Auto-Translate</button>
            <button class="btn-swap-ghost" on:click={() => { swapColumns = !swapColumns; createPreviewFromLines(importPreview.map(p => `${p.french},${p.english}`), false); }}>🔄 Swap Columns</button>
          </div>
        </div>

        {#if parseMode !== null}
          <div class="mode-toggle-row" style="display: flex; gap: 5px; margin-bottom: 10px;">
             <button class="btn-swap-ghost {parseMode === 'words' ? 'active' : ''}" on:click={() => toggleParseMode('words')}>Words</button>
             <button class="btn-swap-ghost {parseMode === 'sentences' ? 'active' : ''}" on:click={() => toggleParseMode('sentences')}>Sentences</button>
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
            <button class="btn-del-top" on:click={() => importPreview = importPreview.filter(p => p.tempId !== card.tempId)}>✕</button>
            <div class="row-inputs">
              <div class="flex-row"><input class="f-input" bind:value={card.french} /><button class="mini-btn" on:click={() => translateRow(i)}>🌐</button></div>
              <input class="e-input" bind:value={card.english} />
              <div class="row-tags">
                {#each TAG_PRESETS as tag}
                  {@const isActive = card.tags.includes(tag) || globalTag === tag}
                  <button class="tag-chip {isActive ? 'active' : ''}" 
                          style="{isActive ? `background: ${getTagColor(tag)}; color: #0f172a;` : 'background: transparent; color: #8C9BAB; border: 1px solid #334155;'}" 
                          on:click={() => toggleImportTag(card.tempId, tag)} 
                          disabled={globalTag === tag}>{tag}</button>
                {/each}
              </div>
            </div>
          </div>
        {/each}
      </div>

      <div class="action-footer">
        <button class="btn-secondary" on:click={onCancel}>Cancel</button>
        <button class="btn-primary" on:click={finalImport}>Import All</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .manager-window { background: #0f172a; padding: 15px; border-radius: 12px; color: white; overflow-y: auto; }
  .custom-scrollbar { scrollbar-width: thin; scrollbar-color: #334155 #0f172a; }
  .custom-scrollbar::-webkit-scrollbar { width: 8px; }
  .custom-scrollbar::-webkit-scrollbar-track { background: #0f172a; border-radius: 10px; }
  .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; border: 2px solid #0f172a; }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #475569; }
  .choice-container { display: flex; flex-direction: column; gap: 15px; }
  .choice-card { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); padding: 20px; border-radius: 16px; text-align: center; cursor: pointer; transition: 0.2s; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .choice-card:hover { background: rgba(45, 212, 191, 0.1); border-color: #2dd4bf; transform: translateY(-2px); }
  .choice-icon { font-size: 2rem; display: block; margin-bottom: 10px; }
  .choice-card h4 { margin: 0 0 5px 0; color: white; }
  .choice-card p { margin: 0; font-size: 0.9rem; color: #8C9BAB; }
  .choice-divider { text-align: center; font-size: 0.7rem; color: #475569; letter-spacing: 2px; margin: 5px 0; }
  .upload-zone { border: 2px dashed rgba(255, 255, 255, 0.1); padding: 40px; }
  .processing-zone { padding: 40px; text-align: center; background: rgba(30, 41, 59, 0.5); border-radius: 12px; }
  .settings-grid { background: #1e293b; padding: 10px; border-radius: 8px; margin-bottom: 10px; }
  .header-row, .deck-selector { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 8px; align-items: center; }
  .global-tag-select { flex: 1; background: #1e293b; border: 1px solid #334155; border-radius: 4px; padding: 5px; }
  .global-tag-row { display: flex; align-items: center; gap: 10px; margin-top: 5px; }
  .btn-swap-ghost { background: transparent; border: 1px solid rgba(45, 212, 191, 0.3); color: rgba(45, 212, 191, 0.8); padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; cursor: pointer; }
  .btn-swap-ghost.active { background: rgba(45, 212, 191, 0.2); border-color: #2dd4bf; }
  .deck-selector input, .deck-selector select { flex: 1; background: #0f172a; border: 1px solid #334155; color: white; padding: 5px; border-radius: 4px; }
  .import-list { max-height: 350px; overflow-y: auto; }
  .import-row { background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; margin-bottom: 8px; position: relative; display: flex; gap: 10px; }
  .btn-del-top { position: absolute; top: 8px; right: 8px; background: transparent; border: none; color: #ef4444; cursor: pointer; }
  .row-inputs { flex: 1; display: flex; flex-direction: column; gap: 4px; }
  .flex-row { display: flex; gap: 5px; width: 90%; }
  .f-input { flex: 1; background: transparent; border: none; color: #2dd4bf; border-bottom: 1px solid #334155; }
  .e-input { background: transparent; border: none; color: #8C9BAB; width: 90%; }
  .tag-chip { font-size: 0.6rem; padding: 2px 6px; border-radius: 4px; cursor: pointer; }
  .btn-primary { background: #2dd4bf; color: #0f172a; border: none; padding: 10px; border-radius: 8px; font-weight: bold; flex: 2; cursor: pointer; }
  .btn-secondary { background: #334155; color: white; border: none; padding: 10px; border-radius: 8px; flex: 1; cursor: pointer; }
  .full-width { width: 100%; margin-top: 10px; }
  .action-footer { display: flex; gap: 10px; margin-top: 10px; }
  .mini-btn { background: transparent; border: 1px solid #334155; border-radius: 4px; cursor: pointer; padding: 2px 4px; color: white; transition: 0.2s; }
  .mini-btn:hover { border-color: #2dd4bf; }
  .spinner { width: 30px; height: 30px; border: 3px solid #2dd4bf; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 15px; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>