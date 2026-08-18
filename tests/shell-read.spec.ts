import { describe, expect, it } from 'vitest'
import { looksLikeFileContentReadCommand } from '../src/shell-read.ts'

describe('looksLikeFileContentReadCommand', () => {
  it('allows directory listing and process starts', () => {
    expect(looksLikeFileContentReadCommand('ls src')).toBe(false)
    expect(looksLikeFileContentReadCommand('find . -name "*.ts"')).toBe(false)
    expect(looksLikeFileContentReadCommand('wc -l package.json')).toBe(false)
    expect(looksLikeFileContentReadCommand('pnpm test')).toBe(false)
  })

  it('rejects obvious content reads and in-file searches', () => {
    expect(looksLikeFileContentReadCommand('cat src/index.ts')).toBe(true)
    expect(looksLikeFileContentReadCommand('head -n 20 README.md')).toBe(true)
    expect(looksLikeFileContentReadCommand('rg TODO src')).toBe(true)
    expect(looksLikeFileContentReadCommand('grep -n foo bar.ts')).toBe(true)
    expect(looksLikeFileContentReadCommand('git show HEAD:src/index.ts')).toBe(true)
    expect(looksLikeFileContentReadCommand('sed -n "1,20p" file.ts')).toBe(true)
  })
})
