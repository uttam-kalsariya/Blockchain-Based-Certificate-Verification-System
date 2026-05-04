# 📜 Blockchain-Based Certificate Verification System

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-v18+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Latest-3178C6.svg)](https://www.typescriptlang.org/)
[![Ethereum](https://img.shields.io/badge/Blockchain-MetaMask-3c3c3d.svg)](https://ethereum.org/)

---

## 🚀 Overview

This project implements a **Blockchain-Based Certificate Verification System** designed to eliminate fake certificates and ensure secure, tamper-proof validation of academic credentials.

The system leverages **decentralized ledger technology** and **SHA-256 hashing** to store certificate data in an immutable manner, allowing instant and transparent verification for employers and institutions.

---

## 🎯 Problem Statement

Traditional certificate verification systems are often:
* **Manual and time-consuming**: Requiring physical verification or direct institution contact.
* **Prone to fraud**: Physical certificates can be easily forged or altered.
* **Lacking transparency**: Hard for third parties to verify the authenticity instantly.
* **Centralized**: Dependent on a single authority that could be a single point of failure.

---

## 💡 Proposed Solution

This system digitizes certificates and anchors them to a **Blockchain Network** as hashed records.
* **Unique Hashing**: Each certificate is assigned a unique SHA-256 hash based on its content.
* **Immutable Storage**: Once stored in a block, the data cannot be changed without breaking the hash chain.
* **Decentralized Trust**: Verification is done via the blockchain, removing the need for a central intermediary.
* **Instant Validation**: Users can verify a certificate in seconds using its ID or Hash.

---

## 🏗️ System Architecture

1.  **Admin (Institution/Platform)**:
    *   Authenticates and scans certificate uploads.
    *   Generates a cryptographic hash and signs it with a digital wallet.
    *   Commits the record to the blockchain.
2.  **Blockchain Layer**:
    *   Maintains a linked chain of blocks containing verified certificates.
    *   Ensures chronological order and data integrity.
3.  **Public Verifier**:
    *   A public portal where anyone can input a hash or ID to check authenticity.

---

## ⚙️ Tech Stack

### 🔹 Frontend
* **TypeScript & Vite**: For a fast, modern, and type-safe development experience.
* **Vanilla CSS**: Premium Glassmorphism UI design with smooth animations.
* **Ethers.js**: Integration with MetaMask for digital signatures.

### 🔹 Backend
* **Node.js & Express**: High-performance API handling.
* **Better-SQLite3**: Efficient storage for the blockchain ledger and pending requests.

### 🔹 Security & Tools
* **SHA-256 Hashing**: For data integrity.
* **MetaMask**: For decentralized identity and wallet-based signing.

---

## 🔑 Key Features

*   🔐 **Tamper-proof storage**: Certificates once added cannot be modified.
*   ⚡ **Instant verification**: One-click verification for employers.
*   📄 **AI-Powered Extraction**: Automatically scans and pulls details from PDF certificates.
*   🦊 **MetaMask Integration**: Secure signing of credential submissions.
*   👥 **Role-Based Access**: Specialized dashboards for Students, Platform Admins (LinkedIn/Coursera), and Main Admins.

---

## 🔄 Working Process

1.  **Submission**: A user uploads a certificate (PDF).
2.  **Extraction**: The system extracts student name, course, and ID.
3.  **Signing**: The user signs the submission using their MetaMask wallet.
4.  **Verification**: Institution admins review and "Approve" the request.
5.  **Anchoring**: On approval, a new block is created and linked to the previous one in the chain.
6.  **Public Audit**: Anyone can now verify the certificate using the portal.

---

## 🧪 How to Run

### 1. Prerequisites
* [Node.js](https://nodejs.org/) installed.
* [MetaMask](https://metamask.io/) extension added to your browser.

### 2. Backend Setup
```bash
cd backend
npm install
npm start
```
*Runs on `http://localhost:5001`.*

### 3. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```
*Runs on `http://localhost:5173`.*

---

## 👨‍💻 Authors

* **Uttam Kalsariya** - [GitHub](https://github.com/uttam-kalsariya)

---

## ⭐ Acknowledgment

This project was developed as part of **M.Sc. CS & IT – Blockchain Activity** to demonstrate the practical application of decentralized technologies in credential management.
