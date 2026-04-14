/**
 * Generic config file management for ~/.config/codeburn/config.json.
 *
 * This module handles reading and writing the config file only.
 * Feature-specific logic (e.g. currency) lives in its own module
 * and imports from here.
 */

import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

export type CodeburnConfig = {
  currency?: {
    code: string
    symbol?: string  // optional override, otherwise resolved via Intl
  }
}

function getConfigDir(): string {
  return join(homedir(), '.config', 'codeburn')
}

function getConfigPath(): string {
  return join(getConfigDir(), 'config.json')
}

/** Reads the config file. Returns an empty object if the file is missing or invalid. */
export async function readConfig(): Promise<CodeburnConfig> {
  try {
    const raw = await readFile(getConfigPath(), 'utf-8')
    return JSON.parse(raw) as CodeburnConfig
  } catch {
    return {}
  }
}

/** Writes the config to disk, creating ~/.config/codeburn/ if needed. */
export async function saveConfig(config: CodeburnConfig): Promise<void> {
  await mkdir(getConfigDir(), { recursive: true })
  await writeFile(getConfigPath(), JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

/** Returns the absolute path to the config file (for display in CLI output). */
export function getConfigFilePath(): string {
  return getConfigPath()
}
