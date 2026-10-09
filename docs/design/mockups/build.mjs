// Builds docs/design/mockups/index.html from src/: one self-contained page, no external code.
// The page omits <!doctype>/<html>/<head>/<body> on purpose: the artifact publisher wraps it.
// Run: node docs/design/mockups/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(join(here, 'src', f), 'utf8');
const js = ['icons.js', 'ui.js', 'springs.js', 'screens.js', 'app.js'].map(src).join('\n');
if (js.includes('</script')) throw new Error('a source file contains </script');

const html = `<title>Whim System v1</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap">
<style>
${src('page.css')}
${src('whim.css')}
</style>
<header class="pg-bar" id="pg-bar"></header>
<main class="pg-wrap" id="pg-main"></main>
<script>
${js}
</script>
`;
writeFileSync(join(here, 'index.html'), html);
console.log(`index.html: ${(html.length / 1024).toFixed(0)} KB`);
