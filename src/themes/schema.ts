import { THEME_SCHEMA_VERSION } from './types'
import { isGroupSpec, themeModeSpec, type GroupSpec, type LeafSpec } from './tokens'
import { THEME_ID_PATTERN, THEME_NAME_MAX_LENGTH, THEME_VALUE_MAX_LENGTH, THEME_VERSION_PATTERN } from './validate'

/**
 * theme.schema.json, generated from the same spec the validator walks so the
 * document handed to authors and agents cannot say something the importer
 * does not enforce. schema.test.ts checks the committed file against this
 * and says how to regenerate it when they differ.
 */

type JsonSchema = Record<string, unknown>

const kindHints: Record<Exclude<LeafSpec['kind'], 'choice'>, string> = {
  color: 'A CSS colour, e.g. "#1a1612" or "rgba(255, 255, 255, 0.16)".',
  background: 'A CSS background: a colour, or one or more gradients.',
  shadow: 'A CSS box-shadow, e.g. "0 26px 70px rgba(0, 0, 0, 0.34)" or "none".',
  filter: 'A CSS backdrop-filter, e.g. "blur(18px)" or "none".',
  border: 'A CSS border shorthand, e.g. "1px solid #333".',
  font: 'A CSS font-family stack. Only fonts already available to the browser.',
  stroke: 'A CSS stroke-width, a plain number such as "1.5" or a length such as "4px".',
  radius: 'A CSS border-radius length, e.g. "12px" or "0".',
  weight: 'A CSS font-weight, e.g. "500" or "700".',
  angle: 'A CSS angle, e.g. "-1.5deg" or "0deg".',
  length: 'A CSS length, e.g. "14px" or "0px".',
}

function leafSchema(spec: LeafSpec): JsonSchema {
  if (spec.kind === 'choice') return { type: 'string', enum: [...spec.values!], description: spec.description }
  return {
    type: 'string',
    minLength: 1,
    maxLength: THEME_VALUE_MAX_LENGTH,
    description: `${spec.description} ${kindHints[spec.kind]} Must not contain url(), var() or other references.`,
  }
}

function groupSchema(group: GroupSpec): JsonSchema {
  return {
    type: 'object',
    description: group.description,
    additionalProperties: false,
    properties: Object.fromEntries(Object.entries(group.fields).map(([key, spec]) => [key, isGroupSpec(spec) ? groupSchema(spec) : leafSchema(spec)])),
  }
}

export function buildThemeJsonSchema(): JsonSchema {
  const mode = groupSchema(themeModeSpec)
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://my-states.xyz/theme.schema.json',
    title: 'my-states theme',
    description: 'A theme for my-states: structured values the application turns into its own CSS custom properties. Themes change how the application looks, never where panels sit. Every value is optional; the application derives what a theme leaves out.',
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'id', 'name', 'version', 'modes'],
    properties: {
      schemaVersion: { const: THEME_SCHEMA_VERSION, description: 'The theme format version this file is written for.' },
      id: { type: 'string', pattern: THEME_ID_PATTERN.source, maxLength: 64, description: 'A stable identifier, unique in the local theme library. Lower-case letters, digits and hyphens.' },
      name: { type: 'string', minLength: 1, maxLength: THEME_NAME_MAX_LENGTH, description: 'The name shown in the theme picker.' },
      version: { type: 'string', pattern: THEME_VERSION_PATTERN.source, description: "The theme's own version, e.g. 1.0.0." },
      author: { type: 'string', maxLength: THEME_VALUE_MAX_LENGTH, description: 'Who made the theme.' },
      description: { type: 'string', maxLength: THEME_VALUE_MAX_LENGTH, description: 'A sentence about the theme.' },
      derivedFrom: { type: 'string', maxLength: THEME_VALUE_MAX_LENGTH, description: 'The id of the theme this one was based on. Informational only.' },
      modes: {
        type: 'object',
        description: 'The modes the theme supports. At least one of light or dark.',
        additionalProperties: false,
        minProperties: 1,
        properties: { light: mode, dark: mode },
      },
    },
  }
}
