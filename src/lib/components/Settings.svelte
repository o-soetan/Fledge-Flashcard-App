<script>
  import { onMount } from 'svelte';
  import { db } from '$lib/db';
  import ImportManager from './Import.svelte';
  import ExportManager from './Export.svelte';
  let { onNavigate } = $props();
  /** @type {any[]} */
  // --- Data State ---
  let allCards = $state([]);
  /** @type {any[]} */
  let usedTags = $state([]);
  let usedDecks = $state([]);
  
  // --- UI State ---
  let activeManager = $state(null); 
  let selectedItems = $state(new Set());
  let searchQuery = $state(""); // Fixed: Added $state for binding

  // --- Storage State ---
  let storageInfo = $state({ humanUsed: "0.00", percent: 0 });
  const APP_QUOTA_MB = 50; 

  const TAG_PRESETS = [
    "NOUN", "VERB", "ADJECTIVE", "ADVERB", "PREPOSITION", 
    "CONJUNCTION", "PRONOUN", "DETERMINER", "Masculine", "Feminine"
  ];

  const tagColors = {
    'NOUN': '#FFD700', 'VERB': '#FF6B6B', 'ADJECTIVE': '#4D96FF',
    'ADVERB': '#937DC2', 'PREPOSITION': '#6BCB77', 'CONJUNCTION': '#FF9F45',
    'PRONOUN': '#A5F3FC', 'DETERMINER': '#F472B6', 'Masculine': '#3AB4F2',
    'Feminine': '#F07DEA'
  };

  const getTagColor = (tag) => tagColors[tag] || '#2dd4bf';

  async function checkStorage() {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      const usedMB = (estimate.usage / (1024 * 1024)).toFixed(2);
      const percent = Math.min(Math.round((parseFloat(usedMB) / APP_QUOTA_MB) * 100), 100);
      
      storageInfo = {
        humanUsed: usedMB,
        percent: percent > 0 ? percent : 1
      };
    }
    if (navigator.storage.persist) navigator.storage.persist();
  }

  async function loadData() {
    await checkStorage();
    const database = await db.init();
    const transaction = database.transaction(['customCards'], 'readonly');
    const store = transaction.objectStore('customCards');
    const request = store.getAll();

    request.onsuccess = () => {
      allCards = request.result;
      const tags = new Set(); 
      allCards.forEach(card => card.tags?.forEach(t => tags.add(t)));
      usedTags = Array.from(tags).sort();

      const decks = new Set();
      allCards.forEach(card => { if (card.deck) decks.add(card.deck); });
      usedDecks = Array.from(decks).sort();
    };
  }

  function handleBack() {
    if (activeManager) {
      activeManager = null;
      selectedItems.clear();
      selectedItems = selectedItems; 
      searchQuery = "";
    } else {
      onNavigate('dashboard');
    }
  }

  function toggleSelection(id) {
    if (selectedItems.has(id)) selectedItems.delete(id);
    else selectedItems.add(id);
    selectedItems = selectedItems; 
  }

  async function performDelete() {
    const items = Array.from(selectedItems);
    if (items.length === 0) return;
    
    let confirmMsg = `Delete ${items.length} items?`;
    if (activeManager === 'decks') confirmMsg = `WARNING: This deletes decks and all cards inside. Continue?`;
    if (!confirm(confirmMsg)) return;

    const database = await db.init();
    const transaction = database.transaction(['customCards'], 'readwrite');
    const store = transaction.objectStore('customCards');

    if (activeManager === 'cards') {
      items.forEach(id => store.delete(id));
    } 
    else if (activeManager === 'decks') {
      allCards.forEach(card => {
        if (items.includes(card.deck)) store.delete(card.id);
      });
    } 
    else if (activeManager === 'tags') {
      allCards.forEach(card => {
        if (card.tags?.some(t => items.includes(t))) {
          store.put({ ...card, tags: card.tags.filter(t => !items.includes(t)) });
        }
      });
    }

    transaction.oncomplete = () => {
      selectedItems.clear();
      selectedItems = selectedItems; 
      loadData();
    };
  }

  function handleImportComplete(count) {
    alert(`Successfully imported ${count} cards!`);
    activeManager = null;
    loadData();
  }

  // Derived logic for Svelte 5
  let filteredItems = $derived.by(() => {
    if (activeManager === 'cards') {
      return allCards.filter(c => 
        c.english.toLowerCase().includes(searchQuery.toLowerCase()) || 
        c.french.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    const list = activeManager === 'tags' ? usedTags : (activeManager === 'decks' ? usedDecks : []);
    return list.filter(i => i.toLowerCase().includes(searchQuery.toLowerCase()));
  });

  onMount(loadData);
</script>

<div class="settings-container">
  <div class="settings-header">
    <button class="btn-back" on:click={handleBack}>←</button>
    <h2 class="title">
      {#if activeManager === 'import'}Import Data
      {:else if activeManager === 'export'}Export Data
      {:else if activeManager}Manage {activeManager.charAt(0).toUpperCase() + activeManager.slice(1)}
      {:else}Settings{/if}
    </h2>
  </div>

  {#if !activeManager}
    <div class="storage-section">
      <div class="storage-header-row">
        <span class="storage-label">Local Storage</span>
        <span class="storage-stats">{storageInfo.humanUsed} / {APP_QUOTA_MB} MB</span>
      </div>
      <div class="progress-bg">
        <div class="progress-fill" style="width: {storageInfo.percent}%"></div>
      </div>
      <p class="section-desc">Fledge stores your library locally on this device.</p>
    </div>

    <div class="settings-section clickable-box" on:click={() => activeManager = 'cards'}>
      <h3 class="section-label">Card Management</h3>
      <p class="section-desc">Search, edit, or bulk delete individual cards.</p>
    </div>

    <div class="settings-section clickable-box" on:click={() => activeManager = 'decks'}>
      <h3 class="section-label">Deck Management</h3>
      <p class="section-desc">Delete entire decks and their contents.</p>
    </div>

    <div class="settings-section clickable-box" on:click={() => activeManager = 'tags'}>
      <h3 class="section-label">Tag Management</h3>
      <p class="section-desc">Clean up and remove tags globally.</p>
    </div>

    <div class="settings-divider">Data Tools</div>

    <div class="settings-section clickable-box import-box" on:click={() => activeManager = 'import'}>
      <h3 class="section-label" style="color: #60a5fa;">Import Data</h3>
      <p class="section-desc">Add cards from CSV/TXT with auto-tagging.</p>
    </div>

    <div class="settings-section clickable-box export-box" on:click={() => activeManager = 'export'}>
      <h3 class="section-label" style="color: #a78bfa;">Export Library</h3>
      <p class="section-desc">Download a CSV backup of your collection.</p>
    </div>

  {:else if activeManager === 'import'}
    <ImportManager 
      {allCards} 
      {usedDecks} 
      {TAG_PRESETS} 
      {getTagColor} 
      onComplete={handleImportComplete} 
      onCancel={() => activeManager = null}
    />
  {:else if activeManager === 'export'}
    <ExportManager 
      {allCards} 
      onCancel={() => activeManager = null}
    />
  {:else}
    <div class="manager-window">
      <div class="toolbar">
        <div class="search-container">
          <span class="search-icon">🔍</span>
          <input type="text" class="search-bar" placeholder="Search..." bind:value={searchQuery} />
        </div>
      </div>

      <div class="list-scroll">
        {#each filteredItems as item}
          {@const itemId = activeManager === 'cards' ? item.id : item}
          <div class="list-item {selectedItems.has(itemId) ? 'selected' : ''}" on:click={() => toggleSelection(itemId)}>
            <div class="checkbox-ui {selectedItems.has(itemId) ? 'checked' : ''}"></div>
            <div class="item-info">
              {#if activeManager === 'cards'}
                <span class="text-main-c">{item.english}</span>
                <span class="text-sub">{item.french}</span>
              {:else if activeManager === 'tags'}
                <span class="text-tag" style="color: {getTagColor(item)}">{item}</span>
              {:else}
                <span class="text-main-c">{item}</span>
                <span class="text-sub">{allCards.filter(c => c.deck === item).length} cards</span>
              {/if}
            </div>
          </div>
        {/each}
      </div>

      {#if selectedItems.size > 0}
        <div class="action-bar">
          <span class="selection-count">{selectedItems.size} selected</span>
          <button class="btn-delete-bulk" on:click={performDelete}>Delete Selected</button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .settings-container { max-width: 500px; margin: 0 auto; color: white; padding: 10px; }
  .settings-header { display: flex; align-items: center; gap: 15px; margin-bottom: 20px; }
  .btn-back { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #8C9BAB; padding: 8px 16px; border-radius: 12px; cursor: pointer; font-size: 1.2rem; }
  .title { margin: 0; font-size: 1.3rem; font-weight: 800; }

  .storage-section {
    padding: 18px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 16px;
    margin-bottom: 20px;
    border: 1px solid rgba(255, 255, 255, 0.05);
  }
  .storage-header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .storage-label { font-size: 0.7rem; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; }
  .storage-stats { font-size: 0.75rem; color: #2dd4bf; font-weight: 700; }
  .progress-bg { width: 100%; height: 6px; background: #0f172a; border-radius: 10px; overflow: hidden; margin-bottom: 8px; }
  .progress-fill { height: 100%; background: linear-gradient(90deg, #2dd4bf, #3AB4F2); border-radius: 10px; transition: width 0.5s ease-out; }

  .settings-section { background: #1e293b; border-radius: 16px; padding: 14px 18px; border: 1px solid rgba(255,255,255,0.08); margin-top: 10px; cursor: pointer; transition: all 0.2s; }
  .clickable-box:hover { background: #26334a; transform: translateY(-2px); }
  .settings-divider { font-size: 0.65rem; font-weight: 800; color: #475569; text-transform: uppercase; margin: 25px 0 10px 5px; letter-spacing: 1px; }
  .import-box { border-color: rgba(96, 165, 250, 0.3); }
  .export-box { border-color: rgba(167, 139, 250, 0.3); }
  .section-label { font-size: 0.8rem; color: #2dd4bf; text-transform: uppercase; margin: 0; font-weight: 800; }
  .section-desc { font-size: 0.75rem; color: #8C9BAB; line-height: 1.3; margin-top: 6px; }
  .manager-window { background: #0f172a; border-radius: 16px; padding: 15px; border: 1px solid rgba(255,255,255,0.05); }
  .toolbar { margin-bottom: 15px; }
  .search-container { position: relative; }
  .search-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); font-size: 0.8rem; opacity: 0.5; }
  .search-bar { width: 100%; background: #070b14; border: 1px solid #334155; padding: 10px 10px 10px 32px; border-radius: 10px; color: white; outline: none; font-size: 0.85rem; box-sizing: border-box; }
  .list-scroll { max-height: 450px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
  .list-item { display: flex; align-items: center; gap: 12px; padding: 12px; background: rgba(255,255,255,0.03); border-radius: 10px; cursor: pointer; border: 1px solid transparent; }
  .list-item.selected { background: rgba(45, 212, 191, 0.1); border-color: #2dd4bf; }
  .checkbox-ui { width: 18px; height: 18px; border: 2px solid #334155; border-radius: 4px; flex-shrink: 0; }
  .checkbox-ui.checked { background: #2dd4bf; border-color: #2dd4bf; position: relative; }
  .checkbox-ui.checked::after { content: '✓'; position: absolute; color: #0f172a; font-size: 12px; left: 2px; top: -2px; font-weight: 900; }
  .item-info { display: flex; flex-direction: column; }
  .text-main-c { font-weight: 600; font-size: 0.9rem; }
  .text-tag { font-weight: 800; font-size: 0.8rem; text-transform: uppercase; }
  .text-sub { font-size: 0.75rem; color: #8C9BAB; }
  .action-bar { margin-top: 15px; padding-top: 15px; border-top: 1px solid #334155; display: flex; justify-content: space-between; align-items: center; }
  .btn-delete-bulk { background: #ef4444; border: none; color: white; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 0.8rem; }
  .selection-count { font-size: 0.8rem; font-weight: 600; color: #2dd4bf; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; }
</style>