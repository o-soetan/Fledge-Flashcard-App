<script>
  import { onMount, onDestroy } from 'svelte';
  import { db } from '$lib/db';
  import AudioRecorder from './AudioRecorder.svelte';

  let { onNavigate, params = {}, user = null } = $props();

  let allCards = $state([]);
  let cards = $state([]);
  let currentIndex = $state(0);
  let showFront = $state(true);
  let isShuffled = $state(false);
  let isStarted = $state(false);
  let sessionLimit = $state(0);
  let quizMode = $state(true);
  let isFinished = $state(false);
  
  // Reactive helper for user-scoping
  let userId = $derived(user?.id || 'guest');

  // Session Stats
  let sessionResults = $state({ correct: 0, incorrect: 0, skipped: 0 });
  let struggledCards = $state([]);
  let selectedDeck = $state(params.deck || 'General');
  
  // Audio Playback & Recording State
  let activeAudioIndex = $state(0);
  let audioManager = $state();

  // Settings & Edit Modal State
  let viewMode = $state('card'); // 'card' or 'deck'
  let showSettings = $state(false);
  let newTagInput = $state("");
  let saveStatus = $state(null); // null, 'saving', or 'saved'
  let existingTags = $state([]); 
  let showTagInput = $state(false);

  // Deck Settings
  let frontLanguage = $state('en'); // 'en' or 'fr'
  let deckNotes = $state('');
  let useTimer = $state(false);
  let elapsedTime = $state(0);
  let timerInterval;

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

  let isLongWord = $derived((word) => word && word.length > 10);
  
  // --- DECK SETTINGS LOGIC ---
  function loadDeckSettings() {
    const legacyLang = localStorage.getItem(`fledge_pref_lang_${selectedDeck}`);
    const userSpecificLang = localStorage.getItem(`fledge_${userId}_pref_lang_${selectedDeck}`);
    const savedLang = userSpecificLang || legacyLang;
    if (savedLang) frontLanguage = savedLang;
    
    const legacyNotes = localStorage.getItem(`fledge_deck_notes_${selectedDeck}`);
    const userSpecificNotes = localStorage.getItem(`fledge_${userId}_deck_notes_${selectedDeck}`);
    if (userSpecificNotes || legacyNotes) deckNotes = userSpecificNotes || legacyNotes;

    const savedQuizMode = localStorage.getItem(`fledge_pref_quiz_${selectedDeck}`);
    if (savedQuizMode !== null) quizMode = savedQuizMode === 'true';
  }

  function saveDeckSettings() {
    localStorage.setItem(`fledge_pref_lang_${selectedDeck}`, frontLanguage);
    localStorage.setItem(`fledge_deck_notes_${selectedDeck}`, deckNotes);
    localStorage.setItem(`fledge_${userId}_pref_lang_${selectedDeck}`, frontLanguage);
    localStorage.setItem(`fledge_${userId}_deck_notes_${selectedDeck}`, deckNotes);
    localStorage.setItem(`fledge_pref_quiz_${selectedDeck}`, quizMode.toString());
    saveStatus = 'saved';
    setTimeout(() => {
      showSettings = false;
      saveStatus = null;
    }, 800);
  }

  function toggleTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    } else if (useTimer) {
      timerInterval = setInterval(() => elapsedTime++, 1000);
    }
  }

  // --- TAG AUTO-LOGIC ---
  $effect(() => {
    if (showSettings && cards[currentIndex]) {
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
  });

  // Auto-play selected audio 1 second after card is flipped to the back
  $effect(() => {
    if (isStarted && !showFront && cards[currentIndex]) {
      const timer = setTimeout(() => {
        if (!audioManager?.currentPlayingAudio && !audioManager?.isSynthesizing) {
          if (activeAudioIndex === 0) audioManager.speak(cards[currentIndex].french);
          else if (cards[currentIndex].audio?.[activeAudioIndex]) {
            audioManager.playBlob(cards[currentIndex].audio[activeAudioIndex]);
          }
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  });

  async function loadCards() {
    // Reset session state
    isFinished = false;
    sessionResults = { correct: 0, incorrect: 0, skipped: 0 };
    struggledCards = [];
    isStarted = false;

    // 2. TRIGGER CLOUD SYNC (Crucial Step)
    // This ensures that even if local data exists, we pull the latest from the cloud
    const syncToken = localStorage.getItem('fledge_sync_token');
    if (user && db.syncWithCloud && syncToken) {
      await db.syncWithCloud(user.id, syncToken);
    }

    const database = await db.init();
    const transaction = database.transaction(['customCards'], 'readonly');

    // 3. Load user-specific settings
    loadDeckSettings();

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

  let filteredCount = $derived(allCards.filter(c => (c.deck || 'General') === selectedDeck).length);

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
    const cardToUpdate = $state.snapshot(cards[currentIndex]);
    const database = await db.init();
    const transaction = database.transaction(['customCards'], 'readwrite');
    const store = transaction.objectStore('customCards');
    store.put(cardToUpdate);

    // Sync with allCards to prevent "nothing happens" bug when shuffling/reloading
    const masterIdx = allCards.findIndex(c => c.id === cardToUpdate.id);
    if (masterIdx !== -1) allCards[masterIdx] = cardToUpdate;

    // 4. Push change to cloud
    const syncToken = localStorage.getItem('fledge_sync_token');
    if (user && db.pushToCloud && syncToken) {
      db.pushToCloud(cardToUpdate, user.id, syncToken);
    }

    transaction.oncomplete = () => {
      saveStatus = 'saved';
      setTimeout(() => {
        showSettings = false;
        saveStatus = null;
      }, 800);
    };
  }

  function playCurrentAudio() {
    if (!audioManager || !cards[currentIndex]) return;
    if (activeAudioIndex === 0) {
      audioManager.speak(cards[currentIndex].french);
    } else if (cards[currentIndex].audio?.[activeAudioIndex]) {
      audioManager.playBlob(cards[currentIndex].audio[activeAudioIndex]);
    }
  }

  function handleKeydown(event) {
    if (showSettings) return;

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      prevCard();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      nextCard();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      showFront = !showFront;
    } else if (event.key === ' ') {
      event.preventDefault();
      playCurrentAudio();
    }
  }

  onMount(async () => {
    await loadCards();
    window.addEventListener('keydown', handleKeydown);
  });

  function startSession() {
    // Apply session limit if selected
    if (sessionLimit > 0 && cards.length > sessionLimit) {
      cards = cards.slice(0, sessionLimit);
    }
    
    isStarted = true;
    isFinished = false;
    currentIndex = 0;
    elapsedTime = 0;
    sessionResults = { correct: 0, incorrect: 0, skipped: 0 };
    struggledCards = [];
    if (useTimer) toggleTimer();
  }

  function restartSession(onlyMissed = false) {
    if (onlyMissed) {
      // Study only the cards added to the struggle list
      cards = [...struggledCards];
    } else {
      // Re-filter the full deck from the local state
      let filtered = allCards.filter(c => (c.deck || 'General') === selectedDeck);
      cards = isShuffled ? shuffleArray([...filtered]) : filtered;
      
      // Re-apply the user's chosen session limit if applicable
      if (sessionLimit > 0 && cards.length > sessionLimit) {
        cards = cards.slice(0, sessionLimit);
      }
    }

    currentIndex = 0;
    elapsedTime = 0;
    sessionResults = { correct: 0, incorrect: 0, skipped: 0 };
    struggledCards = [];
    isFinished = false;
    isStarted = true;
    showFront = true;
    if (useTimer) toggleTimer();
  }

  function handleReview(type) {
    if (type === 'correct') {
      sessionResults.correct++;
    } else if (type === 'incorrect') {
      sessionResults.incorrect++;
      struggledCards.push(cards[currentIndex]);
    } else {
      sessionResults.skipped++;
    }

    if (currentIndex < cards.length - 1) {
      nextCard();
    } else {
      isFinished = true;
      isStarted = false;
      if (timerInterval) clearInterval(timerInterval);
    }
  }

  onDestroy(() => {
    audioManager?.stopAll();
    if (timerInterval) clearInterval(timerInterval);
    window.removeEventListener('keydown', handleKeydown);
  });

  function nextCard() {
    if (currentIndex < cards.length - 1) {
      showFront = true;
      activeAudioIndex = 0;
      currentIndex++;
    } else if (!quizMode) {
      // If not in quiz mode, reaching the end closes the session
      isFinished = true;
      isStarted = false;
      if (timerInterval) clearInterval(timerInterval);
    }
  }

  function prevCard() {
    if (currentIndex > 0) {
      showFront = true;
      activeAudioIndex = 0;
      currentIndex--;
    }
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
  <!-- Headless Audio Controller -->
  <AudioRecorder 
    bind:this={audioManager} 
    audioSlots={cards[currentIndex]?.audio} 
    text={cards[currentIndex]?.french}
    mode="headless"
  />

  <div class="header-row">
    <div class="header-left-group">
      <button class="btn-icon btn-exit-styled" onclick={() => onNavigate('dashboard')}>←</button>
      <button class="btn-icon btn-settings" onclick={(e) => { e.stopPropagation(); showSettings = true; }}>⚙️</button>
    </div>
    <div class="header-center">
      <div class="header-title-stack">
        <span class="deck-indicator">{selectedDeck}</span>
        {#if useTimer}
          <span class="timer-display">⏱ {Math.floor(elapsedTime / 60)}:{(elapsedTime % 60).toString().padStart(2, '0')}</span>
        {/if}
      </div>
    </div>
    <div class="header-right">
      <button class="btn-icon {isShuffled ? 'shuffle-active' : ''}" onclick={toggleShuffle}>🔀</button>
      <button class="btn-icon btn-del" onclick={removeCurrentCard}>🗑️</button>
    </div>
  </div>

  {#if isFinished}
    <div class="preview-container">
      <div class="preview-card summary-card">
        <div class="summary-header">
          <span class="confetti-icon">🎉</span>
          <h1 class="preview-title">Congratulations!</h1>
          <p class="summary-subtitle">You finished the deck: <strong>{selectedDeck}</strong></p>
        </div>

        <div class="stats-grid">
          <div class="stat-item">
            <span class="stat-label">Accuracy</span>
            <span class="stat-value">{Math.round((sessionResults.correct / (sessionResults.correct + sessionResults.incorrect)) * 100) || 0}%</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Correct</span>
            <span class="stat-value green">{sessionResults.correct}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Struggled</span>
            <span class="stat-value red">{sessionResults.incorrect}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Skipped</span>
            <span class="stat-value">{sessionResults.skipped}</span>
          </div>
        </div>

        {#if useTimer || sessionResults.correct + sessionResults.incorrect > 0}
          <div class="time-summary">
            {#if useTimer}
              <div class="time-row">
                <span>Total Time</span>
                <strong>{Math.floor(elapsedTime / 60)}m {elapsedTime % 60}s</strong>
              </div>
            {/if}
            <div class="time-row">
              <span>Avg. Time/Card</span>
              <strong>{((elapsedTime) / (sessionResults.correct + sessionResults.incorrect)).toFixed(1)}s</strong>
            </div>
          </div>
        {/if}

        <div class="summary-actions">
          <button class="btn-start-session" onclick={() => restartSession(false)}>
            Restart Full Deck
          </button>
          
          {#if struggledCards.length > 0}
            <button class="btn-review-struggled" onclick={() => restartSession(true)}>
              Review {struggledCards.length} Missed Cards
            </button>
          {/if}
          
          <button class="btn-nav btn-prev" style="width: 100%; margin-top: 10px;" onclick={() => onNavigate('dashboard')}>
            Back to Dashboard
          </button>
        </div>
      </div>
    </div>
  {:else if !isStarted && cards.length > 0}
    <div class="preview-container">
      <div class="preview-card">
        <span class="label-small">Deck Preview</span>
        <h1 class="preview-title">{selectedDeck}</h1>
        <p class="preview-count">{filteredCount} Cards Available</p>
        
        {#if deckNotes}
          <div class="preview-description">
            <span class="notes-header-small">Description</span>
            <p>{deckNotes}</p>
          </div>
        {/if}

        <div class="preview-settings-row">
          <div class="timer-config"> 
            <button class="timer-toggle-mini {useTimer ? 'on' : ''}" onclick={() => useTimer = !useTimer} aria-label="Toggle Study Timer">
              {useTimer ? '⏱ Enabled' : '⏱ Disabled'}
            </button>
          </div>
          <div class="timer-config"> 
            <button class="timer-toggle-mini {quizMode ? 'on' : ''}" onclick={() => quizMode = !quizMode} aria-label="Toggle Quiz Mode">
              {quizMode ? '🎯 Quiz ON' : '📖 Study Only'}
            </button>
          </div>
        </div>
 
        {#if filteredCount > 25}
          <div class="session-selector">
            <label for="session-size" class="label-small">Session Size</label>
            <div class="limit-grid">
              {#each [10, 15, 20, 25] as limit}
                <button 
                  class="limit-btn {sessionLimit === limit ? 'selected' : ''}" 
                  onclick={() => sessionLimit = limit}
                  aria-label="Set session size to {limit}"
                >
                  {limit}
                </button>
              {/each}
              <div class="custom-limit-wrapper">
                <input 
                  type="number" 
                  class="limit-input {![0, 10, 15, 20, 25].includes(sessionLimit) ? 'active' : ''}" 
                  placeholder="#" 
                  id="session-size"
                  bind:value={sessionLimit}
                  title="Custom quantity"
                />
              </div>
              <button 
                class="limit-btn {sessionLimit === 0 ? 'selected' : ''}" 
                onclick={() => sessionLimit = 0}
              >
                All Cards
              </button>
            </div>
          </div>
        {/if}
 
        <button class="btn-start-session" onclick={startSession}>{quizMode ? 'Start Quiz' : 'Start Studying'}</button>
      </div>
    </div>
  {:else if isStarted && cards.length > 0}
    <div class="progress">{currentIndex + 1} / {cards.length}</div>

    <div class="card" role="button" tabindex="0" onclick={() => (showFront = !showFront)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showFront = !showFront; } }}>
      <div class="card-inner-content">
        {#if showFront}
          {@const word = frontLanguage === 'en' ? cards[currentIndex].english : cards[currentIndex].french}
          <div class="center-content">
            <span class="label-small">{frontLanguage === 'en' ? 'English' : 'Français'}</span>
            <h2 class="display-word-large {isLongWord(word) ? 'long-text' : ''} {frontLanguage === 'fr' ? 'french-color' : ''}">
              {word}
            </h2>
          </div>
        {:else}
          {@const backWord = frontLanguage === 'en' ? cards[currentIndex].french : cards[currentIndex].english}
          {@const canPlay = activeAudioIndex === 0 || (cards[currentIndex].audio && cards[currentIndex].audio[activeAudioIndex])}
          <div class="top-right-audio">
            {#if canPlay}
              <button 
                class="btn-audio-play-blended {(audioManager?.currentPlayingAudio || audioManager?.isSynthesizing) ? 'is-playing' : ''}" 
                onclick={(e) => {
                  e.stopPropagation();
                  if (activeAudioIndex === 0) audioManager.speak(cards[currentIndex].french);
                  else audioManager.playBlob(cards[currentIndex].audio[activeAudioIndex]);
                }}
              >
                {audioManager?.currentPlayingAudio || audioManager?.isSynthesizing ? '⏹' : '🔊'}
              </button>
            {/if}
          </div>

          <div class="center-content back-adjust">
            <span class="label-small">{frontLanguage === 'en' ? 'Français' : 'English'}</span>
            <h2 class="display-word-large {frontLanguage === 'en' ? 'french-color' : ''} {isLongWord(backWord) ? 'long-text' : ''}">
              {backWord}
            </h2>
            {#if frontLanguage === 'en' && cards[currentIndex].pronunciation}
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

    {#if showFront}
      <div class="nav-controls">
        <button class="btn-nav btn-prev" onclick={(e) => { e.stopPropagation(); prevCard(); }}>← Prev</button>
        <button class="btn-nav btn-next" onclick={(e) => { e.stopPropagation(); showFront = false; }}>Flip Card</button>
      </div>
    {:else if quizMode}
      <div class="nav-controls review-controls">
        <button class="btn-review-forgot" onclick={(e) => { e.stopPropagation(); handleReview('incorrect'); }}>✕ Forgot</button>
        <button class="btn-review-remember" onclick={(e) => { e.stopPropagation(); handleReview('correct'); }}>✓ Remembered</button>
      </div>
    {:else}
      <div class="nav-controls">
        <button class="btn-nav btn-prev" onclick={(e) => { e.stopPropagation(); prevCard(); }}>← Prev</button>
        <button class="btn-nav btn-next" onclick={(e) => { e.stopPropagation(); nextCard(); }}>Next →</button>
      </div>
    {/if}

  {:else}
    <div class="empty-state">
      <p>This deck is empty!</p>
      <button class="btn-nav btn-next" style="width: auto;" onclick={() => onNavigate('dashboard')}>Return to Dashboard</button>
    </div>
  {/if}

  {#if showSettings}
    <div class="modal-overlay">
      <div class="modal-content">
        <div class="modal-tabs">
          <button class="tab-btn {viewMode === 'card' ? 'active' : ''}" onclick={() => viewMode = 'card'}>Card Edit</button>
          <button class="tab-btn {viewMode === 'deck' ? 'active' : ''}" onclick={() => viewMode = 'deck'}>Deck Preview</button>
        </div>
        
        <div class="modal-scroll-area"> 
          {#if viewMode === 'card'}
          <div class="modal-input-group">
            <label for="edit-english" class="first-label">English</label>
            <input id="edit-english" bind:value={cards[currentIndex].english} />
            <label for="edit-french">French</label> 
            <input id="edit-french" bind:value={cards[currentIndex].french} />

            <label for="audio-slots">Audio Management</label>
            <AudioRecorder 
              bind:audioSlots={cards[currentIndex].audio}
              bind:activeAudioIndex={activeAudioIndex}
              text={cards[currentIndex].french}
              mode="management"
            />
             
            <label for="edit-pronunciation">Pronunciation</label>
            <input id="edit-pronunciation" bind:value={cards[currentIndex].pronunciation} /> 
            <label for="edit-notes">Notes</label>
            <textarea id="edit-notes" bind:value={cards[currentIndex].notes}></textarea>

            <label>Tags</label>
            <div class="tag-selection-grid">
              {#each existingTags as tag}
                {@const isActive = cards[currentIndex].tags?.includes(tag)}
                <button class="selection-chip {isActive ? 'active' : ''}" style="--active-color: {tagColors[tag] || '#2dd4bf'}" onclick={() => toggleTag(tag)}>{tag}</button>
              {/each}
              {#if !showTagInput}
                <button type="button" class="selection-chip btn-custom-toggle" onclick={() => showTagInput = true}>+ CUSTOM</button>
              {:else}
                <div class="tag-input-wrapper">
                  <input bind:value={newTagInput} placeholder="NAME..." onkeydown={(e) => e.key === 'Enter' && addNewTagFromInput()} onblur={() => !newTagInput && (showTagInput = false)} />
                  <button type="button" class="btn-confirm-tag" onclick={addNewTagFromInput}>OK</button>
                </div>
              {/if}
            </div>
          </div> 
          {:else}
            <div class="modal-input-group">
              <label class="first-label">Front Language</label>
              <div class="toggle-switch-row">
                <button class="choice-btn {frontLanguage === 'en' ? 'active' : ''}" onclick={() => frontLanguage = 'en'}>English</button>
                <button class="choice-btn {frontLanguage === 'fr' ? 'active' : ''}" onclick={() => frontLanguage = 'fr'}>French</button>
              </div>
 
              <label for="edit-deck-notes">Deck Notes & Preview</label>
              <textarea 
                id="edit-deck-notes"
                bind:value={deckNotes} 
                placeholder="Add goals, rules, or context for this deck..."
                class="deck-notes-area"
              ></textarea>

              <div class="timer-toggle-row">
                <label>Study Timer</label>
                <button 
                  class="timer-toggle-btn {useTimer ? 'on' : ''}" 
                  onclick={() => { useTimer = !useTimer; toggleTimer(); }}
                >
                  {useTimer ? 'Stopwatch: ON' : 'Stopwatch: OFF'}
                </button>
              </div>
            </div>
          {/if}
        </div>

        <div class="modal-actions">
          <button class="btn-cancel" onclick={() => { showSettings = false; showTagInput = false; if(currentPlayingAudio) { currentPlayingAudio.pause(); currentPlayingAudio = null; } }}>Cancel</button>
          <button class="btn-save-modal {saveStatus === 'saved' ? 'status-success' : ''}" onclick={viewMode === 'card' ? saveEdits : saveDeckSettings}>
            {saveStatus === 'saved' ? '✔ Saved!' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .study-container { text-align: center; padding: 15px; min-height: 100vh; display: flex; flex-direction: column; align-items: center; }
  
  /* PREVIEW SCREEN */
  .preview-container { display: flex; align-items: center; justify-content: center; flex-grow: 1; width: 100%; max-width: 400px; padding: 20px; }
  .preview-card { background: #0a0e17; border: 2px solid #2dd4bf; border-radius: 24px; padding: 30px; width: 100%; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3); text-align: left; }
  .preview-title { font-size: 2rem; color: #fff; margin: 8px 0; font-weight: 800; }
  .preview-count { color: #2dd4bf; font-weight: 700; font-size: 0.9rem; text-transform: uppercase; margin-bottom: 20px; }
  .preview-description { background: rgba(255, 255, 255, 0.05); border-radius: 12px; padding: 15px; margin-bottom: 20px; }
  .preview-description p { font-size: 0.85rem; color: #cbd5e1; line-height: 1.5; margin-top: 5px; }

  .summary-header { text-align: center; margin-bottom: 25px; }
  .confetti-icon { font-size: 3rem; display: block; margin-bottom: 10px; }
  .summary-subtitle { color: #8C9BAB; font-size: 0.9rem; }
  .summary-subtitle strong { color: #fff; }
  
  .header-row { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; width: 100%; max-width: 400px; margin-bottom: 20px; }
  .header-left-group { display: flex; gap: 8px; justify-content: flex-start; }
  .header-center { text-align: center; }
  .header-right { text-align: right; display: flex; gap: 8px; justify-content: flex-end; }
  .header-title-stack { display: flex; flex-direction: column; align-items: center; }
  .timer-display { font-size: 0.65rem; color: #8C9BAB; font-weight: 700; margin-top: 2px; font-family: monospace; }
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
  .btn-review-remember { flex: 1.5; background: #10b981; color: white; border: none; padding: 14px; border-radius: 12px; font-weight: 800; cursor: pointer; font-size: 0.9rem; }
  .btn-review-forgot { flex: 1; background: #ef4444; color: white; border: none; padding: 14px; border-radius: 12px; font-weight: 800; cursor: pointer; font-size: 0.9rem; }
  
  .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 20px; }
  .stat-item { background: rgba(255,255,255,0.03); padding: 12px 5px; border-radius: 12px; text-align: center; border: 1px solid rgba(255,255,255,0.05); }
  .stat-label { display: block; font-size: 0.6rem; color: #8C9BAB; text-transform: uppercase; margin-bottom: 4px; }
  .stat-value { font-size: 1.2rem; font-weight: 800; color: #fff; }
  .stat-value.green { color: #10b981; }
  .stat-value.red { color: #ef4444; }

  .time-summary { background: rgba(0,0,0,0.2); padding: 15px; border-radius: 12px; margin-bottom: 25px; }
  .time-row { display: flex; justify-content: space-between; font-size: 0.8rem; color: #8C9BAB; margin-bottom: 5px; }
  .time-row:last-child { margin-bottom: 0; }
  .time-row strong { color: #2dd4bf; }
  .label-small { font-size: 0.65rem; color: #8C9BAB; text-transform: uppercase; letter-spacing: 0.1em; }
  
  /* PREVIEW ACTIONS */
  .preview-settings-row { margin-bottom: 20px; }
  .timer-toggle-mini { background: #1e293b; border: 1px solid #334155; color: #8C9BAB; padding: 8px 16px; border-radius: 10px; cursor: pointer; font-weight: 700; font-size: 0.75rem; transition: all 0.2s; margin-top: 5px; }
  .timer-toggle-mini.on { background: rgba(45, 212, 191, 0.1); border-color: #2dd4bf; color: #2dd4bf; }
  
  .session-selector { margin-bottom: 25px; }
  .limit-grid { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
  .limit-btn { flex: 1; min-width: 60px; background: #0f172a; border: 1px solid #334155; color: #8C9BAB; padding: 10px; border-radius: 10px; cursor: pointer; font-weight: 700; font-size: 0.8rem; }
  .limit-btn.selected { border-color: #2dd4bf; color: #2dd4bf; background: rgba(45, 212, 191, 0.05); }
  
  .custom-limit-wrapper { flex: 1; min-width: 60px; }
  .limit-input { width: 100%; background: #0f172a; border: 1px solid #334155; color: #fff; padding: 9px; border-radius: 10px; text-align: center; font-weight: 700; font-size: 0.8rem; outline: none; box-sizing: border-box; transition: all 0.2s; }
  /* Hide native number input arrows for design consistency */
  .limit-input::-webkit-outer-spin-button,
  .limit-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  .limit-input { -moz-appearance: textfield; }
  .limit-input.active { border-color: #2dd4bf; background: rgba(45, 212, 191, 0.05); color: #2dd4bf; }
  
  .btn-start-session { width: 100%; background: #2dd4bf; color: #0a0e17; border: none; padding: 16px; border-radius: 14px; font-weight: 800; font-size: 1rem; cursor: pointer; transition: transform 0.2s; }
  .btn-start-session:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(45, 212, 191, 0.3); }
  .btn-start-session:active { transform: translateY(0); }

  .btn-review-struggled { width: 100%; background: transparent; color: #ef4444; border: 2px solid #ef4444; padding: 14px; border-radius: 14px; font-weight: 800; font-size: 0.9rem; cursor: pointer; margin-top: 10px; transition: all 0.2s; }
  .btn-review-struggled:hover { background: rgba(239, 68, 68, 0.1); }


  /* AUDIO BUTTON STYLES */
  .top-right-audio { position: absolute; top: 15px; right: 15px; z-index: 10; }
  .btn-audio-play-blended { background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.7); border-radius: 50%; width: 40px; height: 40px; font-size: 1rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
  .btn-audio-play-blended.is-playing { background: rgba(45, 212, 191, 0.2); border-color: #2dd4bf; color: #2dd4bf; }
  .btn-audio-play-blended:hover { background: rgba(255, 255, 255, 0.15); color: #fff; }

  .audio-management-list { background: rgba(0,0,0,0.2); padding: 10px; border-radius: 12px; margin-top: 5px; }
  .audio-row { display: flex; align-items: center; justify-content: space-between; padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .audio-row:last-child { border-bottom: none; }
  .audio-row.is-active-slot { background: rgba(45, 212, 191, 0.05); border-radius: 8px; }
  .slot-select-indicator { background: none; border: none; color: #8C9BAB; font-size: 0.75rem; font-weight: bold; cursor: pointer; text-align: left; width: 70px; }
  .audio-actions { display: flex; gap: 8px; }
  .action-btn { width: 32px; height: 32px; border-radius: 8px; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 0.9rem; }
  .rec-start { background: #334155; color: white; }
  .rec-stop { background: #ef4444; color: white; animation: pulse 1s infinite; }
  .act-play { background: #2dd4bf; color: #0f172a; }
  .act-play.pulse { animation: pulse 1.5s infinite; }

  @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }

  /* MODAL STYLES */
  .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .modal-content { background: #1e293b; padding: 16px 24px 24px; border-radius: 20px; width: 90%; max-width: 400px; text-align: left; border: 1px solid rgba(255,255,255,0.1); }
  
  .modal-tabs { border-bottom: 1px solid rgba(255, 255, 255, 0.05); display: flex; gap: 10px; margin-bottom: 20px; padding-bottom: 10px; }
  .tab-btn { background: transparent; border: none; color: #8C9BAB; cursor: pointer; font-size: 0.8rem; font-weight: 800; letter-spacing: 1px; padding: 5px 0; text-transform: uppercase; }
  .tab-btn.active { border-bottom: 2px solid #2dd4bf; color: #2dd4bf; }
  
  .modal-scroll-area { max-height: 60vh; overflow-y: auto; padding-right: 8px; }
  /* Styled scrollbar for the modal */
  .modal-scroll-area::-webkit-scrollbar { width: 6px; }
  .modal-scroll-area::-webkit-scrollbar-track { background: #0f172a; border-radius: 10px; }
  .modal-scroll-area::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 10px; border: 1px solid #334155; }
  .modal-scroll-area::-webkit-scrollbar-thumb:hover { background: #2dd4bf; }

  .modal-input-group label { display: block; font-size: 0.75rem; color: #8C9BAB; margin-top: 12px; }
  .modal-input-group label.first-label { margin-top: 0; }
  .modal-input-group input, .modal-input-group textarea { width: 100%; background: #0f172a; border: 1px solid #334155; color: white; padding: 10px; margin-top: 4px; border-radius: 8px; box-sizing: border-box; }
  
  .toggle-switch-row { display: flex; gap: 8px; margin-top: 8px; }
  .choice-btn { flex: 1; background: #0f172a; border: 1px solid #334155; color: #8C9BAB; padding: 10px; border-radius: 10px; cursor: pointer; font-weight: 700; transition: all 0.2s; }
  .choice-btn.active { background: rgba(45, 212, 191, 0.1); border-color: #2dd4bf; color: #2dd4bf; }
  .deck-notes-area { min-height: 120px; font-size: 0.85rem; line-height: 1.4; color: #cbd5e1 !important; }
  
  .timer-toggle-row { display: flex; align-items: center; justify-content: space-between; margin-top: 20px; background: rgba(0,0,0,0.2); padding: 12px; border-radius: 12px; }
  .timer-toggle-btn { background: #334155; color: white; border: none; padding: 8px 16px; border-radius: 8px; font-weight: 700; font-size: 0.7rem; cursor: pointer; }
  .timer-toggle-btn.on { background: #2dd4bf; color: #0f172a; }

  .tag-selection-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .selection-chip { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); color: #475569; padding: 5px 10px; border-radius: 8px; font-size: 0.7rem; font-weight: 700; cursor: pointer; text-transform: uppercase; }
  .selection-chip.active { background: rgba(0,0,0,0.3); border-color: var(--active-color); color: var(--active-color); }
  .modal-actions { display: flex; gap: 10px; margin-top: 24px; }
  .btn-save-modal { flex: 1; background: #2dd4bf; border: none; padding: 12px; border-radius: 10px; font-weight: 700; color: #0a0e17; cursor: pointer; transition: all 0.2s ease; }
  .btn-save-modal.status-success { background: #10b981; color: white; }
  .btn-cancel { flex: 1; background: transparent; color: white; border: 1px solid #334155; padding: 12px; border-radius: 10px; cursor: pointer; }
</style>