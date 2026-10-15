// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Daniel Tralamazza
/**
 * The channel label column.
 *
 * [MEASURED] on 01-idle-empty-session.png at y=240: a 5 CSS px strip of the channel colour
 * at the far left, the "D0" tag in the *channel colour* starting at x=18, the channel name
 * in `#E0E0E0` starting at x=53, and below it one line per attached analyzer - a filled
 * square in the analyzer's colour then its name in small grey text. The column is 106 CSS
 * px wide including a 1 CSS px `#57575F` right border.
 *
 * Each cell's height is its row's height in the waveform stack, annotation lanes included,
 * so the labels line up with the traces by construction rather than by a shared constant
 * that could drift.
 *
 * Under the dark theme each cell renders as one rounded card (strip + body wrapped in
 * `.ch-card`), all cards exactly the trace-band height thanks to the `--ch-lane-offset`
 * margin and a reserved one-line decoder strip - see src/ui/NOTES.md section 13.
 */

import { formatAnalyzerNote } from './format.js';
import { t } from './i18n.js';
import { COLORS } from './metrics.js';
import { channelColor, type AnalyzerState, type ChannelState, type TriggerMode } from './state.js';

export interface ChannelCell {
  channel: ChannelState;
  /** Total CSS height, base row plus every lane this channel carries. */
  heightCss: number;
  /**
   * The lane part of `heightCss` (0 when the channel carries no annotations). The
   * dark theme's card reads it as `--ch-lane-offset` to hug the trace band, so
   * cards are one consistent height whether or not a decoder is attached.
   */
  laneCss: number;
  analyzers: AnalyzerState[];
  trigger: {
    active: boolean;
    masked: boolean;
    mode: TriggerMode;
    disabled: boolean;
    state: 'off' | 'waiting' | 'triggered' | 'not-found';
    summary: string;
  };
}

export interface ChannelListCallbacks {
  onToggle(index: number, enabled: boolean): void;
  onRename(index: number, name: string): void;
  /** Move the channel at `from` in display order to `to`. */
  onReorder(from: number, to: number): void;
  onRemoveAnalyzer(id: string): void;
  onSetTrigger(index: number, mode: TriggerMode): void;
}

