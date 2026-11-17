import type { PlayerStatus, Settings } from '../core/types';
import { t, translateMessage, type Language, type LocalizedMessage, type MessageKey } from '../i18n';

const captionErrors = new Set<MessageKey>(['error.captions', 'error.noLanguage', 'error.noTimedCaptions', 'error.prepareCaptions']);
const setText = (element: HTMLElement, value: string) => { if (element.textContent !== value) element.textContent = value; };
function icon(settings = false) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [name, value] of Object.entries({ width: '20', height: '20', viewBox: settings ? '0 0 22 22' : '0 0 20 20', 'aria-hidden': 'true' })) svg.setAttribute(name, value);
  const shape = (name: string, attributes: Record<string, string>) => {
    const element = document.createElementNS(svg.namespaceURI, name);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    svg.append(element);
  };
  if (settings) {
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
    shape('path', { d: 'M3 6h9M17 6h2M3 16h2M10 16h9', 'stroke-linecap': 'round' });
    shape('circle', { cx: '14.5', cy: '6', r: '2.5' }); shape('circle', { cx: '7.5', cy: '16', r: '2.5' });
  } else {
    shape('rect', { x: '1', y: '5', width: '18', height: '4', rx: '2', fill: 'currentColor' });
    shape('rect', { x: '4', y: '12', width: '12', height: '4', rx: '2', fill: 'var(--caption-yellow)' });
  }
  return svg;
}

export class SubtitleOverlay {
  readonly host = document.createElement('div');
  private readonly root = this.host.attachShadow({ mode: 'open' });
  private readonly dock = document.createElement('div');
  private readonly toggle = document.createElement('button');
  private readonly toggleLabel = document.createElement('span');
  private readonly toggleState = document.createElement('span');
  private readonly retry = document.createElement('button');
  private readonly status = document.createElement('div');
  private readonly statusText = document.createElement('p');
  private readonly actions = document.createElement('div');
  private readonly captions = document.createElement('div');
  private readonly original = document.createElement('div');
  private readonly translated = document.createElement('div');
  private readonly settingsButton = document.createElement('button');
  private readonly statusSettings = document.createElement('button');
  private readonly listeners = new AbortController();
  private readonly mutation: MutationObserver;
  private readonly resize: ResizeObserver;
  private language: Language = 'en';
  private state?: PlayerStatus;
  private waitingForTranslation = false;
  private nativeAutoHide = false;
  private fallbackIdle = false;
  private idleTimer?: number;
  private keyboardFocus = false;
  private removed = false;
  private captionHeight = 0;

