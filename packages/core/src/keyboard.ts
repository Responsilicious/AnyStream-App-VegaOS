/**
 * The on-screen keyboard for the server address, username and password (docs/sign-in.md). One structure for
 * all three: a grid of characters ten to a row, then a row of controls. What changes is which characters and
 * shortcuts are offered. Cells a field has no use for are left out, never shown disabled, so focus cannot land
 * on them.
 */

export type KeyboardMode = 'server' | 'username' | 'password';

/** Letters, symbols, or accented letters for international names and passwords. */
export type KeyPage = 'letters' | 'symbols' | 'accents';

/** Text being edited and where the caret sits (0 = before the first character). */
export interface TextEdit {
  text: string;
  caret: number;
}

export type KeyAction =
  | { type: 'char'; value: string }
  | { type: 'insert'; value: string }
  | { type: 'shift' }
  | { type: 'page'; page: KeyPage }
  | { type: 'space' }
  | { type: 'left' }
  | { type: 'right' }
  | { type: 'delete' }
  | { type: 'clear' }
  | { type: 'done' };

export interface KeyCell {
  /** Stable within a layout, for React keys and focus. */
  id: string;
  label: string;
  /** What a screen reader says; a lone symbol is read by name. */
  spoken: string;
  action: KeyAction;
  /** Width in character cells. */
  span: number;
  /** Shown as switched on (Shift held, or the page in use). */
  active?: boolean;
}

/** Longest text each field takes; past this a key press changes nothing. */
export const MAX_LENGTH: Record<KeyboardMode, number> = { server: 256, username: 128, password: 256 };

/** Characters per grid row, as in docs/design/connect-mockup.png and sign-in-mockup.png. */
export const KEY_COLUMNS = 6;

const LETTERS = ['abcdef', 'ghijkl', 'mnopqr', 'stuvwx'];

/**
 * Address keyboard: the letters, then the punctuation an address needs, then digits. The two cells the
 * mockup leaves empty after 5 and 0 hold the underscore and the Symbols key.
 */
const SERVER_LETTERS = [...LETTERS, 'yz.:/-', '12345_', '67890'];

/**
 * The rest of the URL characters, digits kept in place. The last row holds only the letters key, so that key
 * stays in the same row as the Symbols key it replaces and keeps focus.
 */
const SERVER_SYMBOLS = ['~?#&=%', '+@[]!$', "'()*,;", '_.:/-', '12345', '67890', ''];

const CREDENTIAL_LETTERS = [...LETTERS, 'yz1234', '567890'];

/** Every printable ASCII symbol, plus euro, pound and Spanish marks. */
const CREDENTIAL_SYMBOLS = ['!@#$%^', '&*()-_', '=+[]{}', '\\|;:\'"',',.<>/?', '`~€£¿¡'];

/** Latin letters with marks, for names and passwords typed in other languages. */
const ACCENTS = ['àáâäãå', 'æçèéêë', 'ìíîïñò', 'óôöõøœ', 'ßùúûüý', 'ÿłśźżč'];

/** Typing shortcuts on the address keyboard (docs/design/connect-mockup.png). */
export const SERVER_SHORTCUTS = ['http://', 'https://', ':8096'];

const SPOKEN: Record<string, string> = {
  '.': 'full stop',
  '-': 'hyphen',
  ':': 'colon',
  '/': 'slash',
  '_': 'underscore',
  '@': 'at sign',
  '~': 'tilde',
  '?': 'question mark',
  '#': 'hash',
  '&': 'ampersand',
  '=': 'equals',
  '%': 'percent',
  '+': 'plus',
  '[': 'left bracket',
  ']': 'right bracket',
  '!': 'exclamation mark',
  $: 'dollar',
  "'": 'apostrophe',
  '(': 'left parenthesis',
  ')': 'right parenthesis',
  '*': 'asterisk',
  ',': 'comma',
  ';': 'semicolon',
  '^': 'caret',
  '{': 'left brace',
  '}': 'right brace',
  '\\': 'backslash',
  '|': 'vertical bar',
  '"': 'quotation mark',
  '<': 'less than',
  '>': 'greater than',
  '`': 'backtick',
};

/** Upper case where a single upper-case letter exists; ß and dotless ı stay as they are. */
export function shifted(ch: string): string {
  const upper = ch.toUpperCase();
  return upper.length === 1 && upper !== ch ? upper : ch;
}

function charCell(ch: string, shift: boolean): KeyCell {
  const value = shift ? shifted(ch) : ch;
  const isLetter = value.toLowerCase() !== value.toUpperCase();
  const spoken = SPOKEN[value] ?? (isLetter && value === value.toUpperCase() ? `capital ${value}` : value);
  return { id: `c:${ch}`, label: value, spoken, action: { type: 'char', value }, span: 1 };
}

