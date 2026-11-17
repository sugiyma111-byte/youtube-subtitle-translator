import type { PlayerStatus, Settings } from '../core/types';
import { t, translateMessage, type Language } from '../i18n';

export class SubtitleOverlay {
  readonly host = document.createElement('div');
  private readonly root = this.host.attachShadow({ mode: 'open' });
  private readonly toggle = document.createElement('button');
  private readonly retry = document.createElement('button');
  private readonly status = document.createElement('div');
  private readonly captions = document.createElement('div');
  private readonly original = document.createElement('div');
  private readonly translated = document.createElement('div');
  private readonly settingsButton = document.createElement('button');
  private language: Language = 'en';
  private state?: PlayerStatus;
  private waitingForTranslation = false;

  constructor(player: HTMLElement, onToggle: () => void, onRetry: () => void, onSettings: () => void) {
    this.host.id = 'kotonoha-subtitles';
    const style = document.createElement('style');
    style.textContent = `
      :host { position:absolute; inset:0; z-index:60; pointer-events:none; font-family:'Segoe UI','Yu Gothic UI','Meiryo',sans-serif; color:white; }
      * { box-sizing:border-box; }
      .toolbar { position:absolute; top:14px; right:16px; display:flex; gap:5px; align-items:center; pointer-events:auto; }
      button { cursor:pointer; border:1px solid #ffffff35; color:#fff; background:#17372ee8; font:600 12px/1.4 'Segoe UI','Yu Gothic UI',sans-serif; padding:7px 11px; border-radius:7px; }
      button:hover { background:#24694feb; } button:focus-visible { outline:3px solid #b5e0c3; outline-offset:2px; }
      button[aria-pressed=true] { background:#237759; }
      .status { position:absolute; top:53px; right:16px; max-width:min(430px,80%); background:#15251fe8; font-size:12px; line-height:1.6; padding:8px 12px; border-radius:7px; }
      .captions { position:absolute; left:6%; right:6%; bottom:64px; text-align:center; line-height:1.55; font-size:26px; }
      .line { width:fit-content; max-width:100%; margin:5px auto 0; padding:3px 10px; border-radius:5px; background:#10231fe0; color:#fff; white-space:pre-wrap; overflow-wrap:anywhere; text-shadow:0 1px 2px #000; }
      .translated { font-weight:600; } .original { font-size:.65em; background:#13251eaf; color:#edf5ed; }
      [hidden] { display:none !important; }
      @media (max-width:600px) { .captions { left:3%; right:3%; bottom:52px; font-size:20px !important; } }
    `;
    const toolbar = document.createElement('div'); toolbar.className = 'toolbar';
    this.toggle.addEventListener('click', event => { event.stopPropagation(); onToggle(); });
    this.retry.hidden = true;
    this.retry.addEventListener('click', event => { event.stopPropagation(); onRetry(); });
    this.settingsButton.addEventListener('click', event => { event.stopPropagation(); onSettings(); });
    toolbar.append(this.toggle, this.retry, this.settingsButton);
    this.status.className = 'status'; this.status.setAttribute('role', 'status'); this.status.hidden = true;
    this.captions.className = 'captions'; this.captions.hidden = true;
    this.translated.className = 'line translated'; this.original.className = 'line original';
    this.captions.append(this.translated, this.original);
    this.root.append(style, toolbar, this.status, this.captions);
    this.setLanguage(this.language);
    player.append(this.host);
  }

  setLanguage(language: Language) {
    this.language = language;
    this.host.lang = language;
    this.toggle.textContent = t(language, this.state?.enabled ? 'overlay.on' : 'overlay.off');
    this.toggle.title = t(language, 'overlay.toggleTitle');
    this.retry.textContent = t(language, 'overlay.retry');
    this.settingsButton.textContent = t(language, 'overlay.settings');
    this.settingsButton.title = t(language, 'overlay.settingsTitle');
    if (this.state) this.setStatus(this.state);
    if (this.waitingForTranslation) this.translated.textContent = t(language, 'overlay.translating');
  }

  configure(settings: Settings) {
    this.captions.style.fontSize = `${settings.fontSize}px`;
    this.captions.style.top = settings.position === 'top' ? '100px' : 'auto';
    this.captions.style.bottom = settings.position === 'bottom' ? '64px' : 'auto';
  }

  setStatus(status: PlayerStatus) {
    this.state = status;
    this.toggle.textContent = t(this.language, status.enabled ? 'overlay.on' : 'overlay.off');
    this.toggle.setAttribute('aria-pressed', String(status.enabled));
    this.retry.hidden = status.phase !== 'error';
    this.status.textContent = status.messageKey ? translateMessage(this.language, { messageKey: status.messageKey, params: status.params }) : '';
    this.status.hidden = !status.messageKey || status.phase === 'ready' || status.phase === 'idle';
  }

  show(original: string, translated: string, settings: Settings) {
    // Subtitle text is untrusted. Never render it as HTML.
    this.waitingForTranslation = !translated;
    this.translated.textContent = translated || t(this.language, 'overlay.translating');
    this.original.textContent = original;
    this.original.hidden = settings.displayMode !== 'bilingual';
    this.captions.hidden = !original;
  }

  hide() { this.captions.hidden = true; }
  remove() { this.host.remove(); }
}
