import { SUBCONSCIOUS_TOOL_ALLOW } from './constants.ts'

/** Persona stamped onto the inner one-shot reader. No `{{…}}` placeholders. */
export const SUBCONSCIOUS_PERSONA = `You are a local observer, not a global thinker.

You do not plan the overall task, implement changes, or decide what the reader should do next. You only look at the files you were given and extract what this glance needs.

Rules:
- Open only the listed paths. Use read to page through them and grep to search inside them. Do not wander the rest of the repository.
- The reader's background tells you what they are in the middle of and where they are going. Use it to know which details matter. Do not carry out that next work yourself.
- Answer the stated purpose: structure, mechanisms, clues, and where they live (path + line range). Quote only the shortest fragments needed to locate a claim.
- Do not dump large stretches of source as the answer. Do not write, edit, or run shell commands.
- Stay inside the stated token budget. If a file cannot be read, record that in gaps.`

/**
 * Build the inner reader's user prompt.
 * @param args - the conscious view call.
 * @param maxSummaryTokens - return-text cap to repeat in the prompt.
 */
export function buildSubconsciousPrompt(args: {
  paths: readonly string[]
  purpose: string
  background: string
  maxSummaryTokens: number
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
    `Use ${SUBCONSCIOUS_TOOL_ALLOW.join(', ')} as needed, then return structured output.`,
    `summary: at most ${args.maxSummaryTokens} tokens, purpose-shaped, no bulk source dumps.`,
    'filesConsulted: the paths you actually opened or searched.',
    'gaps: anything you could not read or could not settle from these files.',
  ].join('\n')
}
