<script>
  
  // Props passed from Settings.svelte
  let { allCards, usedDecks = [], onCancel } = $props();

  let isProcessing = $state(false);
  
  let exportFormat = $state('csv'); // 'json', 'csv'
  let exportScope = $state('all');        // 'all', 'decks'
  let selectedDecks = $state(new Set());
  let canvasRef = $state();

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
    }, 50);
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text);
    alert('Copied!');
  }
</script>

<div class="manager-window">
  <div class="header">
    <h3 class="title">Export & Backup</h3>
    <button class="btn-close" onclick={onCancel}>×</button>
  </div>

    <div class="intro">
      <div class="config-section">
        <label for="format-select">Format</label>
        <div class="toggle-row">
          <button id="format-select" class="toggle-btn {exportFormat === 'csv' ? 'active' : ''}" onclick={() => exportFormat = 'csv'}>CSV</button>
          <button class="toggle-btn {exportFormat === 'json' ? 'active' : ''}" onclick={() => exportFormat = 'json'}>JSON</button>
        </div>

        <label for="scope-select">Scope</label>
        <div class="toggle-row">
          <button id="scope-select" class="toggle-btn {exportScope === 'all' ? 'active' : ''}" onclick={() => exportScope = 'all'}>All Cards</button>
          <button class="toggle-btn {exportScope === 'decks' ? 'active' : ''}" onclick={() => exportScope = 'decks'}>Select Decks</button>
        </div>

        {#if exportScope === 'decks'}
          <div id="deck-selection" class="deck-list custom-scrollbar">
            {#each usedDecks as deck}
              <button 
                class="deck-option {selectedDecks.has(deck) ? 'selected' : ''}" 
                onclick={() => toggleDeckSelection(deck)}
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
        {exportFormat === 'csv' ? 'Creates a spreadsheet compatible with Excel/Google Sheets.' : 'Creates a raw data file for developers or backup.'}
      </p>

      <button class="btn-primary" disabled={isProcessing} onclick={performExport}>
        {isProcessing ? 'Processing...' : 'Download File'}
      </button>
    </div>
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

</style>
