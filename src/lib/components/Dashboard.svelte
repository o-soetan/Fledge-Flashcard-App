<script>
  import { onMount } from 'svelte';
  import { db } from '$lib/db';

  let { onNavigate } = $props();
  let searchTerm = $state("");
  let deckStats = $state([]); 
  let allCards = $state([]);

  async function loadExistingDecks() {
    const database = await db.init();
    const transaction = database.transaction(['customCards'], 'readonly');
    const store = transaction.objectStore('customCards');
    const request = store.getAll();
    
    request.onsuccess = () => {
      allCards = request.result;
      
      // Calculate real counts for each deck
      const counts = allCards.reduce((acc, card) => {
        const deckName = card.deck || 'General';
        acc[deckName] = (acc[deckName] || 0) + 1;
        return acc;
      }, {});

      deckStats = Object.entries(counts).map(([name, count]) => ({
        name,
        count
      }));
    };
  }

  onMount(loadExistingDecks);

  // Advanced search logic: Finds decks by name OR by content inside them
  let filteredDecks = $derived.by(() => {
    if (!searchTerm.trim()) return deckStats;

    // Create a regex for "whole word" matching to isolate articles
    // This ensures 'un' doesn't match 'lundi'
    const boundaryRegex = new RegExp(`\\b${searchTerm.trim()}\\b`, 'i');

    // Find which decks contain cards that match the search
    const decksWithMatchingCards = new Set(
      allCards
        .filter(c => boundaryRegex.test(c.french) || boundaryRegex.test(c.english))
        .map(c => c.deck || 'General')
    );

    return deckStats.filter(deck => 
      deck.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
      decksWithMatchingCards.has(deck.name)
    );
  });
</script>

<div class="dashboard-wrapper">
  <header class="search-container">
    <div class="search-bar">
      <input 
        type="text" 
        placeholder="Search cards or decks..." 
        bind:value={searchTerm}
      />
      <span class="search-icon">🔍</span>
    </div>
  </header>

  <main class="content-area">
    <section class="deck-section">
      <h2 class="section-label">Decks</h2>
      <div class="scroll-container">
        {#each filteredDecks as deck}
          <button class="deck-card" onclick={() => onNavigate('study', { deck: deck.name })}>
            <div class="deck-info">
              <span class="deck-name">{deck.name}</span>
              <span class="deck-count">{deck.count} {deck.count === 1 ? 'Card' : 'Cards'}</span>
            </div>
            <span class="arrow">→</span>
          </button>
        {:else}
          <p class="empty-msg">No decks found matching "{searchTerm}"</p>
        {/each}
      </div>
    </section>
  </main>

  <footer class="bottom-nav">
    <button class="nav-item active" onclick={() => onNavigate('dashboard')}>
      <span class="icon">🏠</span>
      <span class="label">Home</span>
    </button>
    
    <button class="nav-item" onclick={() => onNavigate('add-card')}>
      <span class="icon">➕</span>
      <span class="label">Add New</span>
    </button>
    
    <button class="nav-item" onclick={() => onNavigate('decks')}>
      <span class="icon">🗂️</span>
      <span class="label">Tag Decks</span>
    </button>
    
    <button class="nav-item" onclick={() => onNavigate('settings')}>
      <span class="icon">⚙️</span>
      <span class="label">Settings</span>
    </button>
  </footer>
</div>

<style>
  .dashboard-wrapper {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  .search-container {
    padding: 15px 20px;
    position: sticky;
    top: 0;
    background: var(--midnight-blue);
    z-index: 10;
  }

  .search-bar {
    display: flex;
    align-items: center;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 0 15px;
  }

  .search-bar input {
    flex: 1;
    background: none;
    border: none;
    color: white;
    padding: 12px 0;
    outline: none;
    font-size: 0.9rem;
  }

  .search-icon { opacity: 0.5; }

  .content-area {
    flex: 1;
    overflow-y: auto;
    padding: 10px 20px 100px;
  }

  .section-label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--vibrant-teal);
    margin: 20px 0 15px;
    font-weight: 800;
  }

  .deck-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    padding: 20px;
    margin-bottom: 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
    width: 100%;
    text-align: left;
    font-family: inherit;
    color: inherit;
  }

  .deck-name { display: block; font-weight: 600; font-size: 1.1rem; }
  .deck-count { font-size: 0.8rem; color: var(--text-gray); margin-top: 4px; display: block; }
  .arrow { color: var(--vibrant-teal); font-weight: bold; }

  .bottom-nav {
    height: 80px;
    background: rgba(15, 23, 42, 0.95);
    backdrop-filter: blur(10px);
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    position: fixed;
    bottom: 0;
    width: 100%;
    max-width: 600px;
  }

  .nav-item {
    background: none;
    border: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 5px;
    color: var(--text-gray);
    cursor: pointer;
  }

  .nav-item .icon { font-size: 1.2rem; }
  .nav-item .label { font-size: 0.65rem; font-weight: 600; }
  .nav-item.active { color: var(--vibrant-teal); }
  .empty-msg { text-align: center; color: var(--text-gray); margin-top: 40px; }
</style>