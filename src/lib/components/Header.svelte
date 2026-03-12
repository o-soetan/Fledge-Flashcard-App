<script>
  import { onMount } from 'svelte';
  import { db } from '$lib/db';
  export let onNavigate;

  let english = '';
  let french = '';
  let pronunciation = ''; 
  let notes = ''; 
  let selectedTags = [];  
  let customCards = []; 

  let selectedDeck = 'General'; 
  let userDecks = ['General'];   
  let newDeckName = '';
  let showDeckInput = false;

  // Preset list - removed duplicates for safety
  const TAG_PRESETS = [
    "NOUN", "VER", "ADJ", "ADV", "PRE", "CONJ", 
    "PRO", "DET", "AUX", "INT", "Masculine", "Feminine"
  ];
  
  const tagColors = {
    'NOUN': '#FFD700',
    'VER': '#FF6B6B',
    'ADJ': '#4D96FF',
    'ADV': '#937DC2',
    'PRE': '#6BCB77',
    'CONJ': '#FF9F45',
    'Masculine': '#3AB4F2',
    'Feminine': '#F07DEA'
  };

  let customTags = []; 
  let newTagName = "";
  let showTagInput = false;

  // Ensure no duplicates in the display list
  $: allAvailableTags = [...new Set([...TAG_PRESETS, ...customTags])];

  // AUTOMATIC GENDER TAGGER (Custom Instruction)
  $: {
    const lowerFrench = french.trim().toLowerCase();
    if (lowerFrench.startsWith('le ')) {
      if (!selectedTags.includes('Masculine')) {
        selectedTags = [...selectedTags.filter(t => t !== 'Feminine'), 'Masculine'];
      }
    } else if (lowerFrench.startsWith('la ')) {
      if (!selectedTags.includes('Feminine')) {
        selectedTags = [...selectedTags.filter(t => t !== 'Masculine'), 'Feminine'];
      }
    }
  }

  async function loadData() {
    const database = await db.init();
    const transaction = database.transaction(['customCards'], 'readonly');
    const store = transaction.objectStore('customCards');
    const request = store.getAll();
    
    request.onsuccess = () => {
      customCards = request.result;
      const existingDecks = [...new Set(customCards.map(c => c.deck || 'General'))];
      userDecks = existingDecks.length > 0 ? existingDecks : ['General'];
    };
  }

  function toggleTag(tag) {
    if (selectedTags.includes(tag)) {
      selectedTags = selectedTags.filter(t => t !== tag);
    } else {
      selectedTags = [...selectedTags, tag];
    }
  }

  function addNewDeck() {
    if (newDeckName.trim() && !userDecks.includes(newDeckName.trim())) {
      userDecks = [...userDecks, newDeckName.trim()];
      selectedDeck = newDeckName.trim(); 
      newDeckName = '';
      showDeckInput = false;
    }
  }

  function addCustomTag() {
    const trimmed = newTagName.trim().toUpperCase();
    if (trimmed && !allAvailableTags.includes(trimmed)) {
      customTags = [...customTags, trimmed];
      selectedTags = [...selectedTags, trimmed]; 
      newTagName = "";
      showTagInput = false;
    } else {
      showTagInput = false;
    }
  }

  async function handleAddWord() {
    if (!english || !french) return;
    
    const newCard = {
      id: crypto.randomUUID(),
      english: english.trim(),
      french: french.trim(),
      pronunciation: pronunciation.trim(),
      notes: notes.trim(), 
      tags: selectedTags,
      deck: selectedDeck || 'General',
      createdAt: new Date().toISOString()
    };

    await db.addCard(newCard);
    onNavigate('dashboard');
  }

  onMount(loadData);
</script>

