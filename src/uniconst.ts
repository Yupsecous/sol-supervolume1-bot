import dotenv from 'dotenv'
import bs58 from 'bs58'
import { Keypair } from '@solana/web3.js'

dotenv.config()

// Result codes returned by the bot logic layer
export enum ResultCode {
    SUCCESS = 0,
    INTERNAL,
    USER_INSUFFICIENT_SOL,
    USER_INSUFFICIENT_ENOUGH_SOL,
    USER_INSUFFICIENT_JITO_FEE_SOL,
}

// Time units (milliseconds)
export const SECOND = 1000
export const MINUTE = 60 * SECOND
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

// Volume bookkeeping
// currentVolume is tracked in USD, targetVolume is expressed in "millions" in the UI
export const VOLUME_UNIT = 1_000_000

// Tax charged on withdraw: TAX_AMOUNT SOL per 1 unit (1M USD) of generated volume
export const TAX_AMOUNT = Number(process.env.TAX_AMOUNT ?? 10)

// Maximum number of helper wallets generated per session
export const MAX_WALLET_SIZE = Number(process.env.MAX_WALLET_SIZE ?? 8)

// Compute-unit priority fee, in micro-lamports
export const PRIORITY_RATE = Number(process.env.PRIORITY_RATE ?? 100_000)

// Jito bundle tip, in SOL
export const JITO_BUNDLE_TIP = Number(process.env.JITO_BUNDLE_TIP ?? 0.0001)

// One of the official Jito tip accounts (override via env if desired)
export const JITO_TIP_ACCOUNT =
    process.env.JITO_TIP_ACCOUNT ?? '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5'

// Keypairs used to authenticate with the Jito block-engine searcher client.
// Jito's block engine is permissionless, so any valid keypair works.
// Provide your own via JITO_AUTH_KEYS (comma-separated base58 secret keys),
// otherwise an ephemeral keypair is generated at startup.
const parseJitoAuthKeys = (): string[] => {
    const raw = (process.env.JITO_AUTH_KEYS ?? '').trim()
    if (raw.length > 0) {
        const keys = raw
            .split(',')
            .map((k) => k.trim())
            .filter((k) => k.length > 0)
        if (keys.length > 0) {
            return keys
        }
    }
    // Fallback: ephemeral throwaway keypair (no funds required for auth)
    return [bs58.encode(Keypair.generate().secretKey)]
}

export const JITO_AUTH_KEYS: string[] = parseJitoAuthKeys()

// Footer appended to bot messages
export const BOT_FOOTER_DASH = '➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖➖'
