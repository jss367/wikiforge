#!/usr/bin/env node
// Usage: _read-yaml-field.js <file> <field>
// Reads a top-level scalar field from a YAML file and prints its value.
// Handles double-quoted, single-quoted, and unquoted values; strips
// inline comments ONLY on unquoted values so quoted strings containing
// "#" are preserved verbatim.
//
// Used by the session-start hook which can't embed a heredoc node
// script cleanly (bash parses heredocs inside $(...) for quote balance
// and single-quoted regex patterns break that scan).

const fs = require('fs');
const [, , file, field] = process.argv;
if (!file || !field) process.exit(1);

let content;
try {
  content = fs.readFileSync(file, 'utf8');
} catch {
  process.exit(0);
}

const line = content.split('\n').find(l => l.startsWith(field + ':'));
if (!line) process.exit(0);

let v = line.slice(field.length + 1).trim();
if (v.startsWith('"')) {
  const m = v.match(/^"((?:[^"\\]|\\.)*)"/);
  v = m ? m[1] : '';
} else if (v.startsWith("'")) {
  const m = v.match(/^'((?:[^']|'')*)'/);
  v = m ? m[1].replace(/''/g, "'") : '';
} else {
  const c = v.search(/\s+#/);
  if (c >= 0) v = v.slice(0, c);
  v = v.trim();
}
console.log(v);
