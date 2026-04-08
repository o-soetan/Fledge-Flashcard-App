<script>
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { db } from '$lib/db';
  import { generatePassphrase, encryptData, decryptData, deriveLockerId } from '$lib/crypto';

  let { onNavigate } = $props();

  // State
  let step = $state('init'); // init, generate, active
  let email = $state('');
  let recoveryPhrase = $state('');
  let userID = $state('');
  let syncToken = $state('');
  let isCopying = $state(false);
  let showLogin = $state(false); // Toggle between Create and Link
  let loginPhrase = $state('');
  let isSyncing = $state(false);
  let syncStatus = $state('');
  let showPhrase = $state(false);

  onMount(async () => {
    const savedID = localStorage.getItem('fledge_user_id');
    const savedPhrase = localStorage.getItem('fledge_vault_phrase');
    const savedToken = localStorage.getItem('fledge_sync_token');

    if (savedID && savedPhrase) {
      userID = savedID;
      recoveryPhrase = savedPhrase;
      if (savedToken) {
        syncToken = savedToken;
      } else {
        // Heal legacy account by generating the missing token
        syncToken = await deriveLockerId(savedPhrase + "-auth-salt");
        localStorage.setItem('fledge_sync_token', syncToken);
      }
      step = 'active';
    }
  });

  async function generateVault() {
    let generated;
    try {
      // 1. Generate secure phrase with high entropy
      generated = generatePassphrase(12);
      
      if (!generated) {
        return alert("Failed to generate a recovery phrase. Please check your connection or refresh.");
      }
    } catch (error) {
      console.error("Error generating passphrase:", error);
      return alert("Failed to generate recovery phrase due to an internal error. See console for details.");
    }
    
    // 2. Derive User ID from the phrase
    const hashHex = await deriveLockerId(generated);
    
    userID = hashHex;
    // Set the phrase last to ensure it's ready for display
    recoveryPhrase = generated;
    step = 'generate';
  }

  async function confirmAndActivate() {
    localStorage.setItem('fledge_user_id', userID);
    localStorage.setItem('fledge_vault_phrase', recoveryPhrase);
    step = 'active';
    await handleManualSync(); // React to the cloud immediately on activation
  }

  async function handleLinkExisting() {
    // Normalize input: replace spaces with hyphens and trim
    const cleanPhrase = loginPhrase.trim().toLowerCase().replace(/\s+/g, '-');
    const wordCount = cleanPhrase.split('-').filter(w => w.length > 0).length;

    if (wordCount < 12) {
      return alert("Please enter your full 12-word phrase.");
    }

    isSyncing = true;
    syncStatus = "Deriving ID...";

    const derivedID = await deriveLockerId(cleanPhrase);

    try {
      syncStatus = "Downloading vault...";
      const res = await fetch('/api/locker', {
        headers: {
          'x-locker-id': derivedID
        }
      });
      
      if (res.ok) {
        const { encryptedData } = await res.json();
        syncStatus = "Decrypting data...";
        const cards = await decryptData(encryptedData, cleanPhrase);
        
        syncStatus = "Importing library...";
        await db.importCards(cards);
      } else if (res.status === 404) {
        console.log("No cloud data found for this ID, starting fresh.");
      } else {
        throw new Error("Cloud connection failed.");
      }

      localStorage.setItem('fledge_user_id', derivedID);
      localStorage.setItem('fledge_vault_phrase', cleanPhrase);
      userID = derivedID;
      recoveryPhrase = cleanPhrase;
      step = 'active';
    } catch (e) {
      alert("Linking failed: " + e.message);
    } finally {
      isSyncing = false;
      syncStatus = "";
    }
  }

  async function handleManualSync() {
    if (!userID || !recoveryPhrase || isSyncing) return;
    
    isSyncing = true;
    syncStatus = "Preparing data...";

    try {
      const database = await db.init();
      
      // Wrap IndexedDB request in a Promise for modern async/await usage
      const allCards = await new Promise((resolve, reject) => {
        const transaction = database.transaction(['customCards'], 'readonly');
        const store = transaction.objectStore('customCards');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      syncStatus = "Encrypting...";
      const encryptedData = await encryptData(allCards, recoveryPhrase);
      
      syncStatus = "Uploading...";
      const res = await fetch('/api/locker', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-locker-id': userID
        },
        body: JSON.stringify({ encryptedData })
      });

      if (!res.ok) throw new Error("Cloud upload failed");
      
      syncStatus = "Sync Success!";
      setTimeout(() => {
        isSyncing = false;
        syncStatus = "";
      }, 2000);
    } catch (e) {
      console.error("Sync Error:", e);
      alert("Sync failed: " + e.message);
      isSyncing = false;
      syncStatus = "";
    }
  }

  async function handleDeleteAccount() {
    const firstConfirm = confirm("CRITICAL: This will permanently delete your cloud backup. This cannot be undone. Proceed?");
    if (!firstConfirm) return;
    
    const secondConfirm = confirm("Are you absolutely sure? All vocabulary cards on the server and this device will be wiped.");
    if (!secondConfirm) return;

    try {
      isSyncing = true;
      syncStatus = "Wiping cloud...";
      const res = await fetch('/api/locker', {
        method: 'DELETE',
        headers: {
          'x-locker-id': userID
        }
      });

      if (!res.ok) throw new Error("Server failed to delete vault");

      await db.clearAll();
      localStorage.removeItem('fledge_user_id');
      localStorage.removeItem('fledge_vault_phrase');
      window.location.href = '/';
    } catch (e) {
      alert("Deletion failed: " + e.message);
    } finally {
      isSyncing = false;
      syncStatus = "";
    }
  }

  async function copyPhrase() {
    if (!recoveryPhrase) return;
    
    try {
      await navigator.clipboard.writeText(recoveryPhrase);
      isCopying = true;
      setTimeout(() => isCopying = false, 2000);
    } catch (err) {
      // Fallback for non-secure contexts (HTTP instead of HTTPS)
      const textArea = document.createElement("textarea");
      textArea.value = recoveryPhrase;
      document.body.appendChild(textArea);
      textArea.select();
      const successful = document.execCommand('copy');
      if (successful) isCopying = true;
      document.body.removeChild(textArea);
      setTimeout(() => isCopying = false, 2000);
    }
  }

  async function handleLogout() {
    if (confirm("This will disable cloud sync and remove all local data from this device. Your recovery phrase is required to log back in. Continue?")) {
      await db.clearAll();
      localStorage.removeItem('fledge_user_id');
      localStorage.removeItem('fledge_vault_phrase');
      window.location.href = '/';
    }
  }
