import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { useAppState } from '../AppState'
import { PanelHeader, usePanelCommands } from '../PanelHeader'
import { panelContentProps } from '../panelSurface'
import { enabledVideoCatalogItems, resolveVideoCatalogItem, videoCatalog } from '../videoCatalog'
import { VideoProvider } from '../video/VideoProvider'

export function VideoPanel({ panelId }: { panelId: string }) {
  const { panels } = useAppState()
  const commands = usePanelCommands()
  const found = panels.get(panelId)
  const panel = found?.type === 'video' ? found : undefined
  const selectedVideoId = panel?.config.selectedVideoId ?? null
  const focusView = panel?.focusView === true
  const availableVideos = enabledVideoCatalogItems()
  const selection = resolveVideoCatalogItem(selectedVideoId)

  function selectVideo(value: string) {
    if (!availableVideos.some((item) => item.id === value)) return
    panels.updateConfig<'video'>(panelId, { selectedVideoId: value })
  }

  return (
    <section className={`panel panel-video-surface${focusView ? ' is-focus-view' : ''}`}>
      <PanelHeader
        panelId={panelId}
        panelType="video"
        title="Video"
        menuItems={[{
          id: 'focus-view',
          label: focusView ? 'Expand panel to full view' : 'Adjust panel to focus view',
          icon: focusView ? <ChevronsUpDown size={17} aria-hidden="true" /> : <ChevronsDownUp size={17} aria-hidden="true" />,
          onSelect: () => commands.togglePanelFocusView(panelId),
        }]}
      />

      <div className="video-panel-body" {...panelContentProps}>
        {!focusView ? (
          <label className="video-panel-selector">
            <span>Choose video</span>
            <select
              aria-label="Choose video"
              value={selection.status === 'available' ? selection.item.id : ''}
              disabled={!availableVideos.length}
              onChange={(event) => selectVideo(event.target.value)}
            >
              <option value="" disabled>{availableVideos.length ? 'Choose a video' : 'No videos available'}</option>
              {availableVideos.map((item) => <option value={item.id} key={item.id}>{item.title} — {item.creator}</option>)}
            </select>
          </label>
        ) : null}

        <div className="video-panel-stage card-content">
          {!availableVideos.length ? (
            <div className="video-panel-message" role="status">
              <strong>No videos are currently available.</strong>
              <span>The application owner can add videos to the curated catalogue.</span>
            </div>
          ) : selection.status === 'none' ? (
            <div className="video-panel-message" role="status">
              <strong>No video selected.</strong>
              <span>{focusView ? 'Leave focus view to choose a video.' : 'Choose a video from the list above.'}</span>
            </div>
          ) : selection.status === 'unavailable' ? (
            <div className="video-panel-message" role="status">
              <strong>This video is no longer available.</strong>
              <span>{focusView ? 'Leave focus view to choose another video.' : 'Choose another video from the list above.'}</span>
            </div>
          ) : (
            <VideoProvider key={selection.item.id} item={selection.item} />
          )}
        </div>
      </div>
    </section>
  )
}
