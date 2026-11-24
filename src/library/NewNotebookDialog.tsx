import { useMemo, useState } from 'react';
import { Ban, Check } from 'lucide-react';
import type { NotebookMeta, Orientation, PageFormat, PaperColor, PaperTemplate } from '../../shared/types';
import { Modal, Segmented } from '../components/ui';
import { COVER_COLORS, DEFAULT_COVER_COLOR } from '../lib/colors';
import { FORMAT_GROUPS, formatLabel, isPageFormat, pageSize, paperColorOptions, templateOptions } from '../lib/formats';
import { PaperBackground } from '../paper/PaperBackground';
import { NotebookCover } from './Covers';
import { inkOn } from '../lib/palette';
import { t } from '../i18n';

export interface NewNotebookValues {
  title: string;
  coverColor: string | null;
  template: PaperTemplate;
  paperColor: PaperColor;
  format: PageFormat;
  orientation: Orientation;
}

const LAST_KEY = 'pw.lastNotebookSettings';

function loadLast(): Partial<NewNotebookValues> {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}');
  } catch {
    return {};
  }
}

/**
 * „Neues Notizbuch“ (SPEC §2.1): Titel, Umschlag, Papier, Papierfarbe, Format, Ausrichtung.
 * Die zuletzt gewählten Einstellungen werden als Standard gemerkt.
 */
export function NewNotebookDialog({
  defaultTitle,
  isTaken,
  onCreate,
  onClose,
  initial,
  mode = 'create',
}: {
  defaultTitle: string;
  isTaken: (title: string) => boolean;
  onCreate: (values: NewNotebookValues) => void;
  onClose: () => void;
  initial?: Partial<NotebookMeta>;
  mode?: 'create' | 'cover';
}) {
  const last = useMemo(loadLast, []);
  const [title, setTitle] = useState(initial?.title ?? defaultTitle);
  const [coverColor, setCoverColor] = useState<string | null>(initial ? (initial.coverColor ?? null) : last.coverColor !== undefined ? last.coverColor : DEFAULT_COVER_COLOR);
  const [template, setTemplate] = useState<PaperTemplate>(initial?.template ?? last.template ?? 'ruled');
  const [paperColor, setPaperColor] = useState<PaperColor>(initial?.paperColor ?? last.paperColor ?? 'white');
  const [format, setFormat] = useState<PageFormat>(() => [initial?.format, last.format].find(isPageFormat) ?? 'A4');
  const [orientation, setOrientation] = useState<Orientation>(initial?.orientation ?? last.orientation ?? 'portrait');

  const trimmed = title.trim();
  const error = !trimmed ? t('Bitte gib einen Titel ein.') : isTaken(trimmed) ? t('Name bereits vergeben, bitte wähle einen anderen Namen.') : null;
  const size = pageSize(format, orientation);
  const values: NewNotebookValues = { title: trimmed, coverColor, template, paperColor, format, orientation };

  const submit = () => {
    if (error) return;
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({ coverColor, template, paperColor, format, orientation }));
    } catch {
      /* optional */
    }
    onCreate(values);
    onClose();
  };

  const isCoverMode = mode === 'cover';

  return (
    <Modal
      title={isCoverMode ? t('Umschlag ändern') : t('Neues Notizbuch')}
      onClose={onClose}
      width={isCoverMode ? 520 : 820}
      testId="new-notebook-dialog"
      footer={
        <>
          <button className="btn" onClick={onClose} data-testid="dialog-cancel">
            {t('Abbrechen')}
          </button>
          <button className="btn btn-primary" disabled={!!error} onClick={submit} data-testid="create-notebook">
            {isCoverMode ? t('Übernehmen') : t('Notizbuch erstellen')}
          </button>
        </>
      }
    >
      <div className={isCoverMode ? 'nb-dialog nb-dialog-compact' : 'nb-dialog'}>
        <div className="nb-preview">
          <NotebookCover nb={{ ...values, title: trimmed || t('Unbenannt') }} width={orientation === 'portrait' ? 150 : 190} />
          {!isCoverMode && (
            <div className="nb-preview-page">
              <PaperBackground
                template={template}
                paperColor={paperColor}
                width={size.w}
                height={size.h}
                strokeScale={2.2}
                style={{ width: orientation === 'portrait' ? 150 : 190, aspectRatio: `${size.w} / ${size.h}`, display: 'block' }}
              />
            </div>
          )}
        </div>

        <div className="nb-form">
          {!isCoverMode && (
            <label className="field">
              <span className="field-label">{t('Titel')}</span>
              <input
                className="input"
                value={title}
                autoFocus
                maxLength={120}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                data-testid="notebook-title"
              />
              {error && trimmed && <span className="field-error">{error}</span>}
            </label>
          )}

          <div className="field">
            <span className="field-label">{t('Umschlag')}</span>
            <div className="swatches">
              <button
                className={`swatch swatch-none${coverColor === null ? ' selected' : ''}`}
                title={t('Kein Umschlag')}
                aria-label={t('Kein Umschlag')}
                onClick={() => setCoverColor(null)}
                data-cover="none"
              >
                <Ban size={16} strokeWidth={1.75} />
              </button>
              {COVER_COLORS.map((c) => (
                <button key={c} className={`swatch${coverColor === c ? ' selected' : ''}`} style={{ background: c }} aria-label={` ${c}`} onClick={() => setCoverColor(c)} data-cover={c}>
                  {coverColor === c && <Check size={14} strokeWidth={2.5} color={inkOn(c)} />}
                </button>
              ))}
            </div>
          </div>

          {!isCoverMode && (
            <>
              <div className="field">
                <span className="field-label">{t('Papier')}</span>
                <div className="template-grid">
                  {templateOptions().map((o) => (
                    <button key={o.id} className={`template-option${template === o.id ? ' selected' : ''}`} onClick={() => setTemplate(o.id)} data-template={o.id}>
                      <PaperBackground
                        template={o.id}
                        paperColor={paperColor}
                        width={size.w}
                        height={size.h}
                        crop={{ w: 200, h: 200 * (size.h / size.w) }}
                        strokeScale={1.6}
                        className="template-thumb"
                        style={{ aspectRatio: `${size.w} / ${size.h}` }}
                      />
                      <span>{o.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <span className="field-label">{t('Papierfarbe')}</span>
                  <Segmented value={paperColor} options={paperColorOptions()} onChange={setPaperColor} testId="paper-color" />
                </div>
                <div className="field">
                  <span className="field-label">{t('Format')}</span>
                  <select className="select format-select" value={format} onChange={(e) => setFormat(e.target.value as PageFormat)} data-testid="format">
                    {FORMAT_GROUPS.map((g) => (
                      <optgroup key={g.label} label={t(g.label)}>
                        {g.formats.map((f) => (
                          <option key={f} value={f}>
                            {formatLabel(f)}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <span className="field-label">{t('Ausrichtung')}</span>
                  <Segmented
                    value={orientation}
                    options={[
                      { id: 'portrait', label: t('Hoch') },
                      { id: 'landscape', label: t('Quer') },
                    ]}
                    onChange={setOrientation}
                    testId="orientation"
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
