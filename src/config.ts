import { randomBytes } from 'crypto'
import { mkdir, open, readFile, rename, unlink } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

const CONFIG_DIR_MODE = 0o700
const CONFIG_FILE_MODE = 0o600

export type CodeburnConfig = {
  currency?: {
    code: string
    symbol?: string
  }
}

function getConfigDir(): string {
  return join(homedir(), '.config', 'codeburn')
}

function getConfigPath(): string {
  return join(getConfigDir(), 'config.json')
}

export async function readConfig(): Promise<CodeburnConfig> {
  try {
    const raw = await readFile(getConfigPath(), 'utf-8')
    return JSON.parse(raw) as CodeburnConfig
  } catch {
    return {}
  }
}

export async function saveConfig(config: CodeburnConfig): Promise<void> {
  await mkdir(getConfigDir(), { recursive: true, mode: CONFIG_DIR_MODE })
  const finalPath = getConfigPath()
  const tempPath = `${finalPath}.${randomBytes(8).toString('hex')}.tmp`
  const payload = JSON.stringify(config, null, 2) + '\n'
  const handle = await open(tempPath, 'w', CONFIG_FILE_MODE)
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
}

export function getConfigFilePath(): string {
  return getConfigPath()
}
