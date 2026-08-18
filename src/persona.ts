import { SUBCONSCIOUS_TOOL_ALLOW } from './constants.ts'

/** Persona stamped onto the inner one-shot reader. No `{{…}}` placeholders. */
export const SUBCONSCIOUS_PERSONA = `You are a local observer, not a global thinker.

You do not plan the overall task, implement changes, or decide what the reader should do next. You only look at the files you were given and extract what this glance needs.

Rules:
- You do not have a view tool. Use read, grep, and glob, then submit the answer with structured_output. Do not finish with a plain-text reply.
- Open only the listed paths. Use read to page through them and grep to search inside them. Do not wander the rest of the repository.
- The reader's background tells you what they are in the middle of and where they are going. Use it to know which details matter. Do not carry out that next work yourself.
- Answer the stated purpose: structure, mechanisms, clues, and where they live (path + line range). Quote only the shortest fragments needed to locate a claim.
- Do not dump large stretches of source as the answer. Do not write, edit, or run shell commands.
- Stay inside the stated character budget. If the summary would overflow, drop the least relevant detail. If a file cannot be read, record that in gaps.`

/**
 * Build the inner reader's first-glance user prompt.
 * @param args - the conscious view call and character budget.
 */
export function buildSubconsciousPrompt(args: {
  paths: readonly string[]
  purpose: string
  background: string
  maxChars: number
}): string {
  const pathList = args.paths.map((path, index) => `${index + 1}. ${path}`).join('\n')
  return [
    '# Reader background',
    args.background.trim(),
    '',
    '# Purpose of this glance',
    args.purpose.trim(),
    '',
    '# Files to inspect',
    pathList,
    '',
    '# How to return',
    `Use ${SUBCONSCIOUS_TOOL_ALLOW.join(', ')} as needed, then call structured_output.`,
    `summary: at most ${args.maxChars} characters, purpose-shaped, no bulk source dumps.`,
    'filesConsulted: the paths you actually opened or searched.',
    'gaps: anything you could not read or could not settle from these files.',
  ].join('\n')
}

/**
 * Ask the observer to compress a previous summary that overran the budget.
 * @param args - previous capture and the character cap to hit.
 */
export function buildCompressPrompt(args: {
  purpose: string
  previousSummary: string
  filesConsulted: readonly string[]
  gaps: readonly string[]
  maxChars: number
  actualChars: number
}): string {
  const consulted = args.filesConsulted.length > 0
    ? args.filesConsulted.join('\n')
    : '(none recorded)'
  const gaps = args.gaps.length > 0 ? args.gaps.join('\n') : '(none)'
  return [
    '# Compress the previous summary',
    `The previous summary is ${args.actualChars} characters against a budget of ${args.maxChars} characters.`,
    `Call structured_output with summary at most ${args.maxChars} characters.`,
    'Keep the purpose-shaped facts and location clues. Drop the least relevant detail. Do not dump source.',
    'Do not re-read files unless the previous summary is missing a fact the purpose still needs.',
    '',
    '# Purpose of this glance',
    args.purpose.trim(),
    '',
    '# Previous summary',
    args.previousSummary.trim(),
    '',
    '# Previous filesConsulted',
    consulted,
    '',
    '# Previous gaps',
    gaps,
    'You may keep or correct filesConsulted and gaps.',
  ].join('\n')
}
