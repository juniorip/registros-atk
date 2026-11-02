const fs = require('node:fs/promises');
const { minify } = require('next/dist/compiled/terser');

(async () => {
  const ts = require('typescript');
  const shared = await fs.readFile('src/lib/work-calendar-rules.ts', 'utf8');
  const compiled = ts.transpileModule(shared, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  await fs.writeFile('public/work-calendar.js', '(function(){var exports={};' + compiled + ';window.WorkCalendar=exports;})();');
  const source = await fs.readFile('public/legacy-app.js', 'utf8');
  const result = await minify(source, {
    compress: true,
    mangle: true,
    format: { comments: /^!/ },
  });
  if (!result.code) throw new Error('No se pudo preparar la aplicación.');
  await fs.writeFile('public/legacy-app.min.js', result.code);
  await fs.writeFile('public/legacy-app-referrals-compact.js', result.code);
  await fs.writeFile('public/legacy-app-tab-login.js', result.code);
  console.log(`Aplicación: ${Buffer.byteLength(source)} → ${Buffer.byteLength(result.code)} bytes.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