<div class="add-card-container">
  <div class="header-row">
    <button class="btn-exit-screenshot" on:click={() => onNavigate('dashboard')}>
      ←
    </button>
    <h2 class="title">Add New Card</h2>
  </div>

  <div class="add-card-form">
    <div class="input-group">
      <label>English (Front)</label>
      <input bind:value={english} placeholder="e.g. Bread" />
    </div>

    <div class="input-group">
      <label>French (Back)</label>
      <input bind:value={french} placeholder="e.g. le pain" />
    </div>

    <div class="input-group">
      <label>Select Deck</label>
      <div class="chip-container">
        {#each userDecks as deck}
          <button 
            type="button" 
            class="chip {selectedDeck === deck ? 'active' : ''}"
            on:click={() => selectedDeck = deck}>
            {deck}
          </button>
        {/each}
        
        {#if !showDeckInput}
          <button class="btn-outline small-outline" on:click={() => showDeckInput = true}>+ New Deck</button>
        {:else}
          <div class="inline-input">
            <input bind:value={newDeckName} placeholder="Name..." />
            <button on:click={addNewDeck}>Add</button>
          </div>
        {/if}
      </div>
    </div>

    <div class="input-group">
      <label>Pronunciation</label>
      <input bind:value={pronunciation} placeholder="How it sounds..." />
    </div>

    <div class="input-group">
      <label>Notes</label>
      <textarea bind:value={notes} placeholder="Context or examples..." class="custom-textarea"></textarea>
    </div>

    <label class="label-small">Tags</label>
    <div class="chip-container">
      {#each allAvailableTags as tag}
        {@const isActive = selectedTags.includes(tag)}
        <button 
          type="button"
          on:click={() => toggleTag(tag)}
          class="tag-chip {isActive ? 'active' : ''}"
          style="--tag-color: {tagColors[tag] || '#2dd4bf'}">
          {tag}
        </button>
      {/each}

      {#if !showTagInput}
        <button 
          type="button"
          class="tag-chip btn-custom-toggle" 
          on:click={() => showTagInput = true}>
          + CUSTOM
        </button>
      {:else}
        <div class="tag-input-wrapper">
          <input 
            bind:value={newTagName} 
            placeholder="NAME..." 
            on:keydown={(e) => e.key === 'Enter' && addCustomTag()}
            on:blur={() => !newTagName && (showTagInput = false)}
            autoFocus
          />
          <button type="button" class="btn-confirm-tag" on:click={addCustomTag}>OK</button>
        </div>
      {/if}
    </div>

    <button class="btn-save" on:click={handleAddWord}>
      Save Card
    </button>
  </div>
</div>

<style>
  .add-card-container { max-width: 500px; margin: 0 auto; padding: 10px; }
  
  .header-row { 
    display: flex; 
    align-items: center; 
    gap: 20px;
    margin-bottom: 25px; 
    padding: 0 5px;
  }

  .title { margin: 0; font-size: 1.4rem; font-weight: 800; color: white; }

  .btn-exit-screenshot {
    width: 48px; height: 48px; border-radius: 14px;
    background: rgba(255, 255, 255, 0.05); backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.1); color: #8C9BAB;
    font-size: 1.5rem; display: flex; align-items: center; justify-content: center;
    cursor: pointer; transition: all 0.2s; flex-shrink: 0;
  }

  .add-card-form {
    background: var(--dark-navy, #0f172a); 
    padding: 24px; border-radius: 24px;
    border: 1px solid rgba(255,255,255,0.08); text-align: left;
  }

  .input-group { margin-bottom: 20px; }
  .input-group label { display:block; color:#8C9BAB; font-size:0.8rem; margin-bottom:6px; font-weight: 600; }
  
  input, .custom-textarea {
    width: 100%; background: #070b14; border: 1px solid rgba(255, 255, 255, 0.1);
    color: white; padding: 14px; border-radius: 12px; box-sizing: border-box; outline: none;
  }
  
  .custom-textarea { height: 80px; resize: none; font-family: inherit; }
  
  .chip-container { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; align-items: center; }
  
  .chip {
    background: rgba(255,255,255,0.05); color: #8C9BAB; border: 1px solid rgba(255,255,255,0.1);
    padding: 8px 14px; border-radius: 12px; cursor: pointer; font-size: 0.8rem; transition: all 0.2s;
  }
  .chip.active { background: var(--vibrant-teal, #2dd4bf); color: #0f172a; border-color: var(--vibrant-teal); font-weight: 600; }

  /* Tags */
  .tag-chip {
    background: rgba(255,255,255,0.03); color: #475569; 
    border: 1px solid rgba(255,255,255,0.08);
    padding: 4px 10px; border-radius: 8px; cursor: pointer; 
    font-size: 0.65rem; font-weight: 700; transition: all 0.2s;
    text-transform: uppercase;
  }

  .tag-chip.active {
    background: rgba(0,0,0,0.3); border-color: var(--tag-color);
    color: var(--tag-color); box-shadow: 0 0 10px rgba(0,0,0,0.2);
  }

  .btn-custom-toggle {
    border: 1px dashed var(--vibrant-teal);
    color: var(--vibrant-teal);
    background: transparent;
  }

  .tag-input-wrapper {
    display: flex;
    align-items: center;
    background: #070b14;
    border: 1px solid var(--vibrant-teal);
    border-radius: 8px;
    padding: 2px 4px;
    height: 26px;
  }

  .tag-input-wrapper input {
    border: none; background: transparent; color: white;
    font-size: 0.65rem; padding: 0 4px; width: 60px; height: 100%; font-weight: 700;
  }

  .btn-confirm-tag {
    background: var(--vibrant-teal); border: none; color: #0f172a;
    font-size: 0.6rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; cursor: pointer;
  }

  .btn-outline { 
    background: none; border: 1px dashed var(--vibrant-teal); color: var(--vibrant-teal); 
    padding: 8px 14px; border-radius: 12px; cursor: pointer; font-size: 0.8rem;
  }

  .small-outline { padding: 4px 10px; font-size: 0.65rem; border-radius: 8px; }
  
  .inline-input { display: flex; gap: 8px; width: 100%; margin-top: 5px; }
  .inline-input input { padding: 8px; font-size: 0.8rem; }
  .inline-input button { background: var(--vibrant-teal); border: none; border-radius: 8px; padding: 0 15px; cursor: pointer; font-weight: 700; color: #0f172a; }
  
  .btn-save {
    background-color: var(--vibrant-teal); color: #0f172a;
    padding: 16px; border-radius: 16px; font-weight: 800;
    width: 100%; border: none; cursor: pointer; margin-top: 10px;
    font-size: 1rem; text-transform: uppercase; letter-spacing: 1px;
  }
</style>