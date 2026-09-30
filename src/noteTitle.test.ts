import { describe, expect, it } from 'vitest'
import { firstLineAsText, markdownFirstBlockCanName, markdownHeadingForText, markdownNamedAsCopy, noteTitleFromMarkdown } from './noteTitle'

describe('note title projection', () => {
  it('keeps meaningful punctuation when comparing rendered names', () => {
    expect(noteTitleFromMarkdown('C# Guide\n')).toBe('C# Guide')
    expect(noteTitleFromMarkdown('C++ Guide\n')).toBe('C++ Guide')
  })

  it('reads inline formatting but preserves escaped literal punctuation', () => {
    expect(noteTitleFromMarkdown('**Project** notes\n')).toBe('Project notes')
    expect(firstLineAsText('2 \\* 3')).toBe('2 * 3')
    expect(firstLineAsText('`x*y` notes')).toBe('x*y notes')
  })

  it('writes fallback names as literal heading text', () => {
    const heading = markdownHeadingForText('Plan *[draft]* & ~~later~~')
    expect(heading).toBe('# Plan \\*\\[draft\\]\\* &amp; \\~\\~later\\~\\~')
    expect(noteTitleFromMarkdown(heading)).toBe('Plan *[draft]* & ~~later~~')
  })

  it.each([
    '    const answer = 42\n',
    '\tconst answer = 42\n',
    '![A photograph](photo.png)\n',
    '[Images](my-states://panel/panel-1)\n',
    '| A | B |\n| - | - |\n',
    '[project]: https://example.com\n',
    '<table>\n',
  ])('does not derive a name from a non-text first block: %s', (markdown) => {
    expect(markdownFirstBlockCanName(markdown)).toBe(false)
    expect(noteTitleFromMarkdown(markdown)).toBe('')
  })

  it('copies formatted names by their rendered text and keeps the formatting', () => {
    expect(markdownNamedAsCopy('**Project**\n', ['Project'])).toBe('**Project** (copy)\n')
    expect(markdownNamedAsCopy('**Project**\n', ['Project', 'Project (copy)'])).toBe('**Project** (copy 2)\n')
  })

  it('puts a copy name above indented code without changing the code', () => {
    expect(markdownNamedAsCopy('    const answer = 42\n', ['Untitled note']))
      .toBe('Untitled note (copy)\n\n    const answer = 42\n')
  })
})
