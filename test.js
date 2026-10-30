// Run: node test.js
const assert = require('assert');
const { ytId, parseRange, ytCard } = require('./server');

assert.strictEqual(ytId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'), 'dQw4w9WgXcQ');
assert.strictEqual(ytId('https://youtu.be/dQw4w9WgXcQ?si=abc'), 'dQw4w9WgXcQ');
assert.strictEqual(ytId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
assert.strictEqual(ytId('https://example.com/video'), null);

assert.deepStrictEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
assert.deepStrictEqual(parseRange('bytes=500-', 1000), { start: 500, end: 999 });
assert.deepStrictEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
assert.deepStrictEqual(parseRange('bytes=900-5000', 1000), { start: 900, end: 999 });
assert.strictEqual(parseRange('bytes=1000-', 1000), null);
assert.strictEqual(parseRange('bytes=-', 1000), null);
assert.strictEqual(parseRange('items=0-1', 1000), null);

const c = ytCard({ id: 'abcdefghijk', title: 'T', channel: 'C', duration: 2228, view_count: 8400, upload_date: '20260915' });
assert.strictEqual(c.uploaded, '2026-09-15');
assert.strictEqual(c.views, 8400);

console.log('all checks passed');
