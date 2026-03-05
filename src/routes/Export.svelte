<script>
  import { db } from '$lib/db';
  export let allCards;
  export let onCancel;

  // 1. Get unique decks and counts
  $: deckStats = allCards.reduce((acc, card) => {
    const deck = card.deck || "General";
    acc[deck] = (acc[deck] || 0) + 1;
    return acc;
  }, {});

  $: availableDecks = Object.keys(deckStats).sort();

  // 2. Selection State
  let selectedDecks = new Set();
  let selectAll = false;
  let isExporting = false;

  function toggleAll() {
    selectAll = !selectAll;
    selectedDecks = selectAll ? new Set(availableDecks) : new Set();
    selectedDecks = selectedDecks;
  }

  function toggleDeck(deck) {
    if (selectedDecks.has(deck)) {
      selectedDecks.delete(deck);
      selectAll = false;
    } else {
      selectedDecks.add(deck);
      if (selectedDecks.size === availableDecks.length) selectAll = true;
    }
    selectedDecks = selectedDecks;
  }

  // 3. AUDIO-READY EXPORT LOGIC
  async function triggerDownload() {
    const decksToExport = Array.from(selectedDecks);
    if (decksToExport.length === 0) {
      alert("Please select at least one deck to export.");
      return;
    }

    isExporting = true;

    // Filter cards based on user selection
    const cardsToExport = allCards.filter(c => 
      decksToExport.includes(c.deck || "General")
    );

    // Convert Blobs to Base64 strings for JSON compatibility
    const processedCards = await Promise.all(cardsToExport.map(async (card) => {
      // Create a shallow copy to avoid mutating the original app state
      const cardCopy = { ...card };

      if (card.audio && Array.isArray(card.audio)) {
        cardCopy.audio = await Promise.all(card.audio.map(async (item) => {
          if (!item || !(item instanceof Blob)) return null;

          return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result); // Base64 string
            reader.readAsDataURL(item);
          });
        }));
      }
      return cardCopy;
    }));

    // Generate JSON File
    const jsonString = JSON.stringify(processedCards, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.href = url;
    link.download = `french_app_backup_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(link);
    link.click();
    
    // Cleanup
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    isExporting = false;
  }
</script>

<div class="manager-window">
  <div class="export-header">
    <span class="export-icon-large">📤</span>
    <h3>Backup Library</h3>
    <p>Your audio and card data will be bundled into a single JSON file.</p>
  </div>

  <div class="export-selection-area">
    <div class="selection-controls">
      <span class="summary-label">Select Decks</span>
      <button class="btn-text-only" on:click={toggleAll}>
        {selectAll ? 'Deselect All' : 'Select All'}
      </button>
    </div>

    <div class="stats-list">
      {#each availableDecks as name}
        <div class="stat-item {selectedDecks.has(name) ? 'active' : ''}" on:click={() => toggleDeck(name)}>
          <div class="check-box {selectedDecks.has(name) ? 'checked' : ''}"></div>
          <span class="deck-name">{name}</span>
          <span class="deck-count">{deckStats[name]} cards</span>
        </div>
      {/each}
    </div>
  </div>

  <div class="action-bar-export">
    <button class="btn-cancel" on:click={onCancel}>Cancel</button>
    <button 
      class="btn-confirm-export" 
      disabled={selectedDecks.size === 0 || isExporting} 
      on:click={triggerDownload}
    >
      {isExporting ? 'Packaging Audio...' : `Export ${selectedDecks.size} Deck(s)`}
    </button>
  </div>
</div>

<style>
  /* Styles remain consistent with your current UI */
  .export-header { text-align: center; padding: 15px 0; }
  .export-icon-large { font-size: 2.5rem; display: block; margin-bottom: 8px; }
  .export-header h3 { margin: 0; color: #a78bfa; font-weight: 800; }
  .export-header p { font-size: 0.75rem; color: #8C9BAB; margin-top: 4px; }

  .export-selection-area { 
    background: rgba(255, 255, 255, 0.03); 
    border: 1px solid rgba(255, 255, 255, 0.05); 
    border-radius: 12px; 
    padding: 15px; 
    margin: 15px 0; 
  }

  .selection-controls { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .summary-label { font-size: 0.65rem; font-weight: 800; color: #a78bfa; text-transform: uppercase; }
  .btn-text-only { background: none; border: none; color: #60a5fa; font-size: 0.65rem; font-weight: 800; cursor: pointer; text-transform: uppercase; }
  
  .stats-list { max-height: 250px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
  
  .stat-item { 
    display: flex; 
    align-items: center; 
    gap: 12px; 
    padding: 10px; 
    background: rgba(255,255,255,0.02); 
    border-radius: 8px; 
    cursor: pointer; 
    border: 1px solid transparent;
    transition: all 0.2s;
  }
  .stat-item.active { background: rgba(167, 139, 250, 0.08); border-color: rgba(167, 139, 250, 0.3); }

  .check-box { width: 16px; height: 16px; border: 2px solid #334155; border-radius: 4px; flex-shrink: 0; }
  .check-box.checked { background: #a78bfa; border-color: #a78bfa; position: relative; }
  .check-box.checked::after { content: '✓'; position: absolute; color: #1e1b4b; font-size: 11px; left: 2px; top: -2px; font-weight: 900; }

  .deck-name { font-weight: 600; font-size: 0.85rem; flex: 1; color: white; }
  .deck-count { color: #8C9BAB; font-size: 0.75rem; }

  .action-bar-export { display: flex; gap: 10px; margin-top: 10px; }
  .btn-confirm-export { flex: 2; background: #a78bfa; color: #1e1b4b; border: none; padding: 12px; border-radius: 10px; font-weight: 800; cursor: pointer; }
  .btn-confirm-export:disabled { opacity: 0.3; cursor: not-allowed; }
  .btn-cancel { flex: 1; background: #334155; color: white; border: none; border-radius: 10px; cursor: pointer; }

  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; }
</style>