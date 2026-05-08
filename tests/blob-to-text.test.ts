import { describe, it, expect } from 'vitest'
import { blobToText } from '../src/sqlite.js'

describe('blobToText', () => {
  it('returns empty string for null', () => {
    expect(blobToText(null)).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(blobToText(undefined)).toBe('')
  })

  it('passes through strings unchanged', () => {
    expect(blobToText('hello world')).toBe('hello world')
  })

  it('decodes valid UTF-8 Uint8Array', () => {
    const buf = new TextEncoder().encode('café ☕')
    expect(blobToText(buf)).toBe('café ☕')
  })

  it('replaces invalid UTF-8 bytes with U+FFFD instead of crashing', () => {
    const buf = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x80, 0xfe])
    const result = blobToText(buf)
    expect(result).toContain('Hello')
    expect(result).toContain('�')
  })

  it('handles truncated multi-byte sequence', () => {
    // é in UTF-8 is [0xc3, 0xa9]. Truncate to just [0xc3].
    const buf = new Uint8Array([0x63, 0x61, 0x66, 0xc3])
    const result = blobToText(buf)
    expect(result).toBe('caf�')
  })

  it('handles empty Uint8Array', () => {
    expect(blobToText(new Uint8Array(0))).toBe('')
  })
})
