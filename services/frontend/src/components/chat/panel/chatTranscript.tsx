import { Fragment, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import type { ChatItem } from '../../../types'
import { Icon } from '../../presentation/chrome/Icon'
import { ProgressiveTranscriptEntry } from './ProgressiveTranscriptEntry'
import { useProgressiveChatHistory } from './useProgressiveChatHistory'
import { indexWhxNoticeRuns } from './noticePresentation'

type TranscriptProps = ReturnType<typeof useProgressiveChatHistory> & {
  composerOnly: boolean
  busy: boolean
  taskInFlight: boolean
  whxNoticeRuns: ReturnType<typeof indexWhxNoticeRuns>
  expandedWhxNoticeRunId: string
  setExpandedWhxNoticeRunId: Dispatch<SetStateAction<string>>
  renderChatEntry: (item: ChatItem) => ReactNode
}

export function ChatTranscript({ composerOnly, busy, taskInFlight, whxNoticeRuns, expandedWhxNoticeRunId, setExpandedWhxNoticeRunId, renderChatEntry, afterHeight, beforeHeight, endRef, hasOlder, hasNewer, hiddenItemCount, hiddenNewerItemCount, loadOlder, loadNewer, onScroll: onHistoryScroll, streamRef, visibleItems }: TranscriptProps) {
  return <>
    {!composerOnly && <div ref={streamRef} className="chat-stream" onScroll={onHistoryScroll}>
      {beforeHeight > 0 && (
        <div className="chat-virtual-spacer" aria-hidden="true" style={{ height: beforeHeight }}/>
      )}
      {hasOlder && <div className="chat-history-loader"><span><Icon name="arrow-up" size={12}/> {hiddenItemCount} mensagem(ns) anterior(es)</span><button type="button" onClick={loadOlder}>Carregar mensagens anteriores</button></div>}
      {visibleItems.map((item, index) => {
        const previousNotices = whxNoticeRuns.previousByLatestId.get(item.id) || []
        if (whxNoticeRuns.hiddenIds.has(item.id)) return null
        const runExpanded = previousNotices.length > 0 && expandedWhxNoticeRunId === item.id
        const entry = <Fragment>
          {previousNotices.length > 0 && <div className="whx-notice-run">
            <button type="button" className="whx-notice-stack-toggle" aria-expanded={runExpanded} aria-label={runExpanded ? 'Ocultar notificações WHX anteriores' : `Mostrar ${previousNotices.length} notificações WHX anteriores`} onClick={() => setExpandedWhxNoticeRunId((current) => current === item.id ? '' : item.id)}>
              <span aria-hidden="true">···</span><small>{runExpanded ? 'ocultar anteriores' : `${previousNotices.length} anterior${previousNotices.length === 1 ? '' : 'es'}`}</small>
            </button>
            {runExpanded && <div className="whx-notice-run-history">{previousNotices.map(renderChatEntry)}</div>}
          </div>}
          {renderChatEntry(item)}
        </Fragment>
        return <ProgressiveTranscriptEntry key={item.id} streamRef={streamRef} deferUntilNear={index < visibleItems.length - 4} priority={index} variant={item.role === 'user' ? 'user' : 'assistant'}>{entry}</ProgressiveTranscriptEntry>
      })}
      {hasNewer && <div className="chat-history-loader newer"><span>{hiddenNewerItemCount} mensagem(ns) mais recente(s)</span><button type="button" onClick={loadNewer}>Carregar mensagens mais recentes</button></div>}
      {afterHeight > 0 && (
        <div className="chat-virtual-spacer" aria-hidden="true" style={{ height: afterHeight }}/>
      )}
      {busy && !taskInFlight && <div className="chat-thought live"><span className="thought-mark"><Icon name="agent" size={13}/></span><div><strong>Wharnex</strong><div className="thinking"><span/><span/><span/> A processar o pedido</div></div></div>}
      <div ref={endRef}/>
    </div>}

  </>
}
