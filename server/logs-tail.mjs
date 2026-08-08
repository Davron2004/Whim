/**
 * `npm run whim:logs` — tails the dev log sink's file for a human reader (obs-v1).
 *
 * The file is written by `POST /dev/logs` (`server/src/routes/dev-logs.ts`), one JSON record per
 * line, already redacted. This script only formats: it never writes, and it holds no opinion about
 * the record shape beyond the four fields every record carries.
 *
 *   npm run whim:logs                       # server/.logs/device.jsonl
 *   WHIM_DEV_LOG_FILE=/path/to.jsonl npm run whim:logs
 *   npm run whim:logs -- --all              # replay the whole file first, then follow
 *
 * The sink is off unless the server was started with WHIM_DEV_LOG_SINK=1 — with it off, this
 * script waits on a file that never appears, which is the honest report.
 */
import fs from 'node:fs';
import path from 'node:path';

const file = process.env.WHIM_DEV_LOG_FILE ?? path.join(process.cwd(), 'server', '.logs', 'device.jsonl');
const replayAll = process.argv.includes('--all');
const POLL_MS = 250;

const LEVEL_WIDTH = 5;

function formatRecord(line) {
  let record;
  try {
    record = JSON.parse(line);
  } catch (err) {
    // A partially-flushed or hand-edited line: show it raw rather than dropping it silently.
    return `?? ${line}  (unparsed: ${err instanceof Error ? err.message : String(err)})`;
  }
  const at = typeof record.at === 'number' ? new Date(record.at).toISOString().slice(11, 23) : '--:--:--.---';
  const level = String(record.level ?? '?').toUpperCase().padEnd(LEVEL_WIDTH);
  const channel = String(record.channel ?? '-');
  const message = String(record.message ?? '');
  const fields = record.fields && Object.keys(record.fields).length > 0 ? ` ${JSON.stringify(record.fields)}` : '';
  return `${at} ${level} ${channel}  ${message}${fields}`;
}

function emit(chunk) {
  for (const line of chunk.split('\n')) {
    if (line.trim().length > 0) console.log(formatRecord(line));
  }
}

console.log(`whim:logs — following ${file} (Ctrl-C to stop)`);

let offset = 0;
if (fs.existsSync(file)) {
  const size = fs.statSync(file).size;
  if (replayAll) {
    emit(fs.readFileSync(file, 'utf8'));
  }
  offset = size;
} else {
  console.log('(the file does not exist yet — start the server with WHIM_DEV_LOG_SINK=1)');
}

let reading = false;
setInterval(() => {
  if (reading || !fs.existsSync(file)) return;
  reading = true;
  const size = fs.statSync(file).size;
  // A truncated/replaced file (the server was restarted with a fresh sink) restarts from 0.
  if (size < offset) offset = 0;
  if (size > offset) {
    const fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(size - offset);
    fs.readSync(fd, buffer, 0, buffer.length, offset);
    fs.closeSync(fd);
    offset = size;
    emit(buffer.toString('utf8'));
  }
  reading = false;
}, POLL_MS);
