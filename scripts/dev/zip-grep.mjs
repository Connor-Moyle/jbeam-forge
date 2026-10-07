#!/usr/bin/env node
/**
 * Search the text files inside one of the game's zips (its vehicles ship zipped).
 *
 *   node scripts/dev/zip-grep.mjs <zip> <file name regex> <line regex> [most lines]
 *
 * In PowerShell write a double quote in a regex as \x22 (quotes inside arguments get lost).
 */
import yauzl from 'yauzl';

const [zipPath, fileRe, lineRe, max = '40'] = process.argv.slice(2);
if (!zipPath || !fileRe || !lineRe) {
  console.error('usage: zip-grep.mjs <zip> <file name regex> <line regex> [most lines]');
  process.exit(2);
}
const files = new RegExp(fileRe, 'i');
const lines = new RegExp(lineRe);
let left = Number(max);
yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
  if (err) throw err;
  zip.on('entry', (e) => {
    if (left <= 0 || !files.test(e.fileName)) return zip.readEntry();
    zip.openReadStream(e, (err2, s) => {
      if (err2) throw err2;
      const chunks = [];
      s.on('data', (c) => chunks.push(c));
      s.on('end', () => {
        Buffer.concat(chunks)
          .toString('utf8')
          .split(/\r?\n/)
          .forEach((l, i) => {
            if (left > 0 && lines.test(l)) {
              console.log(`${e.fileName}:${i + 1}: ${l.trim().slice(0, 240)}`);
              left--;
            }
          });
        zip.readEntry();
      });
    });
  });
  zip.readEntry();
});
