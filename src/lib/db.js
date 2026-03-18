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
  }
};