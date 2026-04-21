#!/usr/bin/env node
// Wiki Knowledge Graph — Visualization Server
// Zero dependencies. Parses compiled wiki markdown and serves JSON API.
// Usage: node server.js --wiki-dir path/to/wiki/

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3848;

// Minimal YAML scalar reader for top-level string fields. Handles
// double-quoted, single-quoted, and unquoted values; strips inline
// comments only on unquoted values so that quoted strings containing
// "#" or trailing "# comment" after a quoted value are both safe.
// Returns null if the field isn't present.
function getYamlScalar(content, field) {
  const line = content.split('\n').find(l => l.startsWith(field + ':'));
  if (!line) return null;
  let v = line.slice(field.length + 1).trim();
  if (v.startsWith('"')) {
    const m = v.match(/^"((?:[^"\\]|\\.)*)"/);
    return m ? m[1] : null;
  }
  if (v.startsWith("'")) {
    const m = v.match(/^'((?:[^']|'')*)'/);
    return m ? m[1].replace(/''/g, "'") : null;
  }
  const commentAt = v.search(/\s+#/);
  if (commentAt >= 0) v = v.slice(0, commentAt);
  return v.trim();
}

// Parse CLI args
let wikiDir = null;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--wiki-dir' && process.argv[i + 1]) {
    wikiDir = path.resolve(process.argv[i + 1]);
    i++;
  }
}

if (!wikiDir) {
  // Try to find wiki dir from .wiki-compiler.yml (preferred) or legacy
  // .wiki-compiler.json in cwd. We only need the `output` field, so a
  // tiny scalar parser is enough — avoids adding a js-yaml dependency.
  const ymlPath = path.join(process.cwd(), '.wiki-compiler.yml');
  const jsonPath = path.join(process.cwd(), '.wiki-compiler.json');
  let output = null;
  if (fs.existsSync(ymlPath)) {
    const content = fs.readFileSync(ymlPath, 'utf8');
    output = getYamlScalar(content, 'output') || 'wiki/';
  } else if (fs.existsSync(jsonPath)) {
    const config = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    output = config.output || 'wiki/';
  }
  if (output) {
    wikiDir = path.resolve(process.cwd(), output);
  }
}

if (!wikiDir || !fs.existsSync(wikiDir)) {
  console.error('Usage: node server.js --wiki-dir path/to/wiki/');
  console.error('  Or run from a directory with .wiki-compiler.yml (or legacy .wiki-compiler.json)');
  process.exit(1);
}

console.log(`📚 Wiki dir: ${wikiDir}`);

// --- Markdown Parsing ---

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta = {};
  match[1].split('\n').forEach(line => {
    const m = line.match(/^(\w[\w_]*)\s*:\s*(.+)$/);
    if (m) {
      let val = m[2].trim();
      if (val.startsWith('[') && val.endsWith(']')) {
        val = val.slice(1, -1).split(',').map(s => s.trim().replace(/"/g, ''));
      }
      meta[m[1]] = val;
    }
  });
  return { meta, body: match[2] };
}

function parseIndexTopics(indexContent) {
  const topics = [];
  const lines = indexContent.split('\n');
  let inTopicTable = false;
  for (const line of lines) {
    if (line.includes('| Topic |')) { inTopicTable = true; continue; }
    if (inTopicTable && line.match(/^\|[-\s|]+\|$/)) continue;
    if (inTopicTable && line.startsWith('|')) {
      const cols = line.split('|').map(s => s.trim()).filter(Boolean);
      if (cols.length >= 2) {
        // Markdown link: [name](path.md)
        let linkMatch = cols[0].match(/\[([^\]]+)\]\(([^)]+)\)/);
        let name, slug;
        if (linkMatch) {
          name = linkMatch[1];
          slug = path.basename(linkMatch[2], '.md');
        } else {
          // Obsidian wikilink: [[topics/slug]] or [[slug]]
          const wikiMatch = cols[0].match(/\[\[([^\]]+)\]\]/);
          if (wikiMatch) {
            const target = wikiMatch[1];
            slug = path.basename(target);
            name = slug;
          }
        }
        if (slug) {
          topics.push({
            slug,
            name,
            aliases: cols.length >= 4 ? cols[1] : '',
            sourceCount: parseInt(cols.length >= 4 ? cols[2] : cols[1]) || 0,
            lastUpdated: cols.length >= 4 ? cols[3] : '',
            status: cols.length >= 5 ? cols[4] : 'active'
          });
        }
      }
    } else if (inTopicTable && !line.startsWith('|')) {
      inTopicTable = false;
    }
  }
  return topics;
}

