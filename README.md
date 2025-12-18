# #hello (HashHello)

A secure, end-to-end encrypted P2P messenger running entirely in the browser.

**Live Demo:** [https://hashhello.vercel.app](https://hashhello.vercel.app)

**Test Contact:** You can message me at `#333 831 177`

> **Important:** To establish a P2P connection, the target number **must be online** and have the website open at the same time.

## Features

- **Identity**: Your "Phone Number" (e.g., `#600 500 600`) is cryptographically derived from your Public Key.
- **Security**: 
  - End-to-End Encryption using AES-GCM (256-bit).
  - Perfect Forward Secrecy (per session keys via ECDH).
  - Identity Verification (Handshake verifies that the peer owns the private key corresponding to the phone number).
- **Privacy**: No central database of messages. Communication is direct P2P via WebRTC.
- **Multi-chat**: Support for multiple simultaneous encrypted conversations.
- **Media**: Securely send and receive images (encrypted with the same session keys).

## Tech Stack

- **Framework**: Next.js 14
- **P2P**: PeerJS (WebRTC wrapper)
- **Crypto**: Web Crypto API (Native browser cryptography)
- **Styling**: Tailwind CSS

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the development server:
   ```bash
   npm run dev
   ```

3. Open [http://localhost:3000](http://localhost:3000) in two different browser windows (or use Incognito mode for the second one).

## How to use

1. **Window A**: Click "NEW IDENTITY". Copy your Private Key (save it if you want to login later). Note your Number (e.g., `#123 456 789`).
2. **Window B**: Click "NEW IDENTITY" to get a different number.
3. **Window A**: Enter Window B's number in the top bar and click "DIAL".
4. **Chat**: Once the "CONNECTED" status appears (and the shield icon turns green), the secure channel is established.

## Security Note

This is a prototype. The "Phone Number" is a hash of the public key. In a production system, you would need a larger address space or a distributed hash table (DHT) to prevent collisions, although with 9 digits collisions are rare for small groups.
