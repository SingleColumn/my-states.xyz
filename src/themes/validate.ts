import { THEME_SCHEMA_VERSION, type ThemeDefinition, type ThemeMode } from './types'
import { isGroupSpec, themeModeSpec, type GroupSpec, type ValueKind } from './tokens'

export const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
export const THEME_VERSION_PATTERN = /^\d+\.\d+\.\d+$/
export const THEME_NAME_MAX_LENGTH = 80
export const THEME_VALUE_MAX_LENGTH = 512
/** Generous for JSON this size; a file over it is not a theme. */
export const THEME_FILE_MAX_BYTES = 64 * 1024

/**
 * A theme is input, so the whole file is checked and every problem is
 * reported together, each by its path, so an author (or an agent) can fix
 * them in one pass rather than one per attempt.
 */
export class ThemeValidationError extends Error {
  readonly problems: readonly string[]
  constructor(problems: string[]) {
    super(`Theme could not be imported:\n${problems.map((problem) => `- ${problem}`).join('\n')}`)
    this.name = 'ThemeValidationError'
    this.problems = problems
  }
}

/**
 * `CSS.supports(property, value)`, injected because it only exists in a
 * browser. The property stands in for the kind of value the token takes.
 */
export type SupportsCssValue = (property: string, value: string) => boolean

export const acceptEveryValue: SupportsCssValue = () => true

const cssPropertyForKind: Record<Exclude<ValueKind, 'choice'>, string> = {
  color: 'color',
  background: 'background',
  shadow: 'box-shadow',
  filter: 'backdrop-filter',
  border: 'border',
  font: 'font-family',
  stroke: 'stroke-width',
  radius: 'border-radius',
  weight: 'font-weight',
  angle: 'rotate',
  length: 'padding-left',
}

/**
 * Nothing in a theme may reach outside the page. `url()` and its relatives
 * would make requests to another host from an app whose promise is that
 * nothing leaves the browser; `var()` would tie a theme to internal names
 * that are not part of its contract. The compiler builds every derived
 * expression itself, so a theme never needs either.
 */
const unsafeValuePattern = /\b(url|src|image|image-set|cross-fade|var|attr|env|element|expression|paint)\s*\(|[@<>;{}\\]/i

export function isSafeCssValue(value: string): boolean {
  return !unsafeValuePattern.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validateGroup(value: unknown, group: GroupSpec, path: string, supports: SupportsCssValue, problems: string[]) {
  if (!isRecord(value)) {
    problems.push(`${path} must be an object`)
    return
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`
    const spec = group.fields[key]
    if (!spec) {
      problems.push(`${childPath} is not a supported property`)
      continue
    }
    if (isGroupSpec(spec)) {
      validateGroup(child, spec, childPath, supports, problems)
      continue
    }
    if (typeof child !== 'string' || !child.trim()) {
      problems.push(`${childPath} must be a non-empty string`)
      continue
    }
    if (spec.kind === 'choice') {
      if (!spec.values!.includes(child)) problems.push(`${childPath} must be one of: ${spec.values!.join(', ')}`)
      continue
    }
    if (child.length > THEME_VALUE_MAX_LENGTH) {
      problems.push(`${childPath} must be at most ${THEME_VALUE_MAX_LENGTH} characters`)
      continue
    }
    if (!isSafeCssValue(child)) {
      problems.push(`${childPath} must not contain url(), var() or other references`)
      continue
    }
    if (!supports(cssPropertyForKind[spec.kind], child)) {
      problems.push(`${childPath} is not a valid ${spec.kind} value: ${JSON.stringify(child)}`)
    }
  }
}

function validateMode(value: unknown, path: string, supports: SupportsCssValue, problems: string[]): value is ThemeMode {
  const before = problems.length
  validateGroup(value, themeModeSpec, path, supports, problems)
  return problems.length === before
}

const optionalStringFields = ['author', 'description', 'derivedFrom'] as const
const knownTopLevelKeys = new Set(['schemaVersion', 'id', 'name', 'version', 'modes', ...optionalStringFields])

/**
 * Accepts a parsed theme file or throws a ThemeValidationError listing every
 * problem found. The result is the same object, narrowed; nothing is
 * normalised or dropped, so what was validated is what is stored.
 */
export function validateThemeDefinition(value: unknown, supports: SupportsCssValue): ThemeDefinition {
  const problems: string[] = []
  if (!isRecord(value)) throw new ThemeValidationError(['the file must contain a JSON object'])

  if (value.schemaVersion !== THEME_SCHEMA_VERSION) {
    problems.push(typeof value.schemaVersion === 'number' && value.schemaVersion > THEME_SCHEMA_VERSION
      ? `schemaVersion ${value.schemaVersion} needs a newer version of my-states (this one reads ${THEME_SCHEMA_VERSION})`
      : `schemaVersion must be ${THEME_SCHEMA_VERSION}`)
  }
  if (typeof value.id !== 'string' || !THEME_ID_PATTERN.test(value.id) || value.id.length > 64) {
    problems.push('id must be lower-case letters, digits and hyphens, starting with a letter or digit (at most 64 characters)')
  }
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > THEME_NAME_MAX_LENGTH) {
    problems.push(`name must be a non-empty string of at most ${THEME_NAME_MAX_LENGTH} characters`)
  }
  if (typeof value.version !== 'string' || !THEME_VERSION_PATTERN.test(value.version)) {
    problems.push('version must be a version number such as 1.0.0')
  }
  for (const field of optionalStringFields) {
    if (value[field] !== undefined && (typeof value[field] !== 'string' || (value[field] as string).length > THEME_VALUE_MAX_LENGTH)) {
      problems.push(`${field} must be a string of at most ${THEME_VALUE_MAX_LENGTH} characters`)
    }
  }
  for (const key of Object.keys(value)) {
    if (!knownTopLevelKeys.has(key)) problems.push(`${key} is not a supported property`)
  }

  if (!isRecord(value.modes)) {
    problems.push('modes must be an object with a light and/or a dark mode')
  } else {
    const modeNames = Object.keys(value.modes)
    for (const name of modeNames) {
      if (name !== 'light' && name !== 'dark') problems.push(`modes.${name} is not a supported mode; use light or dark`)
      else validateMode(value.modes[name], `modes.${name}`, supports, problems)
    }
    if (!modeNames.some((name) => name === 'light' || name === 'dark')) problems.push('modes must define at least one of light or dark')
  }

  if (problems.length) throw new ThemeValidationError(problems)
  return value as unknown as ThemeDefinition
}

/** The whole import pipeline from file text: size, JSON, then the definition. */
export function parseThemeFile(text: string, supports: SupportsCssValue): ThemeDefinition {
  if (new TextEncoder().encode(text).byteLength > THEME_FILE_MAX_BYTES) {
    throw new ThemeValidationError([`the file is larger than ${THEME_FILE_MAX_BYTES / 1024} KB`])
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ThemeValidationError(['the file is not valid JSON'])
  }
  return validateThemeDefinition(parsed, supports)
}

/** The modes a definition carries, light first. */
export function modesOf(definition: ThemeDefinition): Array<'light' | 'dark'> {
  return (['light', 'dark'] as const).filter((mode) => definition.modes[mode] !== undefined)
}
