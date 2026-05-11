import { readdir, stat } from 'fs/promises'
import { homedir } from 'os'
import { delimiter, join, relative } from 'path'

import { getSqliteLoadError, isSqliteAvailable, openDatabase, type SqliteDatabase } from './sqlite.js'

const SQLITE_EXTENSIONS = ['.sqlite', '.sqlite3', '.db']
const USAGE_COLUMN_RE = /(token|usage|cost|model|prompt|completion|input|output)/i

export type ChatGPTDesktopColumn = {
  name: string
  type: string
}

export type ChatGPTDesktopTable = {
  name: string
  columns: ChatGPTDesktopColumn[]
  usageLikeColumns: string[]
}

export type ChatGPTDesktopDatabase = {
  path: string
  root: string
  relativePath: string
  tables: ChatGPTDesktopTable[]
  error?: string
}

export type ChatGPTDesktopRoot = {
  path: string
  exists: boolean
}

export type ChatGPTDesktopDiagnostics = {
  sqliteAvailable: boolean
  sqliteError?: string
  roots: ChatGPTDesktopRoot[]
  databases: ChatGPTDesktopDatabase[]
  conclusion: 'storage-not-found' | 'sqlite-unavailable' | 'no-databases' | 'usage-candidates-found' | 'no-usage-candidates'
}

type InspectOptions = {
  roots?: string[]
  maxDepth?: number
}

type SqliteSchemaRow = {
  name: string
  type: string
  sql: string | null
}

type PragmaTableInfoRow = {
  name: string
  type: string | null
}

export function defaultChatGPTDesktopRoots(): string[] {
  const env = process.env['CODEBURN_CHATGPT_DESKTOP_DIRS']
  if (env) return env.split(delimiter).map(s => s.trim()).filter(Boolean)

  const home = homedir()
  return [
    join(home, 'Library', 'Application Support', 'com.openai.chat'),
    join(home, 'Library', 'Application Support', 'com.openai.atlas'),
  ]
}

function isSqlitePath(path: string): boolean {
  const lower = path.toLowerCase()
  if (lower.endsWith('-wal') || lower.endsWith('-shm')) return false
  return SQLITE_EXTENSIONS.some(ext => lower.endsWith(ext))
}

function redactHomePath(path: string): string {
  const home = homedir()
  if (path === home || path.startsWith(`${home}/`) || path.startsWith(`${home}\\`)) {
    return `~${path.slice(home.length)}`
  }
  return path
}

function redactHomeInText(text: string): string {
  const home = homedir()
  return home ? text.split(home).join('~') : text
}

async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(s => s.isDirectory()).catch(() => false)
}

async function findSqliteFiles(root: string, maxDepth: number): Promise<string[]> {
  const out: string[] = []

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return

    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full, depth + 1)
      } else if (entry.isFile() && isSqlitePath(full)) {
        out.push(full)
      }
    }
  }

  await walk(root, 0)
  return out.sort()
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}

function inspectDatabase(db: SqliteDatabase, dbPath: string, root: string): ChatGPTDesktopDatabase {
  const schemaRows = db.query<SqliteSchemaRow>(
    `SELECT name, type, sql
     FROM sqlite_schema
     WHERE type IN ('table', 'view')
       AND name NOT LIKE 'sqlite_%'
     ORDER BY name`,
  )

  const tables: ChatGPTDesktopTable[] = []
  for (const row of schemaRows) {
    let columns: ChatGPTDesktopColumn[] = []
    try {
      columns = db.query<PragmaTableInfoRow>(`PRAGMA table_info(${quoteIdentifier(row.name)})`)
        .map(c => ({ name: c.name, type: c.type ?? '' }))
    } catch {
      columns = []
    }

    const usageLikeColumns = columns
      .map(c => c.name)
      .filter(name => USAGE_COLUMN_RE.test(name))

    tables.push({
      name: row.name,
      columns,
      usageLikeColumns,
    })
  }

  return {
    path: dbPath,
    root,
    relativePath: relative(root, dbPath) || dbPath,
    tables,
  }
}

