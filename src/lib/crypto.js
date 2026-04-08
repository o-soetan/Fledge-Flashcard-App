// Uses the Web Crypto API for secure, in-browser encryption

// Standard EFF Short Wordlist (50 words for example, use a full 2048-word BIP39 list for production)
const WORD_LIST = [
  'acid', 'altar', 'back', 'beam', 'cage', 'cake', 'dash', 'data', 'echo', 'edge', 
  'face', 'film', 'game', 'gate', 'halo', 'hang', 'icon', 'item', 'jazz', 'jump', 
  'kept', 'kind', 'lava', 'leaf', 'mask', 'menu', 'neon', 'next', 'oath', 'open', 
  'palm', 'path', 'quiz', 'quit', 'race', 'rare', 'safe', 'scan', 'tail', 'tame', 
  'unit', 'user', 'vibe', 'view', 'walk', 'wave', 'yard', 'yoga', 'zero', 'zone'
];

export async function encryptData(data, passphrase) {
  const enc = new TextEncoder();
  
  // 1. Generate random Salt (16 bytes) and IV (12 bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // 2. Derive a key from the passphrase using PBKDF2
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" }, // OWASP recommended iterations
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );

  // 3. Encrypt the data (stringified JSON)
  const encryptedContent = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(JSON.stringify(data))
  );

  // 4. Pack everything (Salt + IV + Ciphertext) into one binary array
  const buffer = new Uint8Array(salt.byteLength + iv.byteLength + encryptedContent.byteLength);
  buffer.set(salt, 0);
  buffer.set(iv, salt.byteLength);
  buffer.set(new Uint8Array(encryptedContent), salt.byteLength + iv.byteLength);

  // 5. Convert to Base64 string for easy storage/transfer
  let binary = '';
  const len = buffer.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary);
}

export async function decryptData(encryptedBlob, passphrase) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // 1. Decode Base64
  const binaryString = atob(encryptedBlob);
  const buffer = Uint8Array.from(binaryString, c => c.charCodeAt(0));

  // 2. Extract Salt, IV, and Ciphertext
  const salt = buffer.slice(0, 16);
  const iv = buffer.slice(16, 28);
  const ciphertext = buffer.slice(28);

  // 3. Derive the same key using the extracted Salt
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" }, // OWASP recommended iterations
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  // 4. Decrypt and parse JSON
  const decryptedContent = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );

  return JSON.parse(dec.decode(decryptedContent));
}

// Generates a deterministic ID from the passphrase so the user always hits the same "directory"
export async function deriveLockerId(passphrase) {
  const enc = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(passphrase));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export function generatePassphrase(count = 12) {
  const values = new Uint32Array(count);
  crypto.getRandomValues(values);
  return Array.from(values).map(v => WORD_LIST[v % WORD_LIST.length]).join('-');
}