import { randomBytes } from 'crypto'
import { chmod, mkdir, open, readFile, rename, stat, unlink } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

import type { ParsedProviderCall } from './providers/types.js'

type ResultCache = {
  dbMtimeMs: number
  dbSizeBytes: number
  calls: ParsedProviderCall[]
}

const CACHE_FILE = 'cursor-results.json'
const CACHE_DIR_MODE = 0o700
const CACHE_FILE_MODE = 0o600

function getCacheDir(): string {
  return join(homedir(), '.cache', 'codeburn')
}

function getCachePath(): string {
  return join(getCacheDir(), CACHE_FILE)
}

async function getDbFingerprint(dbPath: string): Promise<{ mtimeMs: number; size: number } | null> {
  try {
    const s = await stat(dbPath)
    return { mtimeMs: s.mtimeMs, size: s.size }
  } catch {
    return null
  }
}

export async function readCachedResults(dbPath: string): Promise<ParsedProviderCall[] | null> {
  try {
    const fp = await getDbFingerprint(dbPath)
    if (!fp) return null

    const raw = await readFile(getCachePath(), 'utf-8')
    const cache = JSON.parse(raw) as ResultCache

    if (cache.dbMtimeMs === fp.mtimeMs && cache.dbSizeBytes === fp.size) {
      return cache.calls
    }
    return null
  } catch {
    return null
  }
}

export async function writeCachedResults(dbPath: string, calls: ParsedProviderCall[]): Promise<void> {
  try {
    const fp = await getDbFingerprint(dbPath)
    if (!fp) return

    const dir = getCacheDir()
    await mkdir(dir, { recursive: true, mode: CACHE_DIR_MODE })
    // mkdir's `mode` is only honoured for newly-created directories. A user upgrading from a
    // pre-hardening build will already have ~/.cache/codeburn at 0755; chmod on every write
    // tightens the permission without breaking anyone whose directory is already 0700.
    await chmod(dir, CACHE_DIR_MODE).catch(() => {})
    const cache: ResultCache = {
      dbMtimeMs: fp.mtimeMs,
      dbSizeBytes: fp.size,
      calls,
    }
    const finalPath = getCachePath()
    const tempPath = `${finalPath}.${randomBytes(8).toString('hex')}.tmp`
    const payload = JSON.stringify(cache)
    const handle = await open(tempPath, 'w', CACHE_FILE_MODE)
    try {
      await handle.writeFile(payload, { encoding: 'utf-8' })
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await rename(tempPath, finalPath)
    } catch (err) {
      try { await unlink(tempPath) } catch { /* ignore */ }
      throw err
    }
  } catch {}
}