export async function inspectChatGPTDesktop(options: InspectOptions = {}): Promise<ChatGPTDesktopDiagnostics> {
  const roots = options.roots ?? defaultChatGPTDesktopRoots()
  const maxDepth = options.maxDepth ?? 4
  const rootStatuses: ChatGPTDesktopRoot[] = []

  for (const root of roots) {
    rootStatuses.push({ path: root, exists: await pathExists(root) })
  }

  if (!isSqliteAvailable()) {
    return {
      sqliteAvailable: false,
      sqliteError: getSqliteLoadError(),
      roots: rootStatuses,
      databases: [],
      conclusion: 'sqlite-unavailable',
    }
  }

  const databases: ChatGPTDesktopDatabase[] = []
  for (const root of rootStatuses.filter(r => r.exists).map(r => r.path)) {
    const files = await findSqliteFiles(root, maxDepth)
    for (const dbPath of files) {
      let db: SqliteDatabase | null = null
      try {
        // Shared SQLite wrapper opens databases with node:sqlite readOnly: true.
        db = openDatabase(dbPath)
        databases.push(inspectDatabase(db, dbPath, root))
      } catch (err) {
        databases.push({
          path: dbPath,
          root,
          relativePath: relative(root, dbPath) || dbPath,
          tables: [],
          error: err instanceof Error ? err.message : String(err),
        })
      } finally {
        db?.close()
      }
    }
  }

  const anyRoot = rootStatuses.some(r => r.exists)
  const anyUsageCandidates = databases.some(db => db.tables.some(t => t.usageLikeColumns.length > 0))
  const conclusion: ChatGPTDesktopDiagnostics['conclusion'] =
    !anyRoot ? 'storage-not-found'
      : databases.length === 0 ? 'no-databases'
      : anyUsageCandidates ? 'usage-candidates-found'
      : 'no-usage-candidates'

  return {
    sqliteAvailable: true,
    roots: rootStatuses,
    databases,
    conclusion,
  }
}

export function redactChatGPTDesktopDiagnostics(report: ChatGPTDesktopDiagnostics): ChatGPTDesktopDiagnostics {
  return {
    ...report,
    sqliteError: report.sqliteError ? redactHomeInText(report.sqliteError) : undefined,
    roots: report.roots.map(root => ({
      ...root,
      path: redactHomePath(root.path),
    })),
    databases: report.databases.map(db => ({
      ...db,
      path: redactHomePath(db.path),
      root: redactHomePath(db.root),
      error: db.error ? redactHomeInText(db.error) : undefined,
    })),
  }
}

export function renderChatGPTDesktopDiagnostics(report: ChatGPTDesktopDiagnostics): string {
  const displayReport = redactChatGPTDesktopDiagnostics(report)
  const lines: string[] = []
  lines.push('ChatGPT Desktop diagnostics')
  lines.push('')
  lines.push('Storage roots:')
  for (const root of displayReport.roots) {
    lines.push(`  ${root.exists ? 'found' : 'missing'}  ${root.path}`)
  }

  if (!displayReport.sqliteAvailable) {
    lines.push('')
    lines.push('SQLite driver unavailable:')
    lines.push(`  ${displayReport.sqliteError ?? redactHomeInText(getSqliteLoadError())}`)
    return lines.join('\n')
  }

  lines.push('')
  if (displayReport.databases.length === 0) {
    lines.push('SQLite databases: none found')
  } else {
    lines.push(`SQLite databases: ${displayReport.databases.length}`)
    for (const db of displayReport.databases) {
      lines.push(`  ${db.relativePath}`)
      if (db.error) {
        lines.push(`    error: ${db.error}`)
        continue
      }
      lines.push(`    tables/views: ${db.tables.length}`)
      const candidates = db.tables.filter(t => t.usageLikeColumns.length > 0)
      if (candidates.length === 0) {
        lines.push('    usage-like columns: none')
      } else {
        lines.push('    usage-like columns:')
        for (const table of candidates) {
          lines.push(`      ${table.name}: ${table.usageLikeColumns.join(', ')}`)
        }
      }
    }
  }

  lines.push('')
  lines.push(`Conclusion: ${displayReport.conclusion}`)
  lines.push('This command prints schema metadata and redacted local paths only. It does not read conversation rows or message text.')

  return lines.join('\n')
}
