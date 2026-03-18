<script>
  import { generatePassphrase, encryptData } from '$lib/crypto';
  import QRCode from 'qrcode';
  
  // Props passed from Settings.svelte
  let { allCards, usedDecks = [], onCancel } = $props();

  let generatedPassphrase = $state('');
  let encryptedBlob = $state('');
  let isProcessing = $state(false);
  let showQR = $state(false);
  
  let exportFormat = $state('encrypted'); // 'encrypted', 'json', 'csv'
  let exportScope = $state('all');        // 'all', 'decks'
  let selectedDecks = $state(new Set());
  let canvasRef;

  function toggleDeckSelection(deck) {
    const next = new Set(selectedDecks);
    if (next.has(deck)) next.delete(deck);
    else next.add(deck);
    selectedDecks = next;
  }

  function convertToCSV(cards) {
    const headers = ['english', 'french', 'pronunciation', 'deck', 'tags', 'notes', 'id', 'created'];
    const rows = cards.map(c => {
      return headers.map(h => {
        let val = c[h] || '';
        if (Array.isArray(val)) val = val.join(';');
        // Escape quotes by doubling them, wrap field in quotes to handle commas/newlines
        val = String(val).replace(/"/g, '""');
        return `"${val}"`;
      }).join(',');
    });
    return [headers.join(','), ...rows].join('\n');
  }

  function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function performExport() {
    if (exportScope === 'decks' && selectedDecks.size === 0) {
      alert("Please select at least one deck.");
      return;
    }

    isProcessing = true;
    
    const cardsToExport = exportScope === 'all' 
      ? allCards 
      : allCards.filter(c => selectedDecks.has(c.deck));

    setTimeout(async () => {
      if (exportFormat === 'encrypted') {
        try {
          generatedPassphrase = generatePassphrase(4);
          const rawData = await encryptData(cardsToExport, generatedPassphrase);
          
          const res = await fetch('/api/locker', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ encryptedData: rawData })
          });
          
          if (!res.ok) throw new Error('Upload failed');
          
          const { lockerId } = await res.json();
          encryptedBlob = `${window.location.origin}/restore?id=${lockerId}&key=${generatedPassphrase}`;
          
          isProcessing = false;
          if (!showQR) toggleQR();
        } catch (e) {
          console.error(e);
          alert("Backup failed: " + e.message);
          isProcessing = false;
        }
      } else {
        try {
          const timestamp = new Date().toISOString().slice(0,10);
          if (exportFormat === 'json') {
            const jsonStr = JSON.stringify(cardsToExport, null, 2);
            downloadFile(jsonStr, `fledge_backup_${timestamp}.json`, 'application/json');
          } else if (exportFormat === 'csv') {
            const csvStr = convertToCSV(cardsToExport);
            downloadFile(csvStr, `fledge_export_${timestamp}.csv`, 'text/csv');
          }
          onCancel(); // Close window after download
        } catch (e) {
          console.error(e);
          alert("Export failed.");
          isProcessing = false;
        }
      }
    }, 50);
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text);
    alert('Copied!');
  }

  async function toggleQR() {
    showQR = !showQR;
    if (showQR) {
      // Wait for DOM update so canvasRef is available
      setTimeout(async () => {
        if (!canvasRef) return;
        try {
          // Render the QR code to the canvas element
          await QRCode.toCanvas(canvasRef, encryptedBlob, { width: 220, margin: 2, color: { dark: '#ffffff', light: '#0f172a' } });
        } catch (e) {
          alert("Data is too large for a QR Code. Please use the text copy method instead.");
          showQR = false;
        }
      }, 50);
    }
  }
</script>

