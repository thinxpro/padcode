#!/usr/bin/env node
// Renders every terminal UI component with this terminal's capabilities (honours NO_COLOR, PADCODE_ASCII, COLUMNS).
import { detectCaps } from '../dist/tui/caps.js';
import { renderGallery } from '../dist/tui/gallery.js';

const columns = Number(process.env.COLUMNS) || process.stdout.columns;
const caps = detectCaps(process.env, { isTTY: process.stdout.isTTY, columns, rows: process.stdout.rows });
process.stdout.write(renderGallery(caps).join('\n') + '\n');
