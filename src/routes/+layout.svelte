<script>
  import "../app.css";
  import { writable } from 'svelte/store';
  import Dashboard from '$lib/components/Dashboard.svelte';
  import Study from '$lib/components/Study.svelte';
  import AddNew from '$lib/components/addnew.svelte';
  import TagDecks from '$lib/components/tagDecks.svelte';
  import Settings from '$lib/components/Settings.svelte';

  console.log("Fledge App is hydrated and ready!");


  const currentScreen = writable('dashboard');
  const navigationParams = writable({});

  /** @param {string} screen */
  function handleNavigate(screen, params = {}) {
    navigationParams.set(params);
    currentScreen.set(screen);
    if (browser) {
      window.scrollTo(0, 0);
    }
  }
</script>

<div class="app-shell">
  {#if $currentScreen === 'dashboard'}
    <header class="pika-header">
      <div class="header-content">
        <div class="spacer"></div>
        <button class="title-link" on:click={() => handleNavigate('dashboard')}>
          <h1 class="app-title">Fledge</h1>
        </button>
        <div class="spacer"></div>
      </div>
    </header>
  {/if}

    <main class="content-container {$currentScreen !== 'dashboard' ? 'no-padding' : ''}">
      {#if $currentScreen === 'dashboard'}
        <Dashboard onNavigate={handleNavigate} />
      {:else if $currentScreen === 'study'}
        <Study onNavigate={handleNavigate} params={$navigationParams} /> 
      {:else if $currentScreen === 'add-card'}
        <AddNew onNavigate={handleNavigate} />
      {:else if $currentScreen === 'decks'}
        <TagDecks onNavigate={handleNavigate} />
      {:else if $currentScreen === 'settings'}
        <Settings onNavigate={handleNavigate} />
      {/if}
     <slot />   
  </main>
</div>

<style>
  .app-shell { 
    min-height: 100vh; 
    display: flex; 
    flex-direction: column; 
    background-color: var(--midnight-blue); 
  }
  
  .pika-header {
    height: 70px;
    background-color: var(--midnight-blue);
    border-bottom: 1px solid rgba(140, 155, 171, 0.1);
    display: flex;
    align-items: center;
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .header-content {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    max-width: 600px;
    margin: 0 auto;
    padding: 0 20px;
  }

  .title-link {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: center;
  }

  .app-title {
    color: var(--vibrant-teal);
    font-size: 1.1rem;
    font-weight: 800;
    letter-spacing: 2px;
    text-transform: uppercase;
    margin: 0;
  }

  .spacer { width: 44px; }

  /* BASE CENTERED COLUMN */
  main {
    flex: 1;
    padding: 20px;
    max-width: 600px; /* Limits width on desktop */
    margin: 0 auto;   /* Centers the column */
    width: 100%;
    box-sizing: border-box;
    transition: max-width 0.3s ease;
  }

  /* FOR SETTINGS/STUDY: Removes side padding but STAYS centered */
  .no-padding { 
    padding: 10px 0; /* Minimal top/bottom padding, zero sides */
  }

  /* SMALL SCREEN ADJUSTMENTS */
  @media (max-width: 480px) {
    main {
      padding: 15px 12px; /* Tighter padding for mobile */
    }
    
    .no-padding {
      padding: 0; /* True edge-to-edge for mobile */
    }

    .app-title {
      font-size: 1rem;
      letter-spacing: 1.5px;
    }

    .pika-header {
      height: 60px;
    }
  }

  /* LARGE SCREEN ADJUSTMENT (Optional: makes it feel more like an app) */
  @media (min-width: 1024px) {
    main {
      max-width: 550px; /* Slightly tighter column for better readability */
    }
  }
</style>