export interface GridLayout {
  cols: number; // columns the smallest pieces reach
  rows: number;
  pitch: number; // minimum cell size (mm)
  top: number; // top edge of the first row in grid space (mm, relative to the grid origin)
  slots: { x: number; y: number }[]; // per piece index, grid space (right, up)
}

/**
 * The inventory: pieces sorted by size (bbox diagonal, largest first) and flowed into rows.
 * Pieces are sorted by height (shelf packing) so each row holds pieces of similar height; a
 * cell is at least `pitch` wide/tall and otherwise the piece's own footprint in the grid frame,
 * and a row is as tall as its tallest piece, so nothing overlaps. Rows are centred.
 * The frame (origin, right, up) is the camera's at the moment the explode starts.
 */
export function computeGrid(
  widths: number[],
  heights: number[],
  diagonals: number[],
  viewWidthMm: number,
  viewHeightMm: number,
  aspect: number,
): GridLayout {
  const n = diagonals.length;
  const W = viewWidthMm * 0.92;
  const cols = Math.max(8, Math.min(40, Math.round(23 * aspect)));
  const pitch = W / cols;
  const pad = 1.12;
  // Shelf packing: sort by height so every row holds pieces of similar height (diagonal breaks ties).
  const order = heights.map((h, i) => [h, diagonals[i], i] as const).sort((a, b) => b[0] - a[0] || b[1] - a[1] || a[2] - b[2]);
  const slots: { x: number; y: number }[] = new Array(n);
  const top = viewHeightMm / 2 - pitch * 0.9;

  let y = top;
  let k = 0;
  let rows = 0;
  while (k < n) {
    // gather one row
    const row: { i: number; cw: number; ch: number }[] = [];
    let rowW = 0;
    while (k < n) {
      const i = order[k][2];
      const cw = Math.min(W, Math.max(pitch, widths[i] * pad));
      const ch = Math.max(pitch, heights[i] * pad);
      if (row.length && rowW + cw > W) break;
      row.push({ i, cw, ch });
      rowW += cw;
      k++;
    }
    const rowH = Math.max(...row.map((r) => r.ch));
    let cursor = -rowW / 2;
    for (const r of row) {
      slots[r.i] = { x: cursor + r.cw / 2, y: y - rowH / 2 };
      cursor += r.cw;
    }
    y -= rowH;
    rows++;
  }
  return { cols, rows, pitch, top, slots };
}
