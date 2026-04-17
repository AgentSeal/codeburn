import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  MAX_SESSION_FILE_BYTES,
  STREAM_THRESHOLD_BYTES,
  readSessionFile,
} from '../src/fs-utils.js'

describe('readSessionFile', () => {
  const tmpDirs: string[] = []

  afterEach(async () => {
    delete process.env.CODEBURN_VERBOSE
    while (tmpDirs.length > 0) {
      const d = tmpDirs.pop()
      if (d) await rm(d, { recursive: true, force: true })
    }
  })

  async function tmpPath(content: string | Buffer): Promise<string> {
    const base = await mkdtemp(join(tmpdir(), 'codeburn-fs-'))
    tmpDirs.push(base)
    const p = join(base, 'x.jsonl')
    await writeFile(p, content)
    return p
  }

  it('returns content for small files via readFile fast path', async () => {
    const p = await tmpPath('hello\nworld\n')
    expect(await readSessionFile(p)).toBe('hello\nworld\n')
  })

  it('returns content for files at the stream threshold via stream path', async () => {
    const p = await tmpPath(Buffer.alloc(STREAM_THRESHOLD_BYTES, 'a'))
    const got = await readSessionFile(p)
    expect(got).not.toBeNull()
    expect(got!.length).toBe(STREAM_THRESHOLD_BYTES)
  })

  it('returns null and skips files over the cap', async () => {
    const p = await tmpPath(Buffer.alloc(MAX_SESSION_FILE_BYTES + 1, 'b'))
    expect(await readSessionFile(p)).toBeNull()
  })

  it('emits stderr warning under CODEBURN_VERBOSE=1 for skipped file', async () => {
    process.env.CODEBURN_VERBOSE = '1'
    const p = await tmpPath(Buffer.alloc(MAX_SESSION_FILE_BYTES + 1, 'c'))
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await readSessionFile(p)
    expect(spy).toHaveBeenCalled()
    const msg = (spy.mock.calls[0][0] as string)
    expect(msg).toContain('codeburn')
    expect(msg).toContain('oversize')
    spy.mockRestore()
  })

  it('returns null on stat failure without throwing', async () => {
    expect(await readSessionFile('/nonexistent/path/x.jsonl')).toBeNull()
  })
})
