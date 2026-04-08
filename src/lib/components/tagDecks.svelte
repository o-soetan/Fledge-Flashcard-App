<script>
  import { onMount } from 'svelte';
  import { db } from '$lib/db';

  let { onNavigate } = $props();

  let allCards = $state([]);
  let tagStats = $state([]); // Array of { name: string, count: number }
  let searchTerm = $state("");

  async function loadTagData() {
    const database = await db.init();
    const transaction = database.transaction(['customCards'], 'readonly');
    const store = transaction.objectStore('customCards');
    const request = store.getAll();

    request.onsuccess = () => {
      allCards = request.result;
      
      // Calculate counts for every tag found across all cards
      const counts = {};
      allCards.forEach(card => {
        if (card.tags && Array.isArray(card.tags)) {
          card.tags.forEach(tag => {
            counts[tag] = (counts[tag] || 0) + 1;
          });
        }
      });

      // Convert to sorted array (most used first)
      tagStats = Object.entries(counts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
    };
  }

  onMount(loadTagData);

  let filteredTags = $derived(tagStats.filter(tag => 
    tag.name.toLowerCase().includes(searchTerm.toLowerCase())
  ));
</script>

<div class="tag-decks-container">
  <header class="header-row">
    <button class="btn-exit-screenshot" onclick={() => onNavigate('dashboard')}>
      ←
    </button>
    <h2 class="title">Tag Decks</h2>
  </header>

  <div class="search-section">
    <div class="search-bar">
      <input 
        type="text" 
        placeholder="Search tags (e.g. NOUN, Slang)..." 
        bind:value={searchTerm}
      />
      <span class="search-icon">🔍</span>
    </div>
  </div>

  <main class="tags-grid">
    {#each filteredTags as tag}
      <button class="tag-tile" onclick={() => onNavigate('study', { filterTag: tag.name })}>
        <div class="tag-info">
          <span class="tag-name">#{tag.name}</span>
          <span class="tag-count">{tag.count} {tag.count === 1 ? 'card' : 'cards'}</span>
        </div>
        <span class="arrow-mini">→</span>
      </button>
    {:else}
      <div class="empty-state">
        <p>No tags found matching "{searchTerm}"</p>
      </div>
    {/each}
  </main>
</div>

<style>
  .tag-decks-container {
    max-width: 500px;
    margin: 0 auto;
    padding: 10px;
    color: white;
  }

  .header-row {
    display: flex;
    align-items: center;
    gap: 20px;
    margin-bottom: 25px;
    padding: 0 5px;
  }

  .title {
    margin: 0;
    font-size: 1.4rem;
    font-weight: 800;
  }

  /* Glass Squircle Exit Button from your screenshot */
  .btn-exit-screenshot {
    width: 48px;
    height: 48px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #8C9BAB;
    font-size: 1.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s;
  }

  .search-section {
    margin-bottom: 25px;
  }

  .search-bar {
    display: flex;
    align-items: center;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    padding: 0 15px;
  }

  .search-bar input {
    flex: 1;
    background: none;
    border: none;
    color: white;
    padding: 14px 0;
    outline: none;
    font-size: 0.95rem;
  }

  .search-icon { opacity: 0.4; }

  .tags-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .tag-tile {
    background: var(--dark-navy, #0f172a);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 18px;
    padding: 18px 22px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
    text-align: left;
    transition: transform 0.2s, border-color 0.2s;
  }

  .tag-tile:active {
    transform: scale(0.98);
    border-color: var(--vibrant-teal, #2dd4bf);
  }

  .tag-name {
    display: block;
    font-weight: 700;
    font-size: 1.1rem;
    color: var(--vibrant-teal, #2dd4bf);
    margin-bottom: 4px;
  }

  .tag-count {
    font-size: 0.85rem;
    color: #8C9BAB;
  }

  .arrow-mini {
    color: #8C9BAB;
    font-weight: bold;
    opacity: 0.5;
  }

  .empty-state {
    text-align: center;
    padding: 40px;
    color: #8C9BAB;
  }
</style>