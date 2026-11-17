import { describe, expect, it } from 'vitest'
import { widthOf } from './notesImage'

describe('a picture width', () => {
  it('is read as a share of the page when written with a percent sign', () => {
    expect(widthOf('50%')).toBe('50%')
    expect(widthOf(' 33.4% ')).toBe('33%')
  })

  it('never goes past the whole page', () => {
    expect(widthOf('140%')).toBe('100%')
  })

  it('keeps the pixel width an older note was saved with', () => {
    expect(widthOf('320')).toBe(320)
    expect(widthOf(320)).toBe(320)
  })

  it('is nothing at all when there is no usable width', () => {
    expect(widthOf(null)).toBeNull()
    expect(widthOf(undefined)).toBeNull()
    expect(widthOf('0%')).toBeNull()
    expect(widthOf('wide')).toBeNull()
    expect(widthOf('10')).toBeNull()
  })
})
