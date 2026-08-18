/**
 * Heuristic: does this shell string look like it would print file contents
 * or search inside files? Not a sandbox — models can still smuggle reads
 * through interpreters. The point is to bounce obvious `cat` / `rg` so the
 * conscious agent uses `view` instead.
 */

const CONTENT_READ_WORDS = [
  /\b(?:cat|head|tail|less|more|bat|nl|od|hexdump|strings|tac|rev)\b/i,
  /\b(?:rg|grep|egrep|fgrep|ag|ack|ripgrep)\b/i,
  /\bawk\b/i,
  /\bsed\b(?![^\n]*\s-[^\s]*i)/i,
  /\bgit(?:\s+\S+)*\s+(?:show|diff|log|blame|grep)\b/i,
  /\b(?:python3?|node|perl|ruby|php)(?:\s+\S+)*\s+-[ce]\b/i,
  /\b(?:Get-Content|Select-String|Out-String|type|findstr)\b/i,
]

/** True when a bash/pwsh `command` string looks like a content read or in-file search. */
export function looksLikeFileContentReadCommand(command: string): boolean {
  const text = command.trim()
  if (text === '') return false
  return CONTENT_READ_WORDS.some(pattern => pattern.test(text))
}
