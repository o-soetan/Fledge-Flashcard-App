<script>
  import { onMount } from 'svelte';
  import { db } from '$lib/db.js';
  import AudioRecorder from './AudioRecorder.svelte'; 
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

  // --- AUDIO STATE ---
  let cardAudio = [null, null, null];
  let audioUploadInput;
  let uploadStatus = ""; 
  const MAX_FILE_SIZE_MB = 1; // Optimized limit for performance

  const TAG_PRESETS = [
    "NOUN", "VERB", "ADJECTIVE", "ADVERB", "PREPOSITION", "CONJUNCTION", 
    "PRONOUN", "DETERMINER", "AUXILIARY", "INTERJECTION", "Masculine", "Feminine"
  ];
  
  const tagColors = {
    'NOUN': '#FFD700', 'VERB': '#FF6B6B', 'ADJECTIVE': '#4D96FF',
    'ADVERB': '#937DC2', 'PREPOSITION': '#6BCB77', 'CONJUNCTION': '#FF9F45',
    'PRONOUN': '#A5F3FC', 'DETERMINER': '#F472B6', 'Masculine': '#3AB4F2',
    'Feminine': '#F07DEA'
  };

  let customTags = []; 
  let newTagName = "";
  let showTagInput = false;

  $: allAvailableTags = [...TAG_PRESETS, ...customTags];
  $: filledSlots = cardAudio.filter(slot => slot !== null).length;

  // PERSONALIZATION: AUTOMATIC GENDER TAGGER
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

  // --- AUDIO LOGIC ---
  function handleAudioFile(event) {
    const file = event.target.files[0];
    uploadStatus = "";
    if (!file) return;

    // Type Check
    if (!file.type.startsWith('audio/')) {
      alert("Please upload a valid audio file.");
      return;
    }

    // Size Check (1MB)
    const fileSizeMB = file.size / (1024 * 1024);
    if (fileSizeMB > MAX_FILE_SIZE_MB) {
      alert(`File too large! (${fileSizeMB.toFixed(2)}MB). Max limit is 1MB for performance.`);
      return;
    }

    const firstEmptyIndex = cardAudio.findIndex(slot => slot === null);
    if (firstEmptyIndex !== -1) {
      cardAudio[firstEmptyIndex] = file;
      cardAudio = [...cardAudio];
      uploadStatus = "✅ Added";
      setTimeout(() => { uploadStatus = ""; }, 2000);
    } else {
      alert("All 3 audio slots are full.");
    }
    event.target.value = '';
  }

  function clearAllAudio() {
    if (confirm("Remove all 3 audio clips?")) {
      cardAudio = [null, null, null];
      uploadStatus = "🗑️ Cleared";
      setTimeout(() => { uploadStatus = ""; }, 2000);
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
      const foundTags = new Set();
      customCards.forEach(card => {
        if (card.tags) {
          card.tags.forEach(t => { if (!TAG_PRESETS.includes(t)) foundTags.add(t); });
        }
      });
      customTags = Array.from(foundTags);
    };
  }

  function toggleTag(tag) {
    selectedTags = selectedTags.includes(tag) 
      ? selectedTags.filter(t => t !== tag) 
      : [...selectedTags, tag];
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
      audio: cardAudio, 
      createdAt: new Date().toISOString(),
      updatedAt: Date.now()
    };
    await db.addCard(newCard);
    onNavigate('dashboard');
  }

  onMount(loadData);
</script>

