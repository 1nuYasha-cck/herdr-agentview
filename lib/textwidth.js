'use strict';

// Terminal display width and line wrapping.
//
// Herdr never wraps a sidebar row: it cuts the row at the budget it has and
// puts an ellipsis there. A long title is wrapped here instead, by splitting it
// across several rows, which means measuring text the way the terminal draws
// it: a Han character or an emoji takes two columns, a combining mark none.

const WIDE_RANGES = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
];

function charWidth(codePoint) {
  if (codePoint === 0 || codePoint === 0x200b || codePoint === 0x200d) return 0;
  if ((codePoint >= 0x300 && codePoint <= 0x36f) || (codePoint >= 0xfe00 && codePoint <= 0xfe0f)) return 0;
  for (const [low, high] of WIDE_RANGES) if (codePoint >= low && codePoint <= high) return 2;
  return 1;
}

function displayWidth(text) {
  let width = 0;
  for (const char of String(text ?? '')) width += charWidth(char.codePointAt(0));
  return width;
}

const ELLIPSIS = '…';

// Split `text` into at most `maxLines` lines, the first `first` columns wide and
// the rest `rest` wide. A Latin word is kept whole when a space allows it; text
// with no spaces, Han characters included, breaks wherever the line fills.
// What does not fit on the last line is cut with an ellipsis, so the result
// never claims more than it shows.
function wrapByWidth(text, { first, rest = first, maxLines = 3 } = {}) {
  const chars = [...String(text ?? '').replace(/\s+/g, ' ').trim()];
  const widthOf = (char) => charWidth(char.codePointAt(0));
  const lines = [];
  let at = 0;

  while (at < chars.length) {
    const limit = Math.max(4, lines.length === 0 ? first : rest);
    let width = 0;
    let end = at;
    let lastSpace = -1;
    while (end < chars.length) {
      const next = widthOf(chars[end]);
      if (width + next > limit) break;
      if (chars[end] === ' ') lastSpace = end;
      width += next;
      end += 1;
    }
    if (end === at) end = at + 1; // a character wider than the line still moves on

    if (end >= chars.length) {
      lines.push(chars.slice(at, end).join('').trimEnd());
      break;
    }

    if (lines.length === maxLines - 1) {
      let cut = at;
      let used = 0;
      while (cut < chars.length && used + widthOf(chars[cut]) <= limit - 1) {
        used += widthOf(chars[cut]);
        cut += 1;
      }
      lines.push(`${chars.slice(at, cut).join('').trimEnd()}${ELLIPSIS}`);
      break;
    }

    // Break at the last space only when the next character would continue a
    // narrow word; a wide character is a boundary of its own.
    const splitsWord = chars[end] !== ' ' && widthOf(chars[end]) === 1 && widthOf(chars[end - 1]) === 1;
    const cut = splitsWord && lastSpace > at ? lastSpace : end;
    lines.push(chars.slice(at, cut).join('').trimEnd());
    at = cut;
    while (chars[at] === ' ') at += 1;
  }
  return lines;
}

module.exports = { charWidth, displayWidth, wrapByWidth };
