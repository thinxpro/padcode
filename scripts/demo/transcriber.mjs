#!/usr/bin/env node
// Stand-in transcriber for the scripted demo: prints the line the timeline "dictates", whatever the audio.
import { sentence } from './timeline.mjs';
process.stdout.write(`${sentence}\n`);
