// src/lib/db.js
// This creates the "customCards" storage area in your browser

const DB_NAME = 'FrenchTravelDB';
const DB_VERSION = 1;

export const db = {
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        // Creating the store for your custom words
        if (!db.objectStoreNames.contains('customCards')) {
          db.createObjectStore('customCards', { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async addCard(card) {
    const database = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(['customCards'], 'readwrite');
      const store = transaction.objectStore('customCards');
      store.add(card);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }
};