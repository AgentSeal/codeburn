import { readdir, stat } from 'fs/promises'
import { basename, delimiter as pathDelimiter, join, resolve } from 'path'
import { homedir } from 'os'

import type { Provider, SessionSource, SessionParser } from './types.js'

const shortNames: Record<string, string> = {
  'claude-opus-4-7': 'Opus 4.7',
  'claude-opus-4-6': 'Opus 4.6',
  'claude-opus-4-5': 'Opus 4.5',
  'claude-opus-4-1': 'Opus 4.1',
  'claude-opus-4': 'Opus 4',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-sonnet-4-5': 'Sonnet 4.5',
  'claude-sonnet-4': 'Sonnet 4',
  'claude-3-7-sonnet': 'Sonnet 3.7',
  'claude-3-5-sonnet': 'Sonnet 3.5',
  'claude-haiku-4-5': 'Haiku 4.5',
  'claude-3-5-haiku': 'Haiku 3.5',
}

type ClaudeRoot = {
  path: string
  account?: string
  accountPath?: string
}

function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

function normalizeDirs(dirs: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const dir of dirs) {
    const trimmed = dir.trim()
    if (!trimmed) continue
    const resolved = resolve(expandHome(trimmed))
    if (seen.has(resolved)) continue
    seen.add(resolved)
    out.push(resolved)
  }
  return out
}

function accountLabelForClaudeDir(dir: string): string {
  const raw = basename(dir).replace(/^\.+/, '')
  let label = /^claude$/i.test(raw) ? 'default' : raw.replace(/^claude[-_.]/i, '')
  if (!label) label = 'default'
  return label.toLowerCase()
}

function withClaudeAccounts(dirs: string[], forceLabel = false): ClaudeRoot[] {
  const shouldLabel = forceLabel || dirs.length > 1
  const assigned = new Set<string>()
  return dirs.map(dir => {
    if (!shouldLabel) return { path: dir }
    const baseLabel = accountLabelForClaudeDir(dir)
    let account = baseLabel
    let suffix = 2
    while (assigned.has(account)) {
      account = `${baseLabel}-${suffix}`
      suffix++
    }
    assigned.add(account)
    return { path: dir, account, accountPath: dir }
  })
}

/// Returns every Claude config root to scan, in priority order with duplicates
/// removed (resolved-path equality). Precedence: explicit test override,
/// `CLAUDE_CONFIG_DIRS`, `CLAUDE_CONFIG_DIR`, then `~/.claude`.
function getClaudeRoots(overrideDirs?: string | string[]): ClaudeRoot[] {
  if (overrideDirs !== undefined) {
    return withClaudeAccounts(normalizeDirs(Array.isArray(overrideDirs) ? overrideDirs : [overrideDirs]))
  }

  const multi = process.env['CLAUDE_CONFIG_DIRS']
  if (multi !== undefined && multi !== '') {
    const dirs = normalizeDirs(multi.split(pathDelimiter))
    if (dirs.length > 0) return withClaudeAccounts(dirs, true)
  }

  const single = process.env['CLAUDE_CONFIG_DIR']
  if (single !== undefined && single !== '') return withClaudeAccounts(normalizeDirs([single]))
  return withClaudeAccounts(normalizeDirs([join(homedir(), '.claude')]))
}

function getDesktopSessionsDir(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions')
  if (process.platform === 'win32') return join(homedir(), 'AppData', 'Roaming', 'Claude', 'local-agent-mode-sessions')
  return join(homedir(), '.config', 'Claude', 'local-agent-mode-sessions')
}

async function findDesktopProjectDirs(base: string): Promise<string[]> {
  const results: string[] = []
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 8) return
    const entries = await readdir(dir).catch(() => [])
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.git') continue
      const full = join(dir, entry)
      const s = await stat(full).catch(() => null)
      if (!s?.isDirectory()) continue
      if (entry === 'projects') {
        const projectDirs = await readdir(full).catch(() => [])
        for (const pd of projectDirs) {
          const pdFull = join(full, pd)
          const pdStat = await stat(pdFull).catch(() => null)
          if (pdStat?.isDirectory()) results.push(pdFull)
        }
      } else {
        await walk(full, depth + 1)
      }
    }
  }
  await walk(base, 0)
  return results
}

export function createClaudeProvider(claudeDirs?: string | string[], desktopSessionsDir?: string): Provider {
  return {
    name: 'claude',
    displayName: 'Claude',

    modelDisplayName(model: string): string {
      const canonical = model.replace(/@.*$/, '').replace(/-\d{8}$/, '')
      for (const [key, name] of Object.entries(shortNames)) {
        if (canonical.startsWith(key)) return name
      }
      return canonical
    },

    toolDisplayName(rawTool: string): string {
      return rawTool
    },

    async discoverSessions(): Promise<SessionSource[]> {
      const sources: SessionSource[] = []
      const seenProjectDirs = new Set<string>()
      const roots = getClaudeRoots(claudeDirs)
      let anyDirReadable = false
      const shouldLabelDesktop = roots.some(root => root.account)

      for (const root of roots) {
        const projectsDir = join(root.path, 'projects')
        let entries: string[]
        try {
          entries = await readdir(projectsDir)
          anyDirReadable = true
        } catch {
          // Missing or unreadable dir is not fatal: a user can configure both
          // a real and a stale path in CLAUDE_CONFIG_DIRS without breaking.
          continue
        }
        for (const dirName of entries) {
          const dirPath = join(projectsDir, dirName)
          // Resolve before deduping so two CLAUDE_CONFIG_DIRS entries that
          // reach the same projects/<slug> directory (via symlinks or
          // overlapping configs) emit only one SessionSource.
          const resolved = resolve(dirPath)
          if (seenProjectDirs.has(resolved)) continue
          const dirStat = await stat(dirPath).catch(() => null)
          if (!dirStat?.isDirectory()) continue
          seenProjectDirs.add(resolved)
          sources.push({
            path: dirPath,
            project: dirName,
            provider: 'claude',
            ...(root.account ? { account: root.account, accountPath: root.accountPath } : {}),
          })
        }
      }

      // If the user explicitly set CLAUDE_CONFIG_DIRS and every entry was
      // unreadable, emit a one-line stderr hint. Catches the most common
      // misconfiguration: a Windows user typing `:` (POSIX delimiter) when
      // the platform expects `;`, which produces a single bogus path that
      // silently resolves to nothing on disk.
      const explicitMulti = process.env['CLAUDE_CONFIG_DIRS']
      if (!anyDirReadable && explicitMulti !== undefined && explicitMulti !== '' && roots.length > 0) {
        process.stderr.write(
          `codeburn: CLAUDE_CONFIG_DIRS was set but no listed directory could be read. ` +
          `Tried: ${roots.map(root => root.path).join(', ')}. ` +
          `Use "${pathDelimiter}" as the separator on this platform.\n`,
        )
      }

      const desktopRoot = desktopSessionsDir ?? getDesktopSessionsDir()
      const desktopDirs = await findDesktopProjectDirs(desktopRoot)
      for (const dirPath of desktopDirs) {
        const resolved = resolve(dirPath)
        if (seenProjectDirs.has(resolved)) continue
        seenProjectDirs.add(resolved)
        sources.push({
          path: dirPath,
          project: basename(dirPath),
          provider: 'claude',
          ...(shouldLabelDesktop ? { account: 'desktop', accountPath: desktopRoot } : {}),
        })
      }

      return sources
    },

    createSessionParser(): SessionParser {
      return {
        async *parse() {},
      }
    },
  }
}

export const claude = createClaudeProvider()