export class ChannelList {
  private dragFrom = -1;
  private picker: HTMLDivElement | null = null;
  private pickerAnchor: HTMLButtonElement | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly cb: ChannelListCallbacks,
  ) {}

  render(cells: readonly ChannelCell[]): void {
    this.closePicker(false);
    this.root.replaceChildren();
    cells.forEach((cell, pos) => {
      const el = document.createElement('div');
      el.className = 'ch-cell';
      el.style.height = `${cell.heightCss}px`;
      el.draggable = true;
      el.dataset['pos'] = String(pos);
      if (!cell.channel.enabled) el.classList.add('disabled');
      /* Per-instance lane offset, set inline (house rule). A custom property, not
         inline padding: a property is inert until a rule reads it, so the default
         theme - where .ch-card is display:contents - stays pixel-identical. */
      if (cell.laneCss > 0) el.style.setProperty('--ch-lane-offset', `${cell.laneCss}px`);

      /* The card wrapper groups strip+body so a theme can render the cell as one
         rounded card; the chips container lets a theme reserve the decoder strip.
         Both are `display: contents` in the sheet's base layer, so until a theme
         opts in they are layout-invisible and change nothing. */
      const card = document.createElement('div');
      card.className = 'ch-card';
      el.appendChild(card);

      const strip = document.createElement('div');
      strip.className = 'ch-strip';
      strip.style.background = channelColor(cell.channel.index);
      card.appendChild(strip);

      const body = document.createElement('div');
      body.className = 'ch-body';

      const head = document.createElement('div');
      head.className = 'ch-head';

      const box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'ch-enable';
      box.checked = cell.channel.enabled;
      box.title = cell.channel.enabled ? t('channels.disable') : t('channels.enable');
      box.addEventListener('change', () => this.cb.onToggle(cell.channel.index, box.checked));
      head.appendChild(box);

      const tag = document.createElement('span');
      tag.className = 'ch-tag';
      tag.textContent = `D${cell.channel.index}`;
      tag.style.color = channelColor(cell.channel.index);
      head.appendChild(tag);

      const name = document.createElement('input');
      name.className = 'ch-name';
      name.value = cell.channel.name;
      name.spellcheck = false;
      name.title = t('channels.rename');
      name.placeholder = '···';
      // Committing on blur and on Enter, not on every keystroke: a re-render on each
      // character would take the caret with it. An empty name is valid: the D-tag is
      // the identity, the name is optional.
      const commit = () => {
        const v = name.value.trim();
        if (v !== cell.channel.name) this.cb.onRename(cell.channel.index, v);
      };
      name.addEventListener('blur', commit);
      name.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') name.blur();
        if (e.key === 'Escape') { name.value = cell.channel.name; name.blur(); }
        e.stopPropagation();
      });
      // Dragging the cell must not start from inside a text field, or the field is
      // unusable.
      name.addEventListener('mousedown', () => { el.draggable = false; });
      name.addEventListener('mouseup', () => { el.draggable = true; });
      head.appendChild(name);

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'ch-trigger' + (cell.trigger.active ? ' active' : '') +
        (cell.trigger.masked ? ' masked' : '');
      if (cell.trigger.active) trigger.classList.add(cell.trigger.state);
      trigger.replaceChildren(triggerIcon(cell.trigger.mode));
      trigger.title = cell.trigger.active
        ? t(cell.trigger.masked ? 'channels.triggerTitleMasked' : 'channels.triggerTitle',
          { summary: cell.trigger.summary })
        : t('channels.triggerConfigure', { index: cell.channel.index });
      trigger.disabled = cell.trigger.disabled;
      trigger.setAttribute('aria-pressed', String(cell.trigger.active && !cell.trigger.masked));
      trigger.setAttribute('aria-label', cell.trigger.active
        ? t(cell.trigger.masked ? 'channels.triggerAriaMasked' : 'channels.triggerAriaActive',
          { summary: cell.trigger.summary })
        : t('channels.triggerAriaOff', { index: cell.channel.index }));
      trigger.addEventListener('click', (event) => {
        event.stopPropagation();
        this.openPicker(trigger, cell.channel.index, cell.trigger.mode);
      });
      trigger.addEventListener('mousedown', () => { el.draggable = false; });
      trigger.addEventListener('mouseup', () => { el.draggable = true; });
      head.appendChild(trigger);
      body.appendChild(head);

      const chips = document.createElement('div');
      chips.className = 'ch-analyzers';

      for (const a of cell.analyzers) {
        const chip = document.createElement('div');
        chip.className = 'ch-analyzer';
        const sq = document.createElement('span');
        sq.className = 'ch-analyzer-sq';
        sq.style.background = a.color;
        chip.appendChild(sq);
        const txt = document.createElement('span');
        txt.textContent = a.label;
        txt.style.color = a.status === 'error' ? COLORS.negative : COLORS.text50;
        chip.appendChild(txt);
        const x = document.createElement('button');
        x.className = 'ch-analyzer-x';
        x.textContent = '×';
        x.title = t('channels.removeAnalyzer', { label: a.label });
        x.addEventListener('click', () => this.cb.onRemoveAnalyzer(a.id));
        chip.appendChild(x);
        chip.title = formatAnalyzerNote(a.note) || a.label;
        chips.appendChild(chip);
      }
      body.appendChild(chips);

      card.appendChild(body);

      el.addEventListener('dragstart', (e) => {
        this.dragFrom = pos;
        e.dataTransfer?.setData('text/plain', String(pos));
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        el.classList.add('drop-target');
      });
      el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('drop-target');
        if (this.dragFrom >= 0 && this.dragFrom !== pos) this.cb.onReorder(this.dragFrom, pos);
        this.dragFrom = -1;
      });

      this.root.appendChild(el);
    });
  }

  private openPicker(anchor: HTMLButtonElement, channel: number, selected: TriggerMode): void {
    if (this.pickerAnchor === anchor && this.picker) { this.closePicker(); return; }
    this.closePicker(false);
    const picker = document.createElement('div');
    picker.className = 'trigger-inline-picker';
    picker.setAttribute('role', 'radiogroup');
    picker.setAttribute('aria-label', t('channels.triggerPickerAria', { index: channel }));
    const modes: readonly TriggerMode[] = ['falling', 'rising', 'high', 'low', 'dont-care'];
    const names: Record<TriggerMode, string> = {
      falling: t('trigger.falling'), rising: t('trigger.rising'), high: t('channels.triggerHigh'),
      low: t('channels.triggerLow'), 'dont-care': t('channels.triggerAny'),
    };
    for (const mode of modes) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'trigger-inline-option' + (mode === selected ? ' selected' : '');
      option.title = names[mode];
      option.setAttribute('role', 'radio');
      option.setAttribute('aria-checked', String(mode === selected));
      option.appendChild(triggerIcon(mode));
      option.addEventListener('pointerdown', (event) => event.stopPropagation());
      option.addEventListener('click', (event) => {
        event.stopPropagation();
        this.closePicker();
        this.cb.onSetTrigger(channel, mode);
      });
      picker.appendChild(option);
    }
    const rect = anchor.getBoundingClientRect();
    picker.style.left = `${Math.round(rect.left)}px`;
    picker.style.top = `${Math.round(rect.top + rect.height / 2)}px`;
    document.body.appendChild(picker);
    this.picker = picker;
    this.pickerAnchor = anchor;
    requestAnimationFrame(() => picker.classList.add('open'));
    document.addEventListener('pointerdown', this.onOutsidePointerDown, true);
    document.addEventListener('keydown', this.onPickerKeyDown, true);
  }

  private readonly onOutsidePointerDown = (event: PointerEvent): void => {
    if (this.picker?.contains(event.target as Node) || this.pickerAnchor?.contains(event.target as Node)) return;
    this.closePicker();
  };

  private readonly onPickerKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.closePicker();
  };

  closePicker(animate = true): void {
    const picker = this.picker;
    this.picker = null;
    this.pickerAnchor = null;
    document.removeEventListener('pointerdown', this.onOutsidePointerDown, true);
    document.removeEventListener('keydown', this.onPickerKeyDown, true);
    if (!picker) return;
    picker.classList.remove('open');
    if (animate && picker.isConnected) setTimeout(() => picker.remove(), 140);
    else picker.remove();
  }
}

function triggerIcon(mode: TriggerMode): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const d = mode === 'falling' ? 'M1 3H9L15 13H23' : mode === 'rising' ? 'M1 13H9L15 3H23'
    : mode === 'high' ? 'M1 3H23' : mode === 'low' ? 'M1 13H23' : 'M5 3L19 13M19 3L5 13';
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'square');
  svg.appendChild(path);
  return svg;
}
