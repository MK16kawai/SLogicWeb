interface FsLike {
  readFileSync(path: string, encoding: 'utf8'): string;
}

interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const nodeProcess = (() => {
  const process = (globalThis as {
    process?: { exit(code: number): never; getBuiltinModule?(name: string): unknown };
  }).process;
  if (!process || typeof process.exit !== 'function') {
    throw new Error('this entry point only runs under node');
  }
  return process;
})();

const fs = nodeProcess.getBuiltinModule?.('fs') as FsLike | undefined;
if (!fs || typeof fs.readFileSync !== 'function') throw new Error('node fs module unavailable');

const results: TestResult[] = [];

function check(name: string, pass: boolean, detail: string): void {
  results.push({ name, pass, detail });
}

const html = fs.readFileSync('uictrl/index.html', 'utf8');
const mainHtml = fs.readFileSync('index.html', 'utf8');
const mainRuntime = fs.readFileSync('src/ui/main.ts', 'utf8');
const config = fs.readFileSync('vite.config.ts', 'utf8');
const css = fs.readFileSync('src/ui/style.css', 'utf8');

const documentNeedles = [
  '<html lang="en" data-theme="dark">',
  '<title>logicweb uictrl</title>',
  '<link rel="stylesheet" href="/src/ui/style.css" />',
  '<main id="uictrl" aria-labelledby="uictrl-title">',
  '<h1 id="uictrl-title">UI Controls</h1>',
];
const missingDocumentNeedles = documentNeedles.filter((needle) => !html.includes(needle));
check(
  'console document uses the dark theme, global stylesheet, and dedicated mount',
  missingDocumentNeedles.length === 0,
  `missing=${JSON.stringify(missingDocumentNeedles)}`,
);

const controlsMatch = html.match(/<section\b[^>]*id="uictrl-controls"[^>]*>([\s\S]*?)<\/section>/);
const controlsEmpty = controlsMatch !== null && (controlsMatch[1] ?? '').trim() === '';
const interactiveElements = html.match(/<(button|input|select|textarea|form)\b/gi) ?? [];
check(
  'controls region hosts the interactive tuning controls',
  controlsMatch !== null && !controlsEmpty && interactiveElements.length > 0,
  `empty=${controlsEmpty}, interactive=${JSON.stringify(interactiveElements)}`,
);

const moduleScripts = html.match(/<script\b[^>]*type="module"[^>]*>/gi) ?? [];
const controllerScripts = moduleScripts.filter((tag) => tag.includes('src="./main.ts"'));
const runtimeNeedles = ['/src/ui/main.ts', 'new App'];
const presentRuntimeNeedles = runtimeNeedles.filter((needle) => html.includes(needle));
check(
  'console document loads exactly one module script: the console controller',
  moduleScripts.length === 1 && controllerScripts.length === 1 && presentRuntimeNeedles.length === 0,
  `moduleScripts=${JSON.stringify(moduleScripts)}, controller=${controllerScripts.length}, ` +
  `present=${JSON.stringify(presentRuntimeNeedles)}`,
);

const mainNeedles = [mainHtml, mainRuntime].filter((source) => /uictrl/i.test(source));
check(
  'primary HTML and bootstrap contain no console discovery reference',
  mainNeedles.length === 0,
  `primarySourcesWithReference=${mainNeedles.length}`,
);

const routeNeedles = [
  "name: 'logicweb:uictrl-entry'",
  "apply: 'serve'",
  "if (url === '/uictrl') request.url = '/uictrl/';",
  'plugins: [serveUiControlEntry(), requireRuntimeAssets(), emitLicense(), inlineEntryForFileOpen()]',
];
const missingRouteNeedles = routeNeedles.filter((needle) => !config.includes(needle));
check(
  'serve-only middleware keeps the exact console path ahead of SPA fallback',
  missingRouteNeedles.length === 0 && !config.includes("input: 'uictrl/index.html'"),
  `missing=${JSON.stringify(missingRouteNeedles)}`,
);

const styleNeedles = ['#uictrl {', '#uictrl-header {', '#uictrl-title {', '#uictrl-controls {'];
const missingStyleNeedles = styleNeedles.filter((needle) => !css.includes(needle));
check(
  'console styles remain rooted at the dedicated mount',
  missingStyleNeedles.length === 0,
  `missing=${JSON.stringify(missingStyleNeedles)}`,
);

console.log(results.map((result) => (
  `${result.pass ? 'PASS' : 'FAIL'}  ${result.name}\n        ${result.detail}`
)).join('\n'));
const failed = results.filter((result) => !result.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
nodeProcess.exit(failed === 0 ? 0 : 1);