<div class="add-card-container">
  <div class="header-row">
    <button class="btn-exit-screenshot" on:click={() => onNavigate('dashboard')}>←</button>
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

    <div class="audio-section-header">
      <label class="label-small">
        Audio ({filledSlots}/3)
        {#if uploadStatus}<span class="upload-feedback">{uploadStatus}</span>{/if}
      </label>
      <div class="audio-actions">
        {#if filledSlots > 0}
          <button type="button" class="btn-clear-audio" on:click={clearAllAudio}>🗑️ Clear</button>
        {/if}
        <button 
          type="button"
          class="btn-upload-audio" 
          on:click={() => audioUploadInput.click()}
          disabled={filledSlots >= 3}
        >
          📁 Upload
        </button>
      </div>
      <input type="file" accept="audio/*" bind:this={audioUploadInput} on:change={handleAudioFile} hidden />
    </div>

    <AudioRecorder 
      audioSlots={cardAudio} 
      onUpdate={(updated) => cardAudio = updated} 
      text={french}
    />

    <div class="input-group">
      <label>Select Deck</label>
      <div class="chip-container">
        {#each userDecks as deck}
          <button type="button" class="chip {selectedDeck === deck ? 'active' : ''}" on:click={() => selectedDeck = deck}>{deck}</button>
        {/each}
        {#if !showDeckInput}
          <button type="button" class="btn-outline small-outline" on:click={() => showDeckInput = true}>+ New Deck</button>
        {:else}
          <div class="inline-input">
            <input bind:value={newDeckName} placeholder="Name..." />
            <button type="button" on:click={addNewDeck}>Add</button>
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
        <button type="button" on:click={() => toggleTag(tag)} class="tag-chip {isActive ? 'active' : ''}" style="--tag-color: {tagColors[tag] || '#2dd4bf'}">{tag}</button>
      {/each}
      {#if !showTagInput}
        <button type="button" class="tag-chip btn-custom-toggle" on:click={() => showTagInput = true}>+ CUSTOM</button>
      {:else}
        <div class="tag-input-wrapper">
          <input bind:value={newTagName} placeholder="NAME..." on:keydown={(e) => e.key === 'Enter' && addCustomTag()} on:blur={() => !newTagName && (showTagInput = false)} autoFocus />
          <button type="button" class="btn-confirm-tag" on:click={addCustomTag}>OK</button>
        </div>
      {/if}
    </div>

    <button class="btn-save" on:click={handleAddWord}>Save Card</button>
  </div>
</div>

<style>
  .add-card-container { max-width: 500px; margin: 0 auto; padding: 10px; }
  .header-row { display: flex; align-items: center; gap: 20px; margin-bottom: 25px; padding: 0 5px; }
  .title { margin: 0; font-size: 1.4rem; font-weight: 800; color: white; }
  .btn-exit-screenshot { width: 48px; height: 48px; border-radius: 14px; background: rgba(255, 255, 255, 0.05); backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.1); color: #8C9BAB; font-size: 1.5rem; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; flex-shrink: 0; }
  .add-card-form { background: #0f172a; padding: 24px; border-radius: 24px; border: 1px solid rgba(255,255,255,0.08); text-align: left; }
  .input-group { margin-bottom: 20px; }
  .input-group label { display:block; color:#8C9BAB; font-size:0.8rem; margin-bottom:6px; font-weight: 600; }
  input, .custom-textarea { width: 100%; background: #070b14; border: 1px solid rgba(255, 255, 255, 0.1); color: white; padding: 14px; border-radius: 12px; box-sizing: border-box; outline: none; }
  .custom-textarea { height: 80px; resize: none; font-family: inherit; }
  
  /* AUDIO SECTION STYLES */
  .audio-section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .audio-actions { display: flex; gap: 8px; }
  .upload-feedback { color: #2dd4bf; margin-left: 10px; font-size: 0.65rem; animation: fadeIn 0.3s ease-in; }
  .btn-upload-audio { background: transparent; border: 1px solid rgba(45, 212, 191, 0.3); color: #2dd4bf; font-size: 0.65rem; font-weight: 700; padding: 4px 10px; border-radius: 8px; cursor: pointer; transition: 0.2s; }
  .btn-upload-audio:hover:not(:disabled) { border-color: #2dd4bf; background: rgba(45, 212, 191, 0.1); }
  .btn-upload-audio:disabled { opacity: 0.5; cursor: not-allowed; border-color: #334155; color: #8C9BAB; }
  .btn-clear-audio { background: transparent; border: 1px solid rgba(239, 68, 68, 0.3); color: #ef4444; font-size: 0.65rem; font-weight: 700; padding: 4px 10px; border-radius: 8px; cursor: pointer; }
  .btn-clear-audio:hover { background: rgba(239, 68, 68, 0.1); border-color: #ef4444; }

  .chip-container { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; align-items: center; }
  .chip { background: rgba(255,255,255,0.05); color: #8C9BAB; border: 1px solid rgba(255,255,255,0.1); padding: 8px 14px; border-radius: 12px; cursor: pointer; font-size: 0.8rem; transition: all 0.2s; }
  .chip.active { background: #2dd4bf; color: #0f172a; border-color: #2dd4bf; font-weight: 600; }
  .tag-chip { background: rgba(255,255,255,0.03); color: #475569; border: 1px solid rgba(255,255,255,0.08); padding: 4px 10px; border-radius: 8px; cursor: pointer; font-size: 0.65rem; font-weight: 700; transition: all 0.2s; text-transform: uppercase; }
  .tag-chip.active { background: rgba(0,0,0,0.3); border-color: var(--tag-color); color: var(--tag-color); box-shadow: 0 0 10px rgba(0,0,0,0.2); }
  .btn-custom-toggle { border: 1px dashed #2dd4bf; color: #2dd4bf; background: transparent; }
  .tag-input-wrapper { display: flex; align-items: center; background: #070b14; border: 1px solid #2dd4bf; border-radius: 8px; padding: 2px 4px; height: 26px; }
  .tag-input-wrapper input { border: none; background: transparent; color: white; font-size: 0.65rem; padding: 0 4px; width: 60px; height: 100%; font-weight: 700; }
  .btn-confirm-tag { background: #2dd4bf; border: none; color: #0f172a; font-size: 0.6rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; cursor: pointer; }
  .btn-outline { background: none; border: 1px dashed #2dd4bf; color: #2dd4bf; padding: 8px 14px; border-radius: 12px; cursor: pointer; font-size: 0.8rem; }
  .small-outline { padding: 4px 10px; font-size: 0.65rem; border-radius: 8px; }
  .inline-input { display: flex; gap: 8px; width: 100%; margin-top: 5px; }
  .inline-input input { padding: 8px; font-size: 0.8rem; }
  .inline-input button { background: #2dd4bf; border: none; border-radius: 8px; padding: 0 15px; cursor: pointer; font-weight: 700; color: #0f172a; }
  .btn-save { background-color: #2dd4bf; color: #0f172a; padding: 16px; border-radius: 16px; font-weight: 800; width: 100%; border: none; cursor: pointer; margin-top: 10px; font-size: 1rem; text-transform: uppercase; letter-spacing: 1px; }
  .label-small { display: block; color: #8C9BAB; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; margin-bottom: 8px; }

  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
</style>