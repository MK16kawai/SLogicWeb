export {};

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

const html = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('src/ui/app.ts', 'utf8');
const capturePanel = fs.readFileSync('src/ui/capturePanel.ts', 'utf8');
const toolbarStart = html.indexOf('<div id="toolbar">');
const mainStart = html.indexOf('<div id="main">');
const toolbar = toolbarStart >= 0 && mainStart > toolbarStart
  ? html.slice(toolbarStart, mainStart)
  : '';
const connectIndex = toolbar.indexOf('id="btn-connect"');
const transportIndex = toolbar.indexOf('id="transport"');
const connectCount = toolbar.match(/\bid="btn-connect"/g)?.length ?? 0;
const firstCommand = /^<div id="toolbar">\s*<button\b[^>]*\bid="btn-connect"[^>]*>/.test(toolbar);
check(
  'device connection is the sole first toolbar command',
  toolbar.length > 0 && connectCount === 1 && connectIndex >= 0 &&
    transportIndex > connectIndex && firstCommand,
  `toolbar=${toolbar.length}, connectCount=${connectCount}, connect@${connectIndex}, transport@${transportIndex}, first=${firstCommand}`,
);

const callbackPattern = /this\.el\.connect\.addEventListener\('click',\s*\(\)\s*=>\s*void this\.connect\(\)\)/;
const callback = callbackPattern.test(app);
const element = app.includes("connect: must<HTMLButtonElement>('btn-connect')");
check(
  'toolbar connection binds the existing App.connect path once',
  callback && element,
  `callback=${callback}, element=${element}`,
);

const removedPanelMembers = ['onConnect', 'webusbAvailable', 'panel-head', 'capturePanel.connect']
  .filter((needle) => capturePanel.includes(needle));
const consoleDeviceState = capturePanel.includes('deviceName: string | null;') &&
  capturePanel.includes('!v.deviceName');
check(
  'capture panel drops only its connection header and retains console device state',
  removedPanelMembers.length === 0 && consoleDeviceState,
  `leftovers=${JSON.stringify(removedPanelMembers)}, consoleDeviceState=${consoleDeviceState}`,
);

const stateNeedles = [
  'this.el.connect.textContent =',
  'this.el.connect.disabled = !webusbAvailable',
  'this.el.connect.title =',
  "t('capturePanel.noWebusb')",
  "t('capturePanel.reconnect')",
];
const missingState = stateNeedles.filter((needle) => !app.includes(needle));
check(
  'App renders disconnected, connected, and WebUSB-unavailable connection state',
  missingState.length === 0,
  `missing=${JSON.stringify(missingState)}`,
);

const actionNeedles = [
  "this.el.transport.addEventListener('click'",
  "must<HTMLButtonElement>('btn-open').addEventListener('click'",
  "must<HTMLButtonElement>('btn-save').addEventListener('click'",
  "must<HTMLButtonElement>('btn-fit').addEventListener('click'",
  "must<HTMLButtonElement>('btn-settings').addEventListener('click'",
];
const missingActions = actionNeedles.filter((needle) => !app.includes(needle));
check(
  'existing toolbar command bindings remain intact',
  missingActions.length === 0,
  `missing=${JSON.stringify(missingActions)}`,
);

console.log(results.map((result) => (
  `${result.pass ? 'PASS' : 'FAIL'}  ${result.name}\n        ${result.detail}`
)).join('\n'));
const failed = results.filter((result) => !result.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
nodeProcess.exit(failed === 0 ? 0 : 1);