  constructor(private readonly player: HTMLElement, onToggle: () => void, onRetry: () => void, onSettings: () => void) {
    this.host.id = 'kotonoha-subtitles';
    const style = document.createElement('style');
    // Shadow DOM cannot inherit the extension page's stylesheet. Keep these values in sync with shared.css.
    style.textContent = `
      :host {
        --ink:#17212b; --plate:#0d1218; --plate-text:#fff; --plate-sub:#c9d2db; --caption-yellow:#ffd84a; --alert:#ff9c85; --focus:#1d5fd3;
        --ui-font:'Segoe UI Variable Text','Segoe UI',system-ui,-apple-system,'BIZ UDPGothic','Hiragino Sans','Yu Gothic UI',Meiryo,sans-serif;
        --top-safe:56px; --bottom-safe:64px; --caption-gap:16px; --caption-top:124px;
        position:absolute; inset:0; z-index:60; pointer-events:none; font:14px/1.55 var(--ui-font); color:var(--plate-text);
      }
      * { box-sizing:border-box; }
      button { color:inherit; font:600 14px/1.4 var(--ui-font); cursor:pointer; pointer-events:auto; }
      button:focus-visible { outline:3px solid var(--plate-text); outline-offset:2px; box-shadow:0 0 0 6px var(--plate); }
      .dock { position:absolute; right:12px; top:calc(var(--top-safe) + 8px); display:flex; flex-direction:column; align-items:flex-end; gap:8px; max-width:min(380px,calc(100% - 24px)); }
      .toolbar { display:flex; align-items:center; gap:6px; }
      .translation-switch { display:flex; align-items:center; gap:10px; height:44px; padding:0 12px 0 14px; border:1px solid #ffffff47; border-radius:22px; background:#0d1218e0; white-space:nowrap; }
      .translation-switch .state { min-width:2.4em; text-align:left; font-weight:700; }
      .track { position:relative; flex:none; width:36px; height:20px; border-radius:10px; background:#5a6672; }
      .track::after { content:''; position:absolute; top:3px; left:3px; width:14px; height:14px; border-radius:50%; background:var(--plate-text); }
      .translation-switch[aria-checked=true] .track { background:var(--caption-yellow); }
      .translation-switch[aria-checked=true] .track::after { transform:translateX(16px); background:var(--plate); }
      .translation-switch[aria-checked=true] .state { color:var(--caption-yellow); }
      .settings-button { display:grid; place-items:center; width:44px; height:44px; padding:0; border:1px solid #ffffff47; border-radius:50%; background:#0d1218e0; }
      .translation-switch:hover, .settings-button:hover { background:#26323e; }
      .status { max-width:100%; padding:10px 14px; border:1px solid #ffffff33; border-radius:10px; background:#0d1218e0; overflow-wrap:anywhere; pointer-events:auto; }
      .status[data-alert=true] { border-left:4px solid var(--alert); }
      .status p { margin:0; }
      .actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
      .actions button { min-height:44px; min-width:44px; padding:0 14px; border:1px solid #ffffff99; border-radius:8px; background:transparent; }
      .actions button.primary { color:var(--plate); background:var(--plate-text); border-color:var(--plate-text); }
      .actions button:hover { background:#ffffff29; }
      .actions button.primary:hover { background:#dce3ea; }
      .dock[data-visible=false] { opacity:0; }
      .dock[data-visible=false], .dock[data-visible=false] * { pointer-events:none; }
      .captions { position:absolute; left:8%; right:8%; bottom:calc(var(--bottom-safe) + var(--caption-gap)); text-align:center; font-size:26px; line-height:1.5; overflow:hidden; }
      .captions[data-position=top] { top:var(--caption-top); bottom:auto; }
      .line { display:-webkit-box; -webkit-box-orient:vertical; overflow:hidden; width:fit-content; max-width:100%; margin:0 auto; padding:.12em .5em; border-radius:.22em; background:#0d1218d1; white-space:pre-wrap; overflow-wrap:anywhere; pointer-events:none; }
      .translated { font-weight:700; }
      .translated.pending { font-weight:400; color:var(--plate-sub); }
      .original { margin-top:.25em; font-size:max(13px,.62em); color:#e3e8ed; }
      :host([data-compact=true]) .translation-label { display:none; }
      :host([data-compact=true]) .status { font-size:13px; padding:8px 10px 8px 12px; }
      :host([data-compact=true]) .status[data-alert=true] { display:flex; align-items:center; flex-wrap:wrap; gap:8px 10px; }
      :host([data-compact=true]) .status[data-alert=true] .actions { margin-top:0; }
      :host([data-compact=true]) .status[data-alert=true] .secondary { display:none; }
      [hidden] { display:none !important; }
      @media (prefers-reduced-motion:no-preference) { .dock { transition:opacity .15s; } .track::after { transition:transform .15s; } }
    `;
    this.dock.className = 'dock';
    const toolbar = document.createElement('div'); toolbar.className = 'toolbar';
    this.toggle.className = 'translation-switch'; this.toggle.setAttribute('role', 'switch');
    this.toggleLabel.className = 'translation-label'; this.toggleState.className = 'state';
    const track = document.createElement('span'); track.className = 'track'; track.setAttribute('aria-hidden', 'true');
    this.toggle.append(icon(), this.toggleLabel, this.toggleState, track);
    this.settingsButton.className = 'settings-button'; this.settingsButton.append(icon(true));
    for (const [button, action] of [[this.toggle, onToggle], [this.retry, onRetry], [this.settingsButton, onSettings], [this.statusSettings, onSettings]] as const) {
      button.type = 'button';
      button.addEventListener('click', event => { event.stopPropagation(); action(); }, { signal: this.listeners.signal });
    }
    toolbar.append(this.toggle, this.settingsButton);
    this.status.className = 'status'; this.status.setAttribute('role', 'status'); this.status.hidden = true;
    this.statusText.className = 'status-text'; this.actions.className = 'actions'; this.retry.className = 'primary';
    this.actions.append(this.retry, this.statusSettings); this.status.append(this.statusText, this.actions);
    this.dock.append(toolbar, this.status);
    this.captions.className = 'captions'; this.captions.hidden = true;
    this.translated.className = 'line translated'; this.original.className = 'line original';
    this.captions.append(this.translated, this.original);
    this.root.append(style, this.dock, this.captions);
    player.append(this.host);
    this.nativeAutoHide = player.classList.contains('ytp-autohide');
    this.mutation = new MutationObserver(records => {
      if (player.classList.contains('ytp-autohide') || records.some(record => record.oldValue?.split(/\s+/).includes('ytp-autohide'))) {
        this.nativeAutoHide = true;
        window.clearTimeout(this.idleTimer);
      }
      this.render();
    });
    this.mutation.observe(player, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
    this.resize = new ResizeObserver(() => this.render());
    this.resize.observe(player); this.resize.observe(this.dock); this.resize.observe(this.captions);
    const listen = { signal: this.listeners.signal };
    for (const event of ['pointermove', 'pointerenter', 'pointerdown']) player.addEventListener(event, this.onPointerActivity, listen);
    document.addEventListener('fullscreenchange', this.render, listen);
    this.root.addEventListener('focusin', this.onFocus, listen);
    this.root.addEventListener('focusout', () => queueMicrotask(this.onFocus), listen);
    this.root.addEventListener('keydown', event => { event.stopPropagation(); this.keyboardFocus = true; this.render(); }, listen);
    this.root.addEventListener('pointerdown', () => { this.keyboardFocus = false; this.render(); }, listen);
    this.status.addEventListener('click', event => event.stopPropagation(), listen);
    this.onPointerActivity();
  }

  private onPointerActivity = () => {
    if (this.removed) return;
    if (!this.nativeAutoHide) {
      this.fallbackIdle = false;
      window.clearTimeout(this.idleTimer);
      this.idleTimer = window.setTimeout(() => { this.fallbackIdle = true; this.render(); }, 3000);
    }
    this.render();
  };

  private onFocus = () => {
    const active = this.root.activeElement;
    this.keyboardFocus = active instanceof HTMLElement && active.matches(':focus-visible');
    this.render();
  };

  private render = () => {
    if (this.removed) return;
    const rect = this.player.getBoundingClientRect();
    const compact = rect.width > 0 && rect.width < 520;
    const fullscreen = Boolean(document.fullscreenElement?.contains(this.host)) || this.player.classList.contains('ytp-fullscreen');
    const topSafe = fullscreen ? 72 : 56;
    const controlsVisible = this.nativeAutoHide ? !this.player.classList.contains('ytp-autohide') : !this.fallbackIdle;
    this.host.dataset.compact = String(compact);
    this.host.dataset.controls = controlsVisible ? 'shown' : 'hidden';
    this.host.dataset.autohide = this.nativeAutoHide ? 'player' : 'fallback';
    this.host.style.setProperty('--top-safe', `${topSafe}px`);
    setText(this.toggleLabel, t(this.language, 'overlay.label'));
    setText(this.toggleState, t(this.language, this.state?.enabled ? 'overlay.on' : 'overlay.off'));
    this.toggle.setAttribute('aria-checked', String(Boolean(this.state?.enabled)));
    this.toggle.setAttribute('aria-label', t(this.language, 'overlay.toggleTitle'));
    this.toggle.title = t(this.language, 'overlay.toggleTitle');
    this.settingsButton.setAttribute('aria-label', t(this.language, 'overlay.settings'));
    this.settingsButton.title = t(this.language, 'overlay.settings');
    setText(this.retry, t(this.language, 'overlay.retry'));
    setText(this.statusSettings, t(this.language, 'overlay.settings'));
    const state = this.state;
    const noKey = state?.messageKey === 'error.startWithoutKey' || state?.messageKey === 'error.keyRequired';
    const error = state?.phase === 'error';
    let message: LocalizedMessage | undefined;
    if (state?.phase === 'loading') message = { messageKey: 'status.loading' };
    else if (state?.phase === 'waiting') {
      message = { messageKey: state.messageKey && state.messageKey !== 'status.waiting' ? state.messageKey : compact ? 'overlay.waitingShort' : 'overlay.waiting', params: state.params };
    } else if (error) {
      message = noKey ? { messageKey: compact ? 'overlay.noKeyShort' : 'overlay.noKey' }
        : compact ? { messageKey: !state.messageKey || captionErrors.has(state.messageKey) ? 'overlay.errorShort' : 'overlay.translationErrorShort' }
        : { messageKey: state.messageKey ?? 'overlay.error', params: state.params };
    }
    this.status.hidden = !message;
    setText(this.statusText, message ? translateMessage(this.language, message) : '');
    this.status.dataset.alert = String(error);
    this.actions.hidden = !error;
    this.retry.hidden = noKey;
    this.statusSettings.className = noKey ? 'primary' : 'secondary';
    this.dock.dataset.visible = String(controlsVisible || Boolean(message) || this.keyboardFocus);
    // Actual native-bar height wins; fallback values cover players that do not expose it.
    const nativeBar = this.player.querySelector<HTMLElement>('.ytp-chrome-bottom');
    const bar = nativeBar?.getBoundingClientRect();
    const bottomSafe = bar?.height && rect.bottom > bar.top ? Math.max(0, rect.bottom - bar.top) : fullscreen ? 88 : 64;
    const bottom = controlsVisible ? bottomSafe : 0;
    const gap = Math.min(rect.height / 2, Math.max(14, rect.height * .03));
    this.host.style.setProperty('--bottom-safe', `${bottom}px`);
    this.host.style.setProperty('--caption-gap', `${gap}px`);
    // Status text can be taller than the button row. Keep top captions below both.
    const dockHeight = this.dock.getBoundingClientRect().height;
    const captionTop = Math.min(Math.max(topSafe + 68, topSafe + 8 + dockHeight + 16), rect.height - gap);
    this.host.style.setProperty('--caption-top', `${captionTop}px`);
    this.captionHeight = Math.max(0, rect.height - gap - (this.captions.dataset.position === 'top' ? captionTop : bottom + gap));
    this.captions.style.maxHeight = `${this.captionHeight}px`;
    this.fitCaptions();
  };

  private fitCaptions() {
    // Measure actual wrapping: available fonts and glyph widths vary by OS.
    for (const line of [this.translated, this.original]) {
      line.style.webkitLineClamp = ''; line.style.removeProperty('display');
    }
    if (this.captions.hidden || !this.captionHeight) return;
    const measure = (line: HTMLElement) => {
      const style = getComputedStyle(line);
      return { height: line.getBoundingClientRect().height, lineHeight: parseFloat(style.lineHeight),
        padding: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom), margin: parseFloat(style.marginTop) };
    };
    const translated = measure(this.translated);
    const original = this.original.hidden ? undefined : measure(this.original);
    if (translated.height + (original ? original.height + original.margin : 0) <= this.captionHeight) return;
    // Keep whole lines at the configured font size. Reserve one original line when both fit;
    // otherwise prioritize the translation. Clamping keeps the full text in the DOM.
    const originalMinimum = original ? original.lineHeight + original.padding + original.margin : 0;
    const reserved = this.captionHeight >= translated.lineHeight + translated.padding + originalMinimum ? originalMinimum : 0;
    const clamp = (line: HTMLElement, size: ReturnType<typeof measure>, available: number) => {
      const lines = Math.max(0, Math.floor((available - size.padding) / size.lineHeight));
      if (!lines) { line.style.display = 'none'; return 0; }
      line.style.webkitLineClamp = String(lines);
      return Math.min(size.height, lines * size.lineHeight + size.padding);
    };
    const used = clamp(this.translated, translated, this.captionHeight - reserved);
    if (original) clamp(this.original, original, this.captionHeight - used - original.margin);
  }

  setLanguage(language: Language) {
    this.language = language;
    this.host.lang = language;
    if (this.waitingForTranslation) setText(this.translated, t(language, 'overlay.translating'));
    this.render();
  }

  configure(settings: Settings) {
    // Font size stays in fixed pixels in every player mode.
    this.captions.style.fontSize = `${settings.fontSize}px`;
    this.captions.dataset.position = settings.position;
    this.render();
  }

  setStatus(status: PlayerStatus) { this.state = status; this.render(); }

  show(original: string, translated: string, settings: Settings) {
    // Subtitle text is untrusted. Never render it as HTML.
    this.waitingForTranslation = !translated;
    setText(this.translated, translated || t(this.language, 'overlay.translating'));
    this.translated.classList.toggle('pending', !translated);
    setText(this.original, original);
    this.original.hidden = settings.displayMode !== 'bilingual';
    this.captions.hidden = !original;
    this.fitCaptions();
  }

  hide() { this.captions.hidden = true; }
  remove() {
    this.removed = true;
    window.clearTimeout(this.idleTimer);
    this.listeners.abort(); this.mutation.disconnect(); this.resize.disconnect();
    this.host.remove();
  }
}