function rowOf(chars: string, shift: boolean): KeyCell[] {
  return Array.from(chars).map(ch => charCell(ch, shift));
}

function control(id: string, label: string, spoken: string, action: KeyAction, span: number, active?: boolean): KeyCell {
  return { id, label, spoken, action, span, active };
}

/** The credential keyboards cycle letters → symbols → accents; the key names the page it goes to. */
function credentialPageKey(page: KeyPage): KeyCell {
  switch (page) {
    case 'letters':
      return control('k:page', '#+= Symbols', 'Symbols', { type: 'page', page: 'symbols' }, 2);
    case 'symbols':
      return control('k:page', 'àé Accents', 'Accented letters', { type: 'page', page: 'accents' }, 2);
    default:
      return control('k:page', 'abc Letters', 'Letters', { type: 'page', page: 'letters' }, 2);
  }
}

/**
 * Every row of the keyboard, top to bottom: six character rows, then controls. Each row is six cells wide,
 * and a key keeps its row and id across Shift and pages, so the focused key never disappears. The address
 * keyboard has the shortcut row and no Shift or Space, because addresses are lower case and have no spaces.
 */
export function keyboardRows(mode: KeyboardMode, page: KeyPage, shift: boolean): KeyCell[][] {
  const third = 4 / 3;
  const editing = [
    control('k:left', '‹', 'Move cursor left', { type: 'left' }, 1),
    control('k:right', '›', 'Move cursor right', { type: 'right' }, 1),
    control('k:delete', 'Delete', 'Delete', { type: 'delete' }, third),
    control('k:clear', 'Clear', 'Clear', { type: 'clear' }, third),
    control('k:done', 'Done', 'Done, close keyboard', { type: 'done' }, third),
  ];

  if (mode === 'server') {
    const symbols = page === 'symbols';
    const rows = (symbols ? SERVER_SYMBOLS : SERVER_LETTERS).map(r => rowOf(r, false));
    rows[rows.length - 1].push(
      symbols
        ? control('k:page', 'abc', 'Letters', { type: 'page', page: 'letters' }, 1)
        : control('k:page', '#+=', 'Symbols', { type: 'page', page: 'symbols' }, 1),
    );
    rows.push([
      ...SERVER_SHORTCUTS.map(s => control(`s:${s}`, s, s.replace(/[:/]+/g, ' ').trim(), { type: 'insert', value: s }, 1.25)),
      ...['.', '/', ':'].map(s => control(`s:${s}`, s, SPOKEN[s], { type: 'insert', value: s }, 0.75)),
    ]);
    rows.push(editing);
    return rows;
  }

  const grid = page === 'symbols' ? CREDENTIAL_SYMBOLS : page === 'accents' ? ACCENTS : CREDENTIAL_LETTERS;
  const rows = grid.map(r => rowOf(r, page === 'symbols' ? false : shift));
  rows.push([
    control('k:shift', 'Shift', shift ? 'Shift, on' : 'Shift', { type: 'shift' }, 2, shift),
    credentialPageKey(page),
    control('k:space', 'Space', 'Space', { type: 'space' }, 2),
  ]);
  rows.push(editing);
  return rows;
}

function clampCaret(edit: TextEdit): number {
  return Math.max(0, Math.min(edit.caret, edit.text.length));
}

/** Inserts at the caret, keeping exact case and spaces. Text that would overflow is not inserted at all. */
export function insertText(edit: TextEdit, value: string, max: number): TextEdit {
  const caret = clampCaret(edit);
  if (edit.text.length + value.length > max) {
    return edit;
  }
  return { text: edit.text.slice(0, caret) + value + edit.text.slice(caret), caret: caret + value.length };
}

/**
 * Applies a key to the text. Shift, page and Done do not change text and are handled by the keyboard itself;
 * they return the text unchanged.
 */
export function applyKey(edit: TextEdit, action: KeyAction, max: number): TextEdit {
  const caret = clampCaret(edit);
  switch (action.type) {
    case 'char':
    case 'insert':
      return insertText(edit, action.value, max);
    case 'space':
      return insertText(edit, ' ', max);
    case 'left':
      return { text: edit.text, caret: Math.max(0, caret - 1) };
    case 'right':
      return { text: edit.text, caret: Math.min(edit.text.length, caret + 1) };
    case 'delete':
      return caret === 0 ? { text: edit.text, caret } : { text: edit.text.slice(0, caret - 1) + edit.text.slice(caret), caret: caret - 1 };
    case 'clear':
      return { text: '', caret: 0 };
    default:
      return { text: edit.text, caret };
  }
}

/** A password as dots, one per character. */
export function maskText(text: string): string {
  return '•'.repeat(Array.from(text).length);
}

/** Starts editing with the caret after the existing text. */
export function startEdit(text: string): TextEdit {
  return { text, caret: text.length };
}
