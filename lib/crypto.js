// lib/crypto.js

// --- Constants ---
const ALGO_NAME = "ECDH";
const CURVE = "P-256";
const HASH_ALGO = "SHA-256";
const AES_ALGO = "AES-GCM";

// --- Utilities ---

function arrayBufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToArrayBuffer(hex) {
  const bytes = new Uint8Array(Math.ceil(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes.buffer;
}

function formatPhoneNumber(numStr) {
  // Expecting 9 digits string
  const p = numStr.padStart(9, '0');
  return `#${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6)}`;
}

// --- Storage Encryption (Master Password) ---

export async function deriveMasterKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false, // key is not extractable
    ["encrypt", "decrypt"]
  );
}

export async function encryptStorageData(data, masterKey) {
  const enc = new TextEncoder();
  const encoded = enc.encode(JSON.stringify(data));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  
  const encrypted = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    masterKey,
    encoded
  );

  return {
    iv: Array.from(iv),
    data: Array.from(new Uint8Array(encrypted))
  };
}

export async function decryptStorageData(encryptedObj, masterKey) {
  const iv = new Uint8Array(encryptedObj.iv);
  const data = new Uint8Array(encryptedObj.data);

  const decrypted = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv },
    masterKey,
    data
  );

  const dec = new TextDecoder();
  return JSON.parse(dec.decode(decrypted));
}

// --- Identity Generation ---

export async function generateIdentity() {
  // 1. Generate ECDH Key Pair
  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: ALGO_NAME,
      namedCurve: CURVE,
    },
    true, // extractable
    ["deriveKey", "deriveBits"]
  );

  // 2. Export Public Key to derive Phone Number
  const rawPub = await window.crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHash = await window.crypto.subtle.digest(HASH_ALGO, rawPub);
  
  // 3. Derive Phone Number from Hash (First 5 bytes -> integer -> mod 10^9)
  // This gives us a deterministic number from the key.
  // Note: Collisions are possible but unlikely for a small user base prototype.
  const hashArray = new Uint8Array(pubHash);
  // Use 4 bytes (32 bits) which is ~4 billion, enough for 9 digits
  const view = new DataView(hashArray.buffer);
  const numInt = view.getUint32(0); 
  const phoneNumberRaw = (numInt % 1000000000).toString().padStart(9, '0');
  const formattedNumber = formatPhoneNumber(phoneNumberRaw);

  // 4. Export Keys to JWK for storage/login
  const privateJwk = await window.crypto.subtle.exportKey("jwk", keyPair.privateKey);
  const publicJwk = await window.crypto.subtle.exportKey("jwk", keyPair.publicKey);

  // 5. Create the "Login Key" (Base64 encoded JSON of the keys)
  const identityObject = {
    phoneNumber: phoneNumberRaw,
    privateKey: privateJwk,
    publicKey: publicJwk
  };
  
  const loginKey = btoa(JSON.stringify(identityObject));

  return {
    keyPair,
    phoneNumber: phoneNumberRaw,
    formattedNumber,
    loginKey,
    publicKeyJwk: publicJwk
  };
}

export async function importIdentity(loginKey) {
  try {
    const jsonStr = atob(loginKey);
    const identityObject = JSON.parse(jsonStr);
    
    const privateKey = await window.crypto.subtle.importKey(
      "jwk",
      identityObject.privateKey,
      { name: ALGO_NAME, namedCurve: CURVE },
      true,
      ["deriveKey", "deriveBits"]
    );

    const publicKey = await window.crypto.subtle.importKey(
      "jwk",
      identityObject.publicKey,
      { name: ALGO_NAME, namedCurve: CURVE },
      true,
      []
    );

    return {
      keyPair: { privateKey, publicKey },
      phoneNumber: identityObject.phoneNumber,
      formattedNumber: formatPhoneNumber(identityObject.phoneNumber)
    };
  } catch (e) {
    console.error("Failed to import identity", e);
    throw new Error("Invalid Login Key");
  }
}

export async function importPublicKey(jwk) {
    return await window.crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: ALGO_NAME, namedCurve: CURVE },
        true,
        []
    );
}

// --- Encryption / Decryption ---

// Derive a shared AES-GCM key from Local Private Key + Remote Public Key
export async function deriveSharedSecret(localPrivateKey, remotePublicKey) {
  return await window.crypto.subtle.deriveKey(
    {
      name: ALGO_NAME,
      public: remotePublicKey,
    },
    localPrivateKey,
    {
      name: AES_ALGO,
      length: 256,
    },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptMessage(text, sharedKey) {
  const encoded = new TextEncoder().encode(text);
  const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 12 bytes for GCM

  const ciphertext = await window.crypto.subtle.encrypt(
    {
      name: AES_ALGO,
      iv: iv,
    },
    sharedKey,
    encoded
  );

  return {
    iv: arrayBufferToHex(iv.buffer),
    ciphertext: arrayBufferToHex(ciphertext),
  };
}

export async function decryptMessage(encryptedData, sharedKey) {
  const { iv, ciphertext } = encryptedData;
  
  const ivBuffer = hexToArrayBuffer(iv);
  const ciphertextBuffer = hexToArrayBuffer(ciphertext);

  try {
    const decrypted = await window.crypto.subtle.decrypt(
      {
        name: AES_ALGO,
        iv: ivBuffer,
      },
      sharedKey,
      ciphertextBuffer
    );
    return new TextDecoder().decode(decrypted);
  } catch (e) {
    console.error("Decryption failed", e);
    return null;
  }
}

// Verify if a public key actually belongs to a phone number
// This prevents someone from claiming a number but using a different key
export async function verifyIdentity(phoneNumber, remotePublicKey) {
    const rawPub = await window.crypto.subtle.exportKey("raw", remotePublicKey);
    const pubHash = await window.crypto.subtle.digest(HASH_ALGO, rawPub);
    const hashArray = new Uint8Array(pubHash);
    const view = new DataView(hashArray.buffer);
    const numInt = view.getUint32(0); 
    const derivedNumber = (numInt % 1000000000).toString().padStart(9, '0');
    
    return derivedNumber === phoneNumber;
}
