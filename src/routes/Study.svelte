<script>
  import { onMount } from 'svelte';
  import { db } from '$lib/db';
  export let onNavigate;
  export let params = {};

  let allCards = [];
  let cards = [];
  let currentIndex = 0;
  let showFront = true;
  let isShuffled = false;
  let selectedDeck = params.deck || 'General';
  
  // Audio Playback & Recording State
  let activeAudioIndex = 0; 
  let recordingSlot = null;
  let mediaRecorder;
  let audioChunks = [];
  let currentPlayingAudio = null; 

  // Settings & Edit Modal State
  let showSettings = false;
  let newTagInput = "";
  let existingTags = []; 
  let showTagInput = false;

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

  $: isLongWord = (word) => word && word.length > 10;
  
  // --- AUDIO LOGIC ---
  function toggleAudio(blob) {
    if (!blob) return;

    // If already playing, stop and reset
    if (currentPlayingAudio) {
      currentPlayingAudio.pause();
      currentPlayingAudio.currentTime = 0; 
      currentPlayingAudio = null;
      return;
    }

    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentPlayingAudio = audio;

    audio.play();
    
    audio.onended = () => {
      URL.revokeObjectURL(url);
      currentPlayingAudio = null;
    };
  }

  async function startRecording(index) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        if (!cards[currentIndex].audio) cards[currentIndex].audio = [null, null, null];
        cards[currentIndex].audio[index] = blob;
        cards = [...cards]; 
        recordingSlot = null;
      };
      mediaRecorder.start();
      recordingSlot = index;
    } catch (err) {
      alert("Microphone access denied.");
    }
  }

  function stopRecording() {
    if (mediaRecorder) mediaRecorder.stop();
  }

  function deleteAudio(index) {
    cards[currentIndex].audio[index] = null;
    cards = [...cards];
  }

  // --- TAG AUTO-LOGIC ---
  $: if (showSettings && cards[currentIndex]) {
    const lowerFrench = (cards[currentIndex].french || "").trim().toLowerCase();
    if (lowerFrench.startsWith('le ')) {
      if (!cards[currentIndex].tags?.includes('Masculine')) {
        let cleanTags = (cards[currentIndex].tags || []).filter(t => t !== 'Feminine');
        cards[currentIndex].tags = [...new Set([...cleanTags, 'Masculine'])];
      }
    } else if (lowerFrench.startsWith('la ')) {
      if (!cards[currentIndex].tags?.includes('Feminine')) {
        let cleanTags = (cards[currentIndex].tags || []).filter(t => t !== 'Masculine');
        cards[currentIndex].tags = [...new Set([...cleanTags, 'Feminine'])];
      }
    }
  }

  async function loadCards() {
    const database = await db.init();
    const transaction = database.transaction(['customCards'], 'readonly');
    const store = transaction.objectStore('customCards');
    const request = store.getAll();
    
    request.onsuccess = () => {
      allCards = request.result;
      let filtered = allCards.filter(c => (c.deck || 'General') === selectedDeck);
      cards = isShuffled ? shuffleArray([...filtered]) : filtered;
      
      const tags = new Set(TAG_PRESETS);
      allCards.forEach(card => {
        if (card.tags && Array.isArray(card.tags)) {
          card.tags.forEach(t => {
            const exists = TAG_PRESETS.some(p => p.toLowerCase() === t.toLowerCase());
            if (!exists) tags.add(t.toUpperCase());
          });
        }
      });
      existingTags = Array.from(tags);
    };
  }

  function shuffleArray(array) {
    let arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function toggleShuffle() {
    isShuffled = !isShuffled;
    loadCards();
    currentIndex = 0;
  }

  function toggleTag(tag) {
    const currentCard = cards[currentIndex];
    if (!currentCard.tags) currentCard.tags = [];
    if (currentCard.tags.includes(tag)) {
      currentCard.tags = currentCard.tags.filter(t => t !== tag);
    } else {
      currentCard.tags = [...currentCard.tags, tag];
    }
    cards = [...cards];
  }

  function addNewTagFromInput() {
    const cleanTag = newTagInput.trim().toUpperCase();
    if (cleanTag) {
      if (!existingTags.includes(cleanTag)) existingTags = [...existingTags, cleanTag];
      toggleTag(cleanTag);
      newTagInput = "";
      showTagInput = false;
    } else {
      showTagInput = false;
    }
  }

  async function saveEdits() {
    const cardToUpdate = cards[currentIndex];
    const database = await db.init();
    const transaction = database.transaction(['customCards'], 'readwrite');
    const store = transaction.objectStore('customCards');
    store.put(cardToUpdate);
    transaction.oncomplete = () => {
      showSettings = false;
      cards = [...cards];
    };
  }

  onMount(async () => {
    await loadCards();
  });

  function nextCard() {
    if (currentPlayingAudio) { currentPlayingAudio.pause(); currentPlayingAudio = null; }
    showFront = true;
    activeAudioIndex = 0;
    currentIndex = (currentIndex + 1) % cards.length;
  }

  function prevCard() {
    if (currentPlayingAudio) { currentPlayingAudio.pause(); currentPlayingAudio = null; }
    showFront = true;
    activeAudioIndex = 0;
    currentIndex = (currentIndex - 1 + cards.length) % cards.length;
  }

  async function removeCurrentCard() {
    const cardToDelete = cards[currentIndex];
    if (!cardToDelete || !confirm("Delete this card permanently?")) return;
    const database = await db.init();
    const transaction = database.transaction(['customCards'], 'readwrite');
    const store = transaction.objectStore('customCards');
    store.delete(cardToDelete.id);
    transaction.oncomplete = async () => {
      await loadCards();
      if (currentIndex >= cards.length && cards.length > 0) currentIndex = cards.length - 1;
      showFront = true; 
    };
  }
</script>

<div class="study-container">
  <div class="header-row">
    <div class="header-left-group">
      <button class="btn-icon btn-exit-styled" on:click={() => onNavigate('dashboard')}>←</button>
      <button class="btn-icon btn-settings" on:click={() => showSettings = true}>⚙️</button>
    </div>
    <div class="header-center">
      <span class="deck-indicator">{selectedDeck}</span>
    </div>
    <div class="header-right">
      <button class="btn-icon {isShuffled ? 'shuffle-active' : ''}" on:click={toggleShuffle}>🔀</button>
      <button class="btn-icon btn-del" on:click={removeCurrentCard}>🗑️</button>
    </div>
  </div>

  {#if cards.length > 0}
    <div class="progress">{currentIndex + 1} / {cards.length}</div>

    <div class="card" on:click={() => (showFront = !showFront)}>
      <div class="card-inner-content">
        {#if showFront}
          <div class="center-content">
            <span class="label-small">English</span>
            <h2 class="display-word-large {isLongWord(cards[currentIndex].english) ? 'long-text' : ''}">
              {cards[currentIndex].english}
            </h2>
          </div>
        {:else}
          <div class="top-right-audio">
            {#if cards[currentIndex].audio && cards[currentIndex].audio[activeAudioIndex]}
              <button 
                class="btn-audio-play-blended {currentPlayingAudio ? 'is-playing' : ''}" 
                on:click|stopPropagation={() => toggleAudio(cards[currentIndex].audio[activeAudioIndex])}
              >
                {currentPlayingAudio ? '⏹' : '🔊'}
              </button>
            {/if}
          </div>

          <div class="center-content back-adjust">
            <span class="label-small">Français</span>
            <h2 class="display-word-large french-color {isLongWord(cards[currentIndex].french) ? 'long-text' : ''}">
              {cards[currentIndex].french}
            </h2>
            {#if cards[currentIndex].pronunciation}
              <div class="pronunciation-row">
                <span class="green-label-small">Pronunciation:</span>
                <span class="user-input-small">{cards[currentIndex].pronunciation}</span>
              </div>
            {/if}
            {#if cards[currentIndex].tags?.length > 0}
              <div class="tags-row">
                {#each cards[currentIndex].tags as tag}
                  <span class="tag-chip-small" style="--tag-color: {tagColors[tag] || '#2dd4bf'}">{tag}</span>
                {/each}
              </div>
            {/if}
          </div>

          <div class="bottom-notes-container">
            {#if cards[currentIndex].notes && cards[currentIndex].notes.trim().length > 0}
              <div class="extra-info note-box-fixed">
                <strong class="notes-header-small">Notes</strong>
                <span class="notes-body-small">{cards[currentIndex].notes}</span>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>

    <div class="nav-controls">
      <button class="btn-nav btn-prev" on:click|stopPropagation={prevCard}>← Prev</button>
      <button class="btn-nav btn-next" on:click|stopPropagation={nextCard}>Next →</button>
    </div>
  {:else}
    <div class="empty-state">
      <p>This deck is empty!</p>
      <button class="btn-nav btn-next" style="width: auto;" on:click={() => onNavigate('dashboard')}>Return to Dashboard</button>
    </div>
  {/if}

  {#if showSettings}
    <div class="modal-overlay">
      <div class="modal-content">
        <h3 class="modal-title">Edit Card</h3>
        
        <div class="modal-scroll-area">
          <div class="modal-input-group">
            <label class="first-label">English</label>
            <input bind:value={cards[currentIndex].english} />
            <label>French</label>
            <input bind:value={cards[currentIndex].french} />

            <label>Audio Slots (Record/Replace)</label>
            <div class="audio-management-list">
              {#each [0, 1, 2] as i}
                <div class="audio-row {activeAudioIndex === i ? 'is-active-slot' : ''}">
                  <button class="slot-select-indicator" on:click={() => activeAudioIndex = i}>
                    {activeAudioIndex === i ? '⭐' : 'Slot ' + (i + 1)}
                  </button>
                  <div class="audio-actions">
                    {#if recordingSlot === i}
                      <button class="action-btn rec-stop" on:click={stopRecording}>⏹</button>
                    {:else}
                      <button class="action-btn rec-start" on:click={() => startRecording(i)}>🎙</button>
                    {/if}
                    {#if cards[currentIndex].audio?.[i]}
                      <button class="action-btn act-play {currentPlayingAudio ? 'pulse' : ''}" on:click={() => toggleAudio(cards[currentIndex].audio[i])}>
                        {currentPlayingAudio ? '⏹' : '▶'}
                      </button>
                      <button class="action-btn act-del" on:click={() => deleteAudio(i)}>✕</button>
                    {/if}
                  </div>
                </div>
              {/each}
              <p class="help-text">* Star indicates which slot plays on the card back.</p>
            </div>
            
            <label>Pronunciation</label>
            <input bind:value={cards[currentIndex].pronunciation} />
            <label>Notes</label>
            <textarea bind:value={cards[currentIndex].notes}></textarea>

            <label>Tags</label>
            <div class="tag-selection-grid">
              {#each existingTags as tag}
                {@const isActive = cards[currentIndex].tags?.includes(tag)}
                <button class="selection-chip {isActive ? 'active' : ''}" style="--active-color: {tagColors[tag] || '#2dd4bf'}" on:click={() => toggleTag(tag)}>{tag}</button>
              {/each}
              {#if !showTagInput}
                <button type="button" class="selection-chip btn-custom-toggle" on:click={() => showTagInput = true}>+ CUSTOM</button>
              {:else}
                <div class="tag-input-wrapper">
                  <input bind:value={newTagInput} placeholder="NAME..." on:keydown={(e) => e.key === 'Enter' && addNewTagFromInput()} on:blur={() => !newTagInput && (showTagInput = false)} autoFocus />
                  <button type="button" class="btn-confirm-tag" on:click={addNewTagFromInput}>OK</button>
                </div>
              {/if}
            </div>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn-cancel" on:click={() => { showSettings = false; showTagInput = false; if(currentPlayingAudio) { currentPlayingAudio.pause(); currentPlayingAudio = null; } }}>Cancel</button>
          <button class="btn-save-modal" on:click={saveEdits}>Save Changes</button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .study-container { text-align: center; padding: 15px; min-height: 100vh; display: flex; flex-direction: column; align-items: center; }
  .header-row { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; width: 100%; max-width: 400px; margin-bottom: 20px; }
  .header-left-group { display: flex; gap: 8px; justify-content: flex-start; }
  .header-center { text-align: center; }
  .header-right { text-align: right; display: flex; gap: 8px; justify-content: flex-end; }
  .deck-indicator { font-size: 0.8rem; color: #2dd4bf; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; }
  .btn-icon { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 8px 12px; cursor: pointer; color: white; font-size: 1rem; display: inline-flex; align-items: center; justify-content: center; transition: all 0.2s ease; }
  .btn-icon:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.2); }
  .btn-exit-styled { color: #8C9BAB; }
  .shuffle-active { border-color: #2dd4bf; background: rgba(45, 212, 191, 0.1); color: #2dd4bf; }
  .btn-del:hover { background: rgba(239, 68, 68, 0.15); border-color: #ef4444; color: #ef4444; }
  .progress { color: #8C9BAB; margin-bottom: 15px; font-size: 0.9rem; }
  .card { background: #0a0e17; height: 340px; border-radius: 24px; cursor: pointer; border: 2px solid #2dd4bf; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3); margin-bottom: 25px; width: 100%; max-width: 380px; position: relative; overflow: hidden; }
  .card-inner-content { display: flex; flex-direction: column; height: 100%; padding: 20px; box-sizing: border-box; }
  .center-content { flex-grow: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; }
  .back-adjust { padding-bottom: 10px; }
  .bottom-notes-container { margin-top: auto; width: 100%; display: flex; justify-content: center; }
  .display-word-large { font-size: clamp(1.8rem, 7vw, 2.5rem); margin: 5px 0; color: #fff; font-weight: 700; line-height: 1.1; }
  .long-text { font-size: clamp(1.4rem, 5vw, 2rem); }
  .french-color { color: #2dd4bf; }
  .pronunciation-row { margin-bottom: 4px; font-size: 0.85rem; }
  .green-label-small { color: #2dd4bf; font-weight: bold; margin-right: 4px; }
  .user-input-small { color: #8C9BAB; font-style: italic; }
  .tags-row { display: flex; justify-content: center; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
  .tag-chip-small { font-size: 0.6rem; background: rgba(0, 0, 0, 0.3); color: var(--tag-color); border: 1px solid var(--tag-color); padding: 3px 8px; border-radius: 6px; font-weight: 700; text-transform: uppercase; }
  .note-box-fixed { background: rgba(255, 255, 255, 0.05); border-radius: 14px; padding: 10px 15px; text-align: left; width: 100%; min-height: 80px; border: 1px solid rgba(255, 255, 255, 0.08); }
  .notes-header-small { display: block; font-size: 0.65rem; color: #8C9BAB; text-transform: uppercase; margin-bottom: 3px; }
  .notes-body-small { font-size: 0.7rem; color: #cbd5e1; line-height: 1.3; }
  .nav-controls { display: flex; gap: 12px; width: 100%; max-width: 280px; }
  .btn-nav { flex: 1; border: none; padding: 12px; border-radius: 12px; font-weight: bold; cursor: pointer; }
  .btn-prev { background: #374151; color: #d1d5db; }
  .btn-next { background: #7c3aed; color: white; }
  .label-small { font-size: 0.65rem; color: #8C9BAB; text-transform: uppercase; letter-spacing: 0.1em; }
  
  /* AUDIO BUTTON STYLES */
  .top-right-audio { position: absolute; top: 15px; right: 15px; z-index: 10; }
  .btn-audio-play-blended { background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.7); border-radius: 50%; width: 40px; height: 40px; font-size: 1rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
  .btn-audio-play-blended.is-playing { background: rgba(45, 212, 191, 0.2); border-color: #2dd4bf; color: #2dd4bf; }
  .btn-audio-play-blended:hover { background: rgba(255, 255, 255, 0.15); color: #fff; }

  .audio-management-list { background: rgba(0,0,0,0.2); padding: 10px; border-radius: 12px; margin-top: 5px; }
  .audio-row { display: flex; align-items: center; justify-content: space-between; padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .audio-row:last-child { border-bottom: none; }
  .audio-row.is-active-slot { background: rgba(45, 212, 191, 0.05); border-radius: 8px; }
  .slot-select-indicator { background: none; border: none; color: #8C9BAB; font-size: 0.75rem; font-weight: bold; cursor: pointer; text-align: left; width: 60px; }
  .audio-actions { display: flex; gap: 8px; }
  .action-btn { width: 32px; height: 32px; border-radius: 8px; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 0.9rem; }
  .rec-start { background: #334155; color: white; }
  .rec-stop { background: #ef4444; color: white; animation: pulse 1s infinite; }
  .act-play { background: #2dd4bf; color: #0f172a; }
  .act-play.pulse { animation: pulse 1.5s infinite; }
  .act-del { background: transparent; color: #ef4444; border: 1px solid #ef4444; font-size: 0.7rem; }
  .help-text { font-size: 0.6rem; color: #475569; margin-top: 8px; font-style: italic; }

  @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }

  /* MODAL STYLES */
  .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .modal-content { background: #1e293b; padding: 16px 24px 24px; border-radius: 20px; width: 90%; max-width: 400px; text-align: left; border: 1px solid rgba(255,255,255,0.1); }
  .modal-title { margin: 0 0 16px 0; font-size: 1.2rem; }
  .modal-scroll-area { max-height: 60vh; overflow-y: auto; padding-right: 8px; }
  .modal-input-group label { display: block; font-size: 0.75rem; color: #8C9BAB; margin-top: 12px; }
  .modal-input-group label.first-label { margin-top: 0; }
  .modal-input-group input, .modal-input-group textarea { width: 100%; background: #0f172a; border: 1px solid #334155; color: white; padding: 10px; margin-top: 4px; border-radius: 8px; box-sizing: border-box; }
  .tag-selection-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .selection-chip { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); color: #475569; padding: 5px 10px; border-radius: 8px; font-size: 0.7rem; font-weight: 700; cursor: pointer; text-transform: uppercase; }
  .selection-chip.active { background: rgba(0,0,0,0.3); border-color: var(--active-color); color: var(--active-color); }
  .modal-actions { display: flex; gap: 10px; margin-top: 24px; }
  .btn-save-modal { flex: 1; background: #2dd4bf; border: none; padding: 12px; border-radius: 10px; font-weight: 700; color: #0a0e17; cursor: pointer; }
  .btn-cancel { flex: 1; background: transparent; color: white; border: 1px solid #334155; padding: 12px; border-radius: 10px; cursor: pointer; }
</style>