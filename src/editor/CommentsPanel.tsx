/**
 * Kommentar-Seitenleiste: Threads mit Zeitstempel, Antworten, Bearbeiten,
 * „Erledigt“ und Löschen (einzelne Nachricht oder ganzer Thread).
 */
import { useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, MessageSquare, MoreHorizontal, Pencil, RotateCcw, Trash2, X } from 'lucide-react';
import type { CommentMessage, CommentThread, Page } from '../../shared/types';
import { Menu, useMenu, type MenuItem } from '../components/ui';

import { locale, t } from '../i18n';
const fmt = { format: (ts: number) => new Intl.DateTimeFormat(locale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(ts) };

export interface CommentActions {
  onCreate(text: string): void;
  onCancelPending(): void;
  onReply(pageIndex: number, threadId: string, text: string): void;
  onEdit(pageIndex: number, threadId: string, messageId: string, text: string): void;
  onDeleteMessage(pageIndex: number, threadId: string, messageId: string): void;
  onResolve(pageIndex: number, threadId: string, resolved: boolean): void;
  onDeleteThread(pageIndex: number, threadId: string): void;
  onSelect(pageIndex: number, threadId: string): void;
  onClose(): void;
}

export function CommentsPanel({
  pages,
  active,
  pending,
  showResolved,
  onShowResolved,
  actions,
}: {
  pages: Page[];
  active: { pageIndex: number; id: string } | null;
  pending: { pageIndex: number } | null;
  showResolved: boolean;
  onShowResolved: (v: boolean) => void;
  actions: CommentActions;
}) {
  const threads = pages.flatMap((p, pageIndex) => p.comments.map((t) => ({ t, pageIndex })));
  const visible = threads.filter(({ t }) => showResolved || !t.resolved || t.id === active?.id);
  const open = threads.filter(({ t }) => !t.resolved).length;

  return (
    <aside className="comments-panel" data-testid="comments-panel" onKeyDown={(e) => e.stopPropagation()}>
      <header className="comments-header">
        <MessageSquare size={17} strokeWidth={1.8} />
        <h3>{t('Kommentare')}</h3>
        <span className="comments-count">{t('{n} offen', { n: open })}</span>
        <button className="icon-btn" onClick={actions.onClose} aria-label={t('Kommentare schließen')} data-testid="comments-close">
          <X size={16} />
        </button>
      </header>
      <label className="comments-filter">
        <input type="checkbox" checked={showResolved} onChange={(e) => onShowResolved(e.target.checked)} data-testid="show-resolved" />
        {t('Erledigte anzeigen')}
      </label>

      <div className="comments-list">
        {pending && <Composer key="pending" title={t('Neuer Kommentar · Seite {n}', { n: pending.pageIndex + 1 })} submitLabel={t('Kommentieren')} onSubmit={actions.onCreate} onCancel={actions.onCancelPending} autoFocus testId="new-comment" />}
        {visible.length === 0 && !pending && (
          <p className="comments-empty">{t('Noch keine Kommentare. Wähle das Kommentar-Werkzeug (C) und tippe auf eine Stelle der Seite.')}</p>
        )}
        {visible.map(({ t, pageIndex }) => (
          <ThreadCard key={t.id} thread={t} pageIndex={pageIndex} active={active?.id === t.id} actions={actions} />
        ))}
      </div>
    </aside>
  );
}

function ThreadCard({ thread, pageIndex, active, actions }: { thread: CommentThread; pageIndex: number; active: boolean; actions: CommentActions }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);
  return (
    <div
      ref={ref}
      className={`thread${active ? ' active' : ''}${thread.resolved ? ' resolved' : ''}`}
      onClick={() => !active && actions.onSelect(pageIndex, thread.id)}
      data-testid="comment-thread"
    >
      <div className="thread-top">
        <span className="thread-page">{t('Seite {n}', { n: pageIndex + 1 })}</span>
        {thread.resolved && <span className="thread-badge">{t('Erledigt')}</span>}
        <span className="thread-spacer" />
        <button
          className="icon-btn"
          title={thread.resolved ? t('Wieder öffnen') : t('Als erledigt markieren')}
          onClick={(e) => {
            e.stopPropagation();
            actions.onResolve(pageIndex, thread.id, !thread.resolved);
          }}
          data-testid="thread-resolve"
        >
          {thread.resolved ? <RotateCcw size={15} /> : <CheckCircle2 size={16} />}
        </button>
        <button
          className="icon-btn danger"
          title={t('Thread löschen')}
          onClick={(e) => {
            e.stopPropagation();
            actions.onDeleteThread(pageIndex, thread.id);
          }}
          data-testid="thread-delete"
        >
          <Trash2 size={15} />
        </button>
      </div>
      {thread.messages.map((m, i) => (
        <Message key={m.id} m={m} first={i === 0} onEdit={(text) => actions.onEdit(pageIndex, thread.id, m.id, text)} onDelete={() => actions.onDeleteMessage(pageIndex, thread.id, m.id)} />
      ))}
      {active && !thread.resolved && <Composer placeholder={t('Antworten …')} submitLabel={t('Antworten')} onSubmit={(text) => actions.onReply(pageIndex, thread.id, text)} testId="reply" />}
    </div>
  );
}

