// Uses the Web Crypto API for secure, in-browser encryption

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
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
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
  for (let i = 0; i < buffer.byteLength; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary);
}

export async function decryptData(encryptedBlob, passphrase) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // 1. Decode Base64
  const binaryString = atob(encryptedBlob);
  const buffer = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    buffer[i] = binaryString.charCodeAt(i);
  }

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
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
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

export function generatePassphrase(length = 4) {
  const words = ['alpha', 'bravo', 'card', 'delta', 'echo', 'fox', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa', 'quebec', 'romeo', 'sierra', 'tango', 'uniform', 'victor', 'whiskey', 'xray', 'yankee', 'zulu'];
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  return Array.from(values).map(v => words[v % words.length]).join('-');
}