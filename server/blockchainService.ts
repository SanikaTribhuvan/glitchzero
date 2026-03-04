// server/blockchainService.ts
// ═══════════════════════════════════════════════════════════════════════════
//  GlitchZero Blockchain Anchoring Service
//  Two modes controlled by BLOCKCHAIN_MODE in .env:
//
//  "simulated" (default)
//     — Derives a deterministic tx hash from the Merkle root using SHA-256.
//     — Zero gas cost, zero setup. Good for demos and paper evaluation.
//     — Explorer URL points to polygonscan.com search (shows "not found"
//       but proves the hash is in the right format).
//
//  "live"
//     — Requires POLYGON_PRIVATE_KEY + POLYGON_RPC_URL + MERKLE_CONTRACT_ADDRESS
//     — Submits a real on-chain transaction to Polygon Amoy Testnet.
//     — Returns the real tx hash from the mempool.
//     — Explorer URL: https://amoy.polygonscan.com/tx/<hash>
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from "crypto";

// Lazy-import ethers so the server boots even without the package installed
// in simulated mode.
type EthersProvider = any;
type EthersSigner   = any;
type EthersContract = any;

// ── Minimal ABI: just the one function we need ───────────────────────────
const ANCHOR_ABI = [
  "function anchorRoot(bytes32 merkleRoot) external",
  "event RootAnchored(bytes32 indexed merkleRoot, uint256 timestamp)",
];

export interface BlockchainResult {
  txHash:      string;
  network:     string;
  explorerUrl: string;
  simulated:   boolean;
}

// ── Simulated mode ────────────────────────────────────────────────────────
function simulatedAnchor(merkleRoot: string): BlockchainResult {
  const txHash = "0x" + createHash("sha256")
    .update("polygon-amoy-simulated:" + merkleRoot)
    .digest("hex");
  return {
    txHash,
    network:     "Polygon Amoy (simulated)",
    explorerUrl: `https://amoy.polygonscan.com/search?q=${txHash}`,
    simulated:   true,
  };
}

// ── Live mode ─────────────────────────────────────────────────────────────
async function liveAnchor(merkleRoot: string): Promise<BlockchainResult> {
  let ethers: typeof import("ethers");
  try {
    ethers = await import("ethers");
  } catch {
    console.warn("  ⚠  ethers not installed — falling back to simulated mode");
    return simulatedAnchor(merkleRoot);
  }

  const rpc         = process.env.POLYGON_RPC_URL        ?? "https://rpc-amoy.polygon.technology/";
  const privateKey  = process.env.POLYGON_PRIVATE_KEY    ?? "";
  const contractAddr= process.env.MERKLE_CONTRACT_ADDRESS ?? "";

  if (!privateKey || !contractAddr) {
    console.warn("  ⚠  POLYGON_PRIVATE_KEY or MERKLE_CONTRACT_ADDRESS not set — simulating");
    return simulatedAnchor(merkleRoot);
  }

  const provider: EthersProvider = new ethers.JsonRpcProvider(rpc);
  const signer:   EthersSigner   = new ethers.Wallet(privateKey, provider);
  const contract: EthersContract = new ethers.Contract(contractAddr, ANCHOR_ABI, signer);

  // Convert hex string to bytes32
  const root32 = ethers.zeroPadValue("0x" + merkleRoot, 32);

  try {
    const tx = await contract.anchorRoot(root32, {
      gasLimit: 80_000,  // anchorRoot is a simple SSTORE — 80k is plenty
    });
    console.log(`  ⛓  Live tx submitted: ${tx.hash}`);
    await tx.wait(1); // Wait for 1 confirmation
    console.log(`  ✅  Confirmed on Polygon Amoy`);

    return {
      txHash:      tx.hash as string,
      network:     "Polygon Amoy Testnet",
      explorerUrl: `https://amoy.polygonscan.com/tx/${tx.hash}`,
      simulated:   false,
    };
  } catch (err: any) {
    console.error("  ❌  On-chain anchor failed:", err?.message ?? err);
    console.warn("  ↩  Falling back to simulated anchor");
    return simulatedAnchor(merkleRoot);
  }
}

// ── Public API ────────────────────────────────────────────────────────────
export async function anchorMerkleRoot(merkleRoot: string): Promise<BlockchainResult> {
  const mode = (process.env.BLOCKCHAIN_MODE ?? "simulated").toLowerCase();
  if (mode === "live") {
    return liveAnchor(merkleRoot);
  }
  return simulatedAnchor(merkleRoot);
}

// ── Solidity contract (deploy to Amoy if BLOCKCHAIN_MODE=live) ────────────
//
//  // SPDX-License-Identifier: MIT
//  pragma solidity ^0.8.20;
//
//  contract MerkleAnchor {
//      event RootAnchored(bytes32 indexed merkleRoot, uint256 timestamp);
//      mapping(bytes32 => uint256) public anchoredAt;
//
//      function anchorRoot(bytes32 merkleRoot) external {
//          require(anchoredAt[merkleRoot] == 0, "Already anchored");
//          anchoredAt[merkleRoot] = block.timestamp;
//          emit RootAnchored(merkleRoot, block.timestamp);
//      }
//
//      function verify(bytes32 merkleRoot) external view returns (bool, uint256) {
//          uint256 ts = anchoredAt[merkleRoot];
//          return (ts != 0, ts);
//      }
//  }
//
//  Deploy steps (one-time):
//  1. Go to https://remix.ethereum.org
//  2. Paste the contract above
//  3. Compile with Solidity 0.8.20
//  4. In "Deploy & Run": switch environment to "Injected Provider - MetaMask"
//  5. Connect MetaMask to Polygon Amoy (chainId 80002)
//  6. Deploy — copy the contract address into MERKLE_CONTRACT_ADDRESS in .env