function parseSections(body) {
  const sections = [];
  const lines = body.split('\n');
  let currentSection = null;
  let currentContent = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (currentSection) {
        sections.push({ heading: currentSection, content: currentContent.join('\n').trim() });
      }
      currentSection = line.slice(3).trim();
      currentContent = [];
    } else if (currentSection) {
      currentContent.push(line);
    }
  }
  if (currentSection) {
    sections.push({ heading: currentSection, content: currentContent.join('\n').trim() });
  }
  return sections;
}

// --- Data Loading ---

function loadGraph() {
  const indexPath = path.join(wikiDir, 'index.md');
  if (!fs.existsSync(indexPath)) return { name: 'Unknown', topics: [], concepts: [], edges: [] };

  const indexContent = fs.readFileSync(indexPath, 'utf8');

  // Extract wiki name from first heading
  const nameMatch = indexContent.match(/^# (.+)/m);
  const name = nameMatch ? nameMatch[1].replace(' Knowledge Base', '') : 'Wiki';

  // Extract stats
  const statsMatch = indexContent.match(/Total topics: (\d+) \| Total sources: (\d+)/);
  const totalTopics = statsMatch ? parseInt(statsMatch[1]) : 0;
  const totalSources = statsMatch ? parseInt(statsMatch[2]) : 0;

  // Parse topics from table
  const topics = parseIndexTopics(indexContent);

  // Parse concepts
  const concepts = [];
  const edges = [];
  const conceptsDir = path.join(wikiDir, 'concepts');
  if (fs.existsSync(conceptsDir)) {
    const conceptFiles = fs.readdirSync(conceptsDir).filter(f => f.endsWith('.md'));
    for (const file of conceptFiles) {
      const content = fs.readFileSync(path.join(conceptsDir, file), 'utf8');
      const { meta } = parseFrontmatter(content);
      const slug = path.basename(file, '.md');
      const connects = Array.isArray(meta.topics_connected) ? meta.topics_connected : [];
      concepts.push({ slug, name: meta.concept || slug, connects });

      // Build edges: every pair of connected topics
      for (let i = 0; i < connects.length; i++) {
        for (let j = i + 1; j < connects.length; j++) {
          edges.push({ from: connects[i], to: connects[j], concept: slug });
        }
      }
    }
  }

  return { name, totalTopics, totalSources, topics, concepts, edges };
}

function loadArticle(type, slug) {
  const dir = type === 'concept' ? 'concepts' : 'topics';
  const filePath = path.join(wikiDir, dir, `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;

  const content = fs.readFileSync(filePath, 'utf8');
  const { meta, body } = parseFrontmatter(content);
  const sections = parseSections(body);

  // Extract title from first heading
  const titleMatch = body.match(/^# (.+)/m);
  const title = titleMatch ? titleMatch[1] : slug;

  return { slug, title, meta, sections };
}

// --- HTTP Server ---

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (url.pathname === '/api/graph') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(loadGraph()));
  } else if (url.pathname.startsWith('/api/topic/')) {
    const slug = url.pathname.split('/api/topic/')[1];
    const article = loadArticle('topic', slug);
    if (article) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(article));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  } else if (url.pathname.startsWith('/api/concept/')) {
    const slug = url.pathname.split('/api/concept/')[1];
    const article = loadArticle('concept', slug);
    if (article) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(article));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  } else if (url.pathname === '/' || url.pathname === '/index.html') {
    const htmlPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync(htmlPath, 'utf8'));
    } else {
      res.writeHead(404);
      res.end('index.html not found');
    }
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`📊 Wiki Knowledge Graph running at http://localhost:${PORT}`);
  console.log(`   Topics: ${loadGraph().topics.length} | Concepts: ${loadGraph().concepts.length}`);
});