function Message({ m, first, onEdit, onDelete }: { m: CommentMessage; first: boolean; onEdit: (t: string) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const menu = useMenu();
  const items: MenuItem[] = [
    { id: 'msg-edit', label: t('Bearbeiten'), icon: <Pencil size={15} />, onSelect: () => setEditing(true) },
    { id: 'msg-delete', label: first ? t('Löschen (mit Antworten, falls letzte)') : t('Antwort löschen'), icon: <Trash2 size={15} />, danger: true, onSelect: onDelete },
  ];
  return (
    <div className={`message${first ? ' first' : ''}`} data-testid="comment-message">
      <div className="message-head">
        <span className="message-author">{first ? t('Ich') : t('Antwort')}</span>
        <span className="message-time">
          {fmt.format(m.createdAt)}
          {m.editedAt ? `· ${t('bearbeitet')}` : ''}
        </span>
        <button
          className="icon-btn message-more"
          aria-label={t('Nachricht-Aktionen')}
          onClick={(e) => {
            e.stopPropagation();
            menu.openBelow(e.currentTarget, 'end');
          }}
          data-testid="message-more"
        >
          <MoreHorizontal size={15} />
        </button>
      </div>
      {editing ? (
        <Composer
          initial={m.text}
          submitLabel={t('Speichern')}
          onSubmit={(t) => {
            onEdit(t);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
          autoFocus
          testId="edit-message"
        />
      ) : (
        <p className="message-text">{m.text}</p>
      )}
      {menu.menu && <Menu {...menu.menu} items={items} onClose={menu.close} />}
    </div>
  );
}

function Composer({
  title,
  initial = '',
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
  autoFocus,
  testId,
}: {
  title?: string;
  initial?: string;
  placeholder?: string;
  submitLabel: string;
  onSubmit: (t: string) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  testId?: string;
}) {
  const [text, setText] = useState(initial);
  const submit = () => {
    if (!text.trim()) return;
    onSubmit(text.trim());
    setText('');
  };
  return (
    <div className="composer" onClick={(e) => e.stopPropagation()}>
      {title && <div className="composer-title">{title}</div>}
      <textarea
        value={text}
        placeholder={placeholder ?? t('Kommentar schreiben …')}
        autoFocus={autoFocus}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || !e.shiftKey)) {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') onCancel?.();
        }}
        data-testid={testId ? `${testId}-input` : undefined}
      />
      <div className="composer-actions">
        {onCancel && (
          <button className="btn btn-ghost" onClick={onCancel}>
            {t('Abbrechen')}
          </button>
        )}
        <button className="btn btn-primary" disabled={!text.trim()} onClick={submit} data-testid={testId ? `${testId}-submit` : undefined}>
          <Check size={15} /> {submitLabel}
        </button>
      </div>
    </div>
  );
}