<div class="manager-window">
  <div class="header">
    <h3 class="title">Export & Backup</h3>
    <button class="btn-close" on:click={onCancel}>×</button>
  </div>

  {#if !encryptedBlob}
    <div class="intro">
      <div class="config-section">
        <label>Format</label>
        <div class="toggle-row">
          <button class="toggle-btn {exportFormat === 'encrypted' ? 'active' : ''}" on:click={() => exportFormat = 'encrypted'}>Encrypted</button>
          <button class="toggle-btn {exportFormat === 'csv' ? 'active' : ''}" on:click={() => exportFormat = 'csv'}>CSV</button>
          <button class="toggle-btn {exportFormat === 'json' ? 'active' : ''}" on:click={() => exportFormat = 'json'}>JSON</button>
        </div>

        <label>Scope</label>
        <div class="toggle-row">
          <button class="toggle-btn {exportScope === 'all' ? 'active' : ''}" on:click={() => exportScope = 'all'}>All Cards</button>
          <button class="toggle-btn {exportScope === 'decks' ? 'active' : ''}" on:click={() => exportScope = 'decks'}>Select Decks</button>
        </div>

        {#if exportScope === 'decks'}
          <div class="deck-list custom-scrollbar">
            {#each usedDecks as deck}
              <button 
                class="deck-option {selectedDecks.has(deck) ? 'selected' : ''}" 
                on:click={() => toggleDeckSelection(deck)}
              >
                <span class="checkbox">{selectedDecks.has(deck) ? '✓' : ''}</span>
                {deck}
              </button>
            {/each}
            {#if usedDecks.length === 0}
              <p class="empty-msg">No decks found.</p>
            {/if}
          </div>
        {/if}
      </div>

      <p class="info-text">
        {exportFormat === 'encrypted' ? 'Creates a secure code to restore on another Fledge device.' : 
         exportFormat === 'csv' ? 'Creates a spreadsheet compatible with Excel/Google Sheets.' : 'Creates a raw data file for developers or backup.'}
      </p>

      <button class="btn-primary" disabled={isProcessing} on:click={performExport}>
        {isProcessing ? 'Processing...' : (exportFormat === 'encrypted' ? 'Generate Backup' : 'Download File')}
      </button>
    </div>
  {:else}
    <div class="result-section">
      <div class="step">
        <label>1. Save this Passphrase</label>
        <div class="code-box">
          <code>{generatedPassphrase}</code>
          <button class="btn-copy" on:click={() => copyToClipboard(generatedPassphrase)}>Copy</button>
        </div>
        <p class="warning">You cannot restore your data without this!</p>
      </div>

      <div class="step">
        <label>2. Scan or Copy Recovery Link</label>
        <textarea readonly value={encryptedBlob} rows="5"></textarea>
        <div class="action-row">
          <button class="btn-copy-lg" on:click={() => copyToClipboard(encryptedBlob)}>Copy Link</button>
          <button class="btn-icon" on:click={toggleQR} title="Show QR Code">
            {showQR ? 'Hide' : '📱 QR'}
          </button>
        </div>
        {#if showQR}
          <div class="qr-box">
            <canvas bind:this={canvasRef}></canvas>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .manager-window { background: #0f172a; border-radius: 16px; padding: 20px; border: 1px solid rgba(255,255,255,0.05); color: white; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .title { margin: 0; color: #a78bfa; text-transform: uppercase; font-size: 0.9rem; letter-spacing: 1px; }
  .btn-close { background: none; border: none; color: #8C9BAB; font-size: 1.5rem; cursor: pointer; }
  
  .config-section { margin-bottom: 20px; }
  .toggle-row { display: flex; gap: 8px; margin-bottom: 15px; }
  .toggle-btn { flex: 1; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #8C9BAB; padding: 8px; border-radius: 8px; cursor: pointer; font-size: 0.8rem; font-weight: 600; }
  .toggle-btn.active { background: #a78bfa; color: #0f172a; border-color: #a78bfa; }

  .deck-list { max-height: 150px; overflow-y: auto; background: rgba(0,0,0,0.2); border-radius: 8px; padding: 5px; margin-bottom: 10px; border: 1px solid rgba(255,255,255,0.05); }
  .deck-option { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; background: transparent; border: none; color: #cbd5e1; padding: 8px; cursor: pointer; border-radius: 4px; }
  .deck-option:hover { background: rgba(255,255,255,0.05); }
  .deck-option.selected { color: #a78bfa; background: rgba(167, 139, 250, 0.1); }
  .checkbox { width: 16px; height: 16px; border: 1px solid #475569; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 900; }
  .deck-option.selected .checkbox { background: #a78bfa; border-color: #a78bfa; color: #0f172a; }
  .empty-msg { font-size: 0.8rem; color: #475569; text-align: center; padding: 10px; margin: 0; }

  .info-text { color: #8C9BAB; font-size: 0.8rem; line-height: 1.4; margin-bottom: 20px; font-style: italic; background: rgba(255,255,255,0.03); padding: 10px; border-radius: 8px; }
  .btn-primary { background: #a78bfa; color: #0f172a; border: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; cursor: pointer; width: 100%; font-size: 1rem; }
  .btn-primary:disabled { opacity: 0.7; cursor: wait; }

  .step { margin-bottom: 20px; }
  label { display: block; color: #2dd4bf; font-size: 0.8rem; font-weight: bold; margin-bottom: 8px; text-transform: uppercase; }
  .code-box { display: flex; justify-content: space-between; background: #000; padding: 12px; border-radius: 6px; align-items: center; border: 1px solid #334155; }
  code { color: #fff; font-family: monospace; font-size: 1.1rem; letter-spacing: 0.5px; }
  .btn-copy { background: #334155; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.8rem; }
  .warning { color: #ef4444; font-size: 0.8rem; margin-top: 6px; }

  textarea { width: 100%; background: #000; color: #8C9BAB; border: 1px solid #334155; padding: 10px; border-radius: 6px; font-family: monospace; font-size: 0.8rem; resize: none; margin-bottom: 8px; box-sizing: border-box; }
  .action-row { display: flex; gap: 8px; }
  .btn-copy-lg { flex: 1; background: #1e293b; color: white; border: 1px solid #334155; padding: 10px; border-radius: 6px; cursor: pointer; }
  .btn-copy-lg:hover { background: #334155; }
  .btn-icon { background: #1e293b; color: white; border: 1px solid #334155; padding: 0 15px; border-radius: 6px; cursor: pointer; font-size: 0.9rem; }
  .qr-box { margin-top: 15px; padding: 15px; border-radius: 8px; display: flex; justify-content: center; background: #0f172a; border: 1px solid #334155;}
  canvas { border-radius: 4px; }
</style>