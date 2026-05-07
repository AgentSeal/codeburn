import { createRequire } from 'node:module'

/// Thin SQLite read-only wrapper over Node's built-in `node:sqlite` module (stable in
/// Node 24, experimental in Node 22 / 23). Replaces the earlier `better-sqlite3` binding
/// so the dependency graph no longer pulls in the deprecated `prebuild-install` package
/// (issue #75). Works across Cursor and OpenCode session DBs, both of which we only read.

const requireForSqlite = createRequire(import.meta.url)

type Row = Record<string, unknown>

export type SqliteDatabase = {
  query<T extends Row = Row>(sql: string, params?: unknown[]): T[]
  close(): void
}

type DatabaseSyncCtor = new (path: string, options?: { readOnly?: boolean }) => {
  prepare(sql: string): { all(...params: unknown[]): Row[] }
  close(): void
}

let DatabaseSync: DatabaseSyncCtor | null = null
let loadAttempted = false
let loadError: string | null = null

/// Minimum Node 22.x patch version that contains the node:sqlite UTF-8 fix.
/// Older 22.x lines crash with `Check failed: (location_) != nullptr` when a
/// SQLite TEXT column returns bytes that V8's String::NewFromUtf8 rejects —
/// commonly the case for Cursor's text blobs (truncated multi-byte chars at
/// streaming boundaries) and OpenCode message text (rich tooling output).
/// Track of issue: https://github.com/getagentseal/codeburn/issues/264
/// Track of upstream: https://github.com/nodejs/node — fix landed in 22.x via
/// later patches; stable on Node 24+.
const MIN_NODE_22_PATCH = 20

function checkBuggyNodeVersion(): string | null {
  const match = /^v(\d+)\.(\d+)\.(\d+)/.exec(process.version)
  if (!match) return null
  const major = parseInt(match[1]!, 10)
  const minor = parseInt(match[2]!, 10)
  if (major === 22 && minor < MIN_NODE_22_PATCH) {
    return (
      `codeburn: Node ${process.version} ships an older node:sqlite that crashes on ` +
      `non-UTF-8 bytes in Cursor/OpenCode session text. Upgrade to Node 22.${MIN_NODE_22_PATCH}+ ` +
      `or 24+ to avoid the V8 fatal error. (https://nodejs.org)`
    )
  }
  return null
}

/// Lazily imports `node:sqlite`. On Node 22/23 it emits an ExperimentalWarning the first
/// time the module is loaded; we silence that specific warning once so dashboards aren't
/// preceded by a scary stderr line every run. Any other warnings (including future
/// non-SQLite ones) are left untouched.
function loadDriver(): boolean {
  if (loadAttempted) return DatabaseSync !== null
  loadAttempted = true

  // Refuse to load on a Node version known to crash mid-query. Treating the
  // SQLite providers as unavailable is much friendlier than letting the user
  // hit a V8 CHECK abort that takes down the whole CLI.
  const versionWarning = checkBuggyNodeVersion()
  if (versionWarning !== null) {
    loadError = versionWarning
    return false
  }

  const origEmit = process.emit.bind(process)
  let restored = false
  const restore = () => {
    if (restored) return
    restored = true
    process.emit = origEmit
  }

  // Node's `process.emit` signature is overloaded; we intercept the 'warning' channel
  // only and proxy everything else through unchanged. The `any` cast avoids chasing the
  // overload union which isn't worth its verbosity for a single-purpose shim.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.emit = function patchedEmit(this: NodeJS.Process, event: string, ...args: any[]): boolean {
    if (event === 'warning') {
      const warning = args[0] as { name?: string; message?: string } | undefined
      if (
        warning?.name === 'ExperimentalWarning' &&
        typeof warning.message === 'string' &&
        /SQLite/i.test(warning.message)
      ) {
        return false
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (origEmit as any).call(this, event, ...args)
  } as typeof process.emit

  try {
    const mod = requireForSqlite('node:sqlite') as { DatabaseSync: DatabaseSyncCtor }
    DatabaseSync = mod.DatabaseSync
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    loadError =
      'SQLite-based providers (Cursor, OpenCode) need Node 22+ with the node:sqlite module.\n' +
      `Current Node: ${process.version}.\n` +
      'Upgrade Node (https://nodejs.org) and run codeburn again.\n' +
      `(underlying error: ${message})`
    return false
  } finally {
    process.nextTick(restore)
  }
}

export function isSqliteAvailable(): boolean {
  return loadDriver()
}

export function getSqliteLoadError(): string {
  return loadError ?? 'SQLite driver not available'
}

export function openDatabase(path: string): SqliteDatabase {
  if (!loadDriver() || DatabaseSync === null) {
    throw new Error(getSqliteLoadError())
  }

  const db = new DatabaseSync(path, { readOnly: true })

  return {
    query<T extends Row = Row>(sql: string, params: unknown[] = []): T[] {
      return db.prepare(sql).all(...params) as T[]
    },
    close() {
      db.close()
    },
  }
}
