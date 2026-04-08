// src/lib/db.js
// This creates the "customCards" storage area in your browser
import { browser } from '$app/environment';

const DB_NAME = 'FrenchTravelDB';
const DB_VERSION = 2;

export const db = {
  async init() {
    // Guard against server-side execution
    if (!browser) return null;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        // Creating the store for your custom words
        if (!db.objectStoreNames.contains('customCards')) {
          db.createObjectStore('customCards', { keyPath: 'id' });
        }
      };
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = () => reject(request.error);
    });
  },

  async addCard(card) {
    if (!browser) return;
    const database = await this.init();
    if (!database) return; // DB not available if init was blocked
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(['customCards'], 'readwrite');
      const store = transaction.objectStore('customCards');
      // Ensure every card has a unique ID for syncing.
      if (!card.id) card.id = crypto.randomUUID();
      store.add(card);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  },

  async getAllCards() {
    if (!browser) return [];
    const database = await this.init();
    if (!database) return [];
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(['customCards'], 'readonly');
      const store = transaction.objectStore('customCards');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async importCards(cards) {
    if (!browser) return;
    const database = await this.init();
    if (!database) return;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(['customCards'], 'readwrite');
      const store = transaction.objectStore('customCards');
      // .put() updates if key exists, adds if it doesn't
      cards.forEach(card => {
        if (!card.id) card.id = crypto.randomUUID();
        store.put(card);
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  },

  async clearAll() {
    if (!browser) return;
    const database = await this.init();
    if (!database) return;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(['customCards'], 'readwrite');
      const store = transaction.objectStore('customCards');
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  // --- CLOUD SYNC METHODS ---

  /**
   * Downloads the "suitcase" from the cloud and merges it with local IndexedDB
   */
  async syncWithCloud(lockerId, syncToken) {
    if (!browser || !lockerId || !syncToken) return;
    try {
      console.log(`[DB] Syncing with cloud for user: ${lockerId}`);
      const response = await fetch('/api/locker', {
        headers: {
          'x-locker-id': lockerId,
          'x-sync-token': syncToken
        }
      });
      
      if (!response.ok) {
        if (response.status === 404) console.log('[DB] No cloud data found for this user yet.');
        return;
      }

      const { encryptedData } = await response.json();
      if (encryptedData) {
        // Parse the suitcase. In a production app, you'd decrypt this first.
        const remoteCards = JSON.parse(encryptedData);
        await this.importCards(remoteCards);
        console.log(`[DB] Successfully synced ${remoteCards.length} cards from cloud.`);
      }
    } catch (err) {
      console.error('[DB] Cloud sync failed:', err);
    }
  },

  /**
   * Uploads the entire local collection to the cloud locker
   */
  async pushToCloud(cardIgnored, lockerId, syncToken) {
    if (!browser || !lockerId || !syncToken) return;
    try {
      const allCards = await this.getAllCards();
      await fetch('/api/locker', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-locker-id': lockerId,
          'x-sync-token': syncToken
        },
        body: JSON.stringify({
          encryptedData: JSON.stringify(allCards)
        })
      });
      console.log('[DB] Suitcase uploaded to cloud.');
    } catch (err) {
      console.error('[DB] Cloud push failed:', err);
    }
  }
};