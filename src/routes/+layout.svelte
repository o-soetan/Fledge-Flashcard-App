<script>
  import "../app.css";
  import { browser } from '$app/environment';
  import { onMount } from 'svelte'; // Added onMount
  import { writable } from 'svelte/store';
  import Dashboard from '$lib/components/Dashboard.svelte';
  import Study from '$lib/components/Study.svelte';
  import AddNew from '$lib/components/addnew.svelte';
  import TagDecks from '$lib/components/tagDecks.svelte';
  import Settings from '$lib/components/Settings.svelte';
  import Account from "$lib/components/Account.svelte";
  
  console.log("Fledge App is hydrated and ready!");

  const currentScreen = writable('dashboard');
  const navigationParams = writable({});

  // Vault State logic
  let vaultStatus = 'Locked';
  let userHash = '';

  function updateActivity() {
    if (browser && localStorage.getItem('fledge_user_id')) {
      localStorage.setItem('fledge_last_active', Date.now().toString());
    }
  }

  onMount(() => {
    const savedUser = localStorage.getItem('fledge_user_id');
    if (savedUser) {
      vaultStatus = 'Synced';
      userHash = savedUser.substring(0, 8);
      updateActivity();
    }

    window.addEventListener('mousemove', updateActivity);
    window.addEventListener('keydown', updateActivity);
    window.addEventListener('click', updateActivity);

    return () => {
      window.removeEventListener('mousemove', updateActivity);
      window.removeEventListener('keydown', updateActivity);
      window.removeEventListener('click', updateActivity);
    };
  });

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
        
        <button class="vault-mini-btn" on:click={() => handleNavigate('account')}>
          <span class="v-icon-mini">{vaultStatus === 'Synced' ? '🔓' : '🔒'}</span>
          <div class="v-text-mini">
            <span class="v-title-mini">{vaultStatus === 'Synced' ? 'Synced' : 'Vault'}</span>
            {#if userHash}<span class="v-id-mini">{userHash}</span>{/if}
          </div>
        </button>
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
      {:else if $currentScreen === 'account'}
    <Account onNavigate={handleNavigate} />
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

  /* Vault Button Styles */
  .vault-mini-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    text-decoration: none;
    transition: all 0.2s;
    min-width: 44px;
    cursor: pointer;
  }

  .vault-mini-btn:hover {
    background: rgba(255, 255, 255, 0.07);
    border-color: var(--vibrant-teal);
  }

  .v-icon-mini { font-size: 0.8rem; }
  .v-text-mini { display: flex; flex-direction: column; line-height: 1; }
  
  .v-title-mini { 
    font-size: 0.55rem; 
    font-weight: 800; 
    color: var(--vibrant-teal); 
    text-transform: uppercase;
  }

  .v-id-mini {
    font-size: 0.5rem;
    font-family: ui-monospace, monospace;
    color: #8C9BAB;
    margin-top: 2px;
  }

  /* BASE CENTERED COLUMN */
  main {
    flex: 1;
    padding: 20px;
    max-width: 600px; 
    margin: 0 auto;   
    width: 100%;
    box-sizing: border-box;
    transition: max-width 0.3s ease;
  }

  .no-padding { 
    padding: 10px 0; 
  }

  @media (max-width: 480px) {
    main {
      padding: 15px 12px; 
    }
    
    .no-padding {
      padding: 0; 
    }

    .app-title {
      font-size: 1rem;
      letter-spacing: 1.5px;
    }

    .pika-header {
      height: 60px;
    }
  }

  @media (min-width: 1024px) {
    main {
      max-width: 550px; 
    }
  }
</style>