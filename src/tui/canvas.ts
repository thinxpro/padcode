import type { Caps } from './caps.js';
import { reset, sgr, type Style } from './theme.js';
import { charWidth } from '../text-width.js';

// A fixed grid for drawings whose parts sit at fixed columns. Text is plain; each cell keeps its style.
interface Cell { char: string; open: string }
export class Canvas {
  private cells: Cell[][];
  constructor(readonly width: number, readonly height: number, private readonly caps: Caps) {
    this.cells = Array.from({ length: Math.max(0, height) }, () => Array.from({ length: Math.max(0, width) }, () => ({ char: ' ', open: '' })));
  }
  // Writes text from (row, column); anything outside the grid is clipped. Wide characters take two cells.
  put(row: number, column: number, text: string, style: Style = {}): this {
    const line = this.cells[row];
    if (!line) return this;
    const open = sgr(this.caps, style);
    let at = Math.round(column);
    for (const char of text) {
      const w = charWidth(char);
      if (w === 0) continue;
      if (at >= 0 && at + w <= this.width) {
        line[at] = { char, open };
        if (w === 2) line[at + 1] = { char: '', open };
      }
      at += w;
    }
    return this;
  }
  // Centres text on a column.
  centre(row: number, column: number, text: string, style: Style = {}): this {
    const width = [...text].reduce((sum, char) => sum + charWidth(char), 0);
    return this.put(row, column - Math.floor(width / 2), text, style);
  }
  lines(): string[] {
    return this.cells.map(line => {
      let out = '', current = '';
      for (const cell of line) {
        if (cell.open !== current) { out += (current ? reset : '') + cell.open; current = cell.open; }
        out += cell.char;
      }
      return current ? out + reset : out;
    });
  }
}