</script>

<div class="account-container">
  <div class="nav-header">
    <button onclick={() => onNavigate('dashboard')} class="btn-icon btn-exit-styled">←</button>
  </div>

  {#if step === 'active'}
    <button class="logout-btn-top" onclick={handleLogout} title="Log Out">
      Log Out 🚪
    </button>
  {/if}

  {#if step === 'init'}
    <div class="hero-section">
      <div class="vault-icon-large">{showLogin ? '🔑' : '🔒'}</div>
      <h1>{showLogin ? 'Link Existing Vault' : 'Create New Account'}</h1>
      <p>{showLogin ? 'Enter your credentials to sync this device.' : 'Your data is encrypted locally before it ever leaves your device.'}</p>
      
      <div class="setup-box">
        {#if !showLogin}
          <input type="email" bind:value={email} placeholder="Email (optional communications)..." class="vault-input" />
          <button class="btn-primary" onclick={generateVault}>Create Account</button>
          <button class="btn-ghost" onclick={() => showLogin = true}>Already have a vault? Link it</button>
        {:else}
          <div class="input-group-alt">
            <label for="loginPhrase">Recovery Phrase</label>
            <input id="loginPhrase" bind:value={loginPhrase} placeholder="word-word-word..." class="vault-input" />
          </div>
          <button class="btn-primary" onclick={handleLinkExisting} disabled={isSyncing}>
            {#if isSyncing}
              {syncStatus}
            {:else}
              Link & Sync
            {/if}
          </button>
          <button class="btn-ghost" onclick={() => showLogin = false}>Back to Create Account</button>
        {/if}
      </div>
    </div>

  {:else if step === 'generate'}
    <div class="setup-section">
      <h2 class="warning-title">⚠️ Save Your Recovery Phrase</h2>
      <p class="warning-text">This 12-word phrase is your <strong>only</strong> way to access your data on other devices. We do not store this; if you lose it, your data cannot be recovered.</p>
      
      <div class="phrase-display">
        <code>{recoveryPhrase}</code>
        <button class="btn-copy-mini" onclick={copyPhrase} title="Copy Phrase">{isCopying ? '✅' : '📋'}</button>
      </div>

      <button class="btn-confirm" onclick={confirmAndActivate}>I have saved this phrase</button>
    </div>

  {:else if step === 'active'}
    <div class="active-section">
      <div class="status-badge">● Vault Active</div>
      <div class="id-card">
        <span class="id-label">Cloud User ID</span>
        <code>{userID.substring(0, 16)}...</code>
      </div>

      {#if showPhrase}
        <div class="phrase-display">
          <code>{recoveryPhrase}</code>
          <button class="btn-copy-mini" onclick={copyPhrase} title="Copy Phrase">{isCopying ? '✅' : '📋'}</button>
        </div>
      {/if}

      <div class="action-grid">
        <button class="btn-action" onclick={handleManualSync} disabled={isSyncing}>
          <span class="icon">{isSyncing ? '⌛' : '🔄'}</span>
          <div class="label">
            {#if isSyncing}{syncStatus}{:else}Manual Sync{/if}
          </div>
        </button>

        <button class="btn-action" onclick={() => showPhrase = !showPhrase}>
          <span class="icon">{showPhrase ? '🙈' : '👁️'}</span>
          <div class="label">{showPhrase ? 'Hide Phrase' : 'Show Phrase'}</div>
        </button>
      </div>

      <div class="danger-zone">
        <button class="btn-delete-account" onclick={handleDeleteAccount} disabled={isSyncing}>
          {isSyncing ? syncStatus : 'Delete Cloud Vault & Local Data'}
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .account-container { max-width: 500px; margin: 0 auto; padding: 20px; color: white; position: relative; }
  .nav-header { margin-bottom: 40px; }
  
  /* Styles copied from Study.svelte for consistency */
  .btn-icon { 
    background: rgba(255,255,255,0.03); 
    border: 1px solid rgba(255,255,255,0.08); 
    border-radius: 12px; 
    padding: 8px 12px; 
    cursor: pointer; 
    color: white; 
    font-size: 1rem; 
    display: inline-flex; 
    align-items: center; 
    justify-content: center; 
    transition: all 0.2s ease; 
  }
  .btn-icon:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.2); }
  .btn-exit-styled { color: #8C9BAB; }
  
  .logout-btn-top {
    position: absolute;
    top: 20px;
    right: 20px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: 12px;
    padding: 8px 16px;
    color: #ef4444;
    font-size: 0.8rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .logout-btn-top:hover { background: rgba(239, 68, 68, 0.2); border-color: #ef4444; }

  .hero-section, .setup-section, .active-section { text-align: center; }
  .vault-icon-large { font-size: 3rem; margin-bottom: 20px; transition: transform 0.3s ease; }
  
  h1 { font-size: 1.5rem; margin-bottom: 10px; }
  p { color: #8C9BAB; font-size: 0.9rem; line-height: 1.5; margin-bottom: 30px; }

  .setup-box { display: flex; flex-direction: column; gap: 12px; }
  .input-group-alt { text-align: left; display: flex; flex-direction: column; gap: 6px; }
  .input-group-alt label { font-size: 0.7rem; color: #475569; text-transform: uppercase; font-weight: 800; margin-left: 4px; }
  .vault-input { background: #1e293b; border: 1px solid #334155; padding: 14px; border-radius: 12px; color: white; outline: none; }
  .vault-input:focus { border-color: #2dd4bf; }
  
  .btn-primary, .btn-confirm { background: #2dd4bf; color: #0f172a; border: none; padding: 14px; border-radius: 12px; font-weight: 800; cursor: pointer; }
  
  .warning-title { color: #fbbf24; }
  .phrase-display { background: #070b14; border: 1px solid #334155; padding: 16px; border-radius: 12px; margin: 20px 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; text-align: left; }
  .phrase-display code { color: #2dd4bf; font-family: ui-monospace, monospace; font-size: 1rem; line-height: 1.4; word-break: break-word; }
  
  .btn-copy-mini { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); color: white; padding: 8px; border-radius: 8px; cursor: pointer; flex-shrink: 0; transition: all 0.2s; font-size: 1.1rem; line-height: 1; }
  .btn-copy-mini:hover { background: rgba(255, 255, 255, 0.1); border-color: #2dd4bf; }
  .btn-copy-mini:active { transform: scale(0.92); }

  .status-badge { display: inline-block; padding: 6px 12px; background: rgba(16, 185, 129, 0.1); color: #10b981; border-radius: 20px; font-size: 0.7rem; font-weight: 800; margin-bottom: 20px; }
  .id-card { background: #1e293b; padding: 15px; border-radius: 12px; text-align: left; margin-bottom: 30px; }
  .id-card .id-label { display: block; font-size: 0.6rem; color: #475569; text-transform: uppercase; font-weight: 800; }
  .id-card code { color: #8C9BAB; font-size: 0.8rem; }

  .action-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .btn-action { background: #1e293b; border: 1px solid #334155; padding: 20px; border-radius: 16px; color: white; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .btn-action .icon { font-size: 1.2rem; }
  .btn-action .label { font-size: 0.75rem; font-weight: 700; color: #8C9BAB; }

  .btn-ghost { background: none; border: none; color: #2dd4bf; font-size: 0.8rem; cursor: pointer; margin-top: 10px; text-decoration: underline; opacity: 0.8; }

  .danger-zone { margin-top: 40px; padding-top: 20px; border-top: 1px solid rgba(239, 68, 68, 0.1); }
  .btn-delete-account { 
    background: none; border: 1px solid rgba(239, 68, 68, 0.3); color: #ef4444; 
    padding: 12px; border-radius: 12px; font-size: 0.75rem; font-weight: 700; 
    cursor: pointer; width: 100%; transition: all 0.2s;
  }
  .btn-delete-account:hover:not(:disabled) { background: rgba(239, 68, 68, 0.1); border-color: #ef4444; }
  .btn-delete-account:disabled { opacity: 0.5; cursor: wait; }
</style>