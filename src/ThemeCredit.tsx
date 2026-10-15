import { ExternalLink } from 'lucide-react'
import { isWebAddress } from './themes/validate'

/**
 * Credit for the published theme (VS Code, Obsidian, Typora...) that the
 * current theme is inspired by. Nothing is drawn when the theme has none.
 */
export function ThemeCredit({ url }: { url?: string }) {
  // Checked again here because a stored theme is data and the value becomes a link
  if (!url || !isWebAddress(url)) return null
  let host = url
  try { host = new URL(url).hostname.replace(/^www\./, '') } catch { /* keep the raw text */ }
  return (
    <a className="theme-credit" href={url} target="_blank" rel="noopener noreferrer" title={`Original theme that inspired this look (${host})`}>
      <ExternalLink aria-hidden="true" size={10} />
      <span>Theme credit</span>
    </a>
  )
}
