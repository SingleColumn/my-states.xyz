import { useState } from 'react'
import type { PanelArchitectureReport } from './panelArchitectureReport'

export function PanelArchitectureReportView({ report, onClose }: { report: PanelArchitectureReport; onClose(): void }) {
  const [copied, setCopied] = useState(false)
  const copyJson = async () => {
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="architecture-report-backdrop" role="presentation" onClick={onClose}>
      <section className="architecture-report" role="dialog" aria-modal="true" aria-labelledby="architecture-report-title" onClick={(event) => event.stopPropagation()}>
        <header className="architecture-report-header">
          <div>
            <h2 id="architecture-report-title">Panel architecture report</h2>
            <p>{report.moment.name} · {report.summary.panelCount} panels · {report.summary.shapeCount} shapes</p>
          </div>
          <div className="architecture-report-actions">
            <button type="button" onClick={() => void copyJson()}>{copied ? 'Copied' : 'Copy JSON'}</button>
            <button type="button" onClick={onClose}>Close</button>
          </div>
        </header>

        <div className={`architecture-report-status is-${report.summary.status.toLowerCase()}`}>
          {report.summary.status} · {report.summary.errors} errors · {report.summary.warnings} warnings
        </div>

        <h3>Checks</h3>
        <ul className="architecture-report-checks">
          {report.checks.map((check) => (
            <li key={check.id}>
              <strong className={`architecture-report-check-status is-${check.status.toLowerCase()}`}>{check.status}</strong>
              <span><b>{check.label}</b> — {check.details}</span>
            </li>
          ))}
        </ul>

        <h3>Panel mappings</h3>
        <div className="architecture-report-table-wrap">
          <table>
            <thead><tr><th>panelId</th><th>type</th><th>renderer</th><th>shapeId</th><th>position</th><th>size</th></tr></thead>
            <tbody>
              {report.panels.map((panel) => (
                <tr key={panel.panelId}>
                  <td>{panel.panelId}</td>
                  <td>{panel.panelType}</td>
                  <td>{panel.rendererKey ?? 'MISSING'}</td>
                  <td>{panel.shape.shapeId ?? 'MISSING'}</td>
                  <td>{panel.shape.position ? `${Math.round(panel.shape.position.x)}, ${Math.round(panel.shape.position.y)}` : 'MISSING'}</td>
                  <td>{panel.shape.size ? `${Math.round(panel.shape.size.w)} × ${Math.round(panel.shape.size.h)}` : 'MISSING'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3>Ownership</h3>
        <pre>{JSON.stringify(report.ownership, null, 2)}</pre>
      </section>
    </div>
  )
}
