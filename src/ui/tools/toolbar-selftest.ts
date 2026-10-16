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
const css = fs.readFileSync('src/ui/style.css', 'utf8');
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
  'this.el.connectTitle.textContent =',
  'this.el.connectDescription.textContent =',
  'this.el.connect.disabled = !webusbAvailable',
  'this.el.connect.title =',
  "t('toolbar.noWebusb')",
  "t('toolbar.reconnect')",
  "t('toolbar.webusbUnavailable')",
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

const commandIds = ['btn-connect', 'transport', 'btn-open', 'btn-save', 'btn-fit', 'btn-settings'];

function commandMarkup(id: string): string {
  const idIndex = toolbar.indexOf(`id="${id}"`);
  if (idIndex < 0) return '';
  const start = toolbar.lastIndexOf('<button', idIndex);
  const end = toolbar.indexOf('</button>', idIndex);
  return start >= 0 && end > idIndex ? toolbar.slice(start, end + '</button>'.length) : '';
}

const anatomyNeedles = [
  'class="toolbar-item',
  'class="toolbar-item-media"',
  'class="toolbar-item-content"',
  'toolbar-item-title',
  'aria-hidden="true"',
  'focusable="false"',
  'data-icon="inline-start"',
];
const anatomyFailures: string[] = [];
const iconSignatures = new Set<string>();
for (const id of commandIds) {
  const markup = commandMarkup(id);
  const missing = anatomyNeedles.filter((needle) => !markup.includes(needle));
  if (missing.length > 0) anatomyFailures.push(`${id}:${missing.join(',')}`);
  const icon = /<svg\b[^>]*>([\s\S]*?)<\/svg>/.exec(markup)?.[1]?.replace(/\s+/g, '') ?? '';
  if (icon) iconSignatures.add(icon);
  else anatomyFailures.push(`${id}:icon`);
}
const separatorCount = toolbar.match(/role="separator"/g)?.length ?? 0;
const verticalSeparatorCount = toolbar.match(/aria-orientation="vertical"/g)?.length ?? 0;
check(
  'six commands expose shadcn item anatomy, distinct decorative icons, and separators',
  anatomyFailures.length === 0 && iconSignatures.size === commandIds.length &&
    separatorCount === 2 && verticalSeparatorCount === 2,
  `failures=${JSON.stringify(anatomyFailures)}, icons=${iconSignatures.size}, separators=${separatorCount}/${verticalSeparatorCount}`,
);

const fitIndex = toolbar.indexOf('id="btn-fit"');
const spacerIndex = toolbar.indexOf('class="spacer"');
const settingsIndex = toolbar.indexOf('id="btn-settings"');
const settingsSeparatorIndex = settingsIndex >= 0
  ? toolbar.lastIndexOf('role="separator"', settingsIndex)
  : -1;
const settingsBeforeSpacer = fitIndex >= 0 && settingsSeparatorIndex > fitIndex &&
  settingsIndex > settingsSeparatorIndex && spacerIndex > settingsIndex;
const earlierCommandIndexes = commandIds
  .filter((id) => id !== 'btn-settings')
  .map((id) => toolbar.indexOf(`id="${id}"`));
const settingsIsLastLeftCommand = settingsIndex >= 0 &&
  earlierCommandIndexes.every((index) => index >= 0 && index < settingsIndex) &&
  spacerIndex > settingsIndex;
check(
  'settings is the last left-aligned toolbar command before the spacer',
  settingsBeforeSpacer && settingsIsLastLeftCommand,
  `fit@${fitIndex}, settingsSeparator@${settingsSeparatorIndex}, settings@${settingsIndex}, spacer@${spacerIndex}`,
);

const directButtonTranslations = commandIds.filter((id) => /<button\b[^>]*\sdata-i18n\s*=/.test(commandMarkup(id)));
const dynamicTargets = [
  "connectTitle: must<HTMLSpanElement>('device-title')",
  "connectDescription: must<HTMLSpanElement>('device-description')",
  "transportTitle: must<HTMLSpanElement>('transport-title')",
  'this.el.transportTitle.textContent =',
];
const missingDynamicTargets = dynamicTargets.filter((needle) => !app.includes(needle));
const retiredTransportDescription = ['transportDescription', 'transport-description']
  .filter((needle) => app.includes(needle) || toolbar.includes(needle));
const preservedClasses = app.includes("btn.classList.toggle('primary', !this.running)") &&
  app.includes("btn.classList.toggle('danger', this.running)") && !app.includes('btn.className =');
check(
  'nested translation and state rendering preserve every toolbar item structure',
  directButtonTranslations.length === 0 && missingDynamicTargets.length === 0 &&
    retiredTransportDescription.length === 0 && preservedClasses,
  `direct=${JSON.stringify(directButtonTranslations)}, missing=${JSON.stringify(missingDynamicTargets)}, retired=${JSON.stringify(retiredTransportDescription)}, classes=${preservedClasses}`,
);

const toolbarSummaryAbsent = !toolbar.includes('toolbar-session') &&
  !html.includes('capture-title') &&
  !css.includes('toolbar-session');
const titleLookupAbsent = !app.includes("'capture-title'") && !app.includes('this.el.title');
const toolbarStateStart = app.indexOf('private renderToolbarState(): void {');
const statusStart = app.indexOf('private renderStatus(): void {');
const statusEnd = statusStart >= 0 ? app.indexOf('\n  private fail(', statusStart) : -1;
const toolbarStateBody = toolbarStateStart >= 0 && statusStart > toolbarStateStart
  ? app.slice(toolbarStateStart, statusStart)
  : '';
const statusBody = statusStart >= 0 && statusEnd > statusStart
  ? app.slice(statusStart, statusEnd)
  : '';
const toolbarStateDescribesCapture = toolbarStateBody.length === 0 ||
  toolbarStateBody.includes('formatCaptureLabel') || toolbarStateBody.includes('captureLabel');
const statusOwnsCaptureLabel = statusBody.includes('parts.push(formatCaptureLabel(this.captureLabel))');
check(
  'the toolbar carries no capture summary and the status bar is the sole description site',
  toolbarSummaryAbsent && titleLookupAbsent && !toolbarStateDescribesCapture && statusOwnsCaptureLabel,
  `toolbarAbsent=${toolbarSummaryAbsent}, appAbsent=${titleLookupAbsent}, toolbarDescribes=${toolbarStateDescribesCapture}, status=${statusOwnsCaptureLabel}`,
);

const capturePanelKeepsLabelKey = capturePanel.includes("t('capturePanel.capture')");
check(
  'the capture panel retains the capturePanel.capture catalog key after the toolbar removal',
  capturePanelKeepsLabelKey,
  `capturePanel.capture=${capturePanelKeepsLabelKey}`,
);

const descriptionCounts = commandIds.map((id) => (
  commandMarkup(id).match(/toolbar-item-description/g)?.length ?? 0
));
const expectedDescriptionCounts = [1, 0, 0, 0, 0, 0];
check(
  'only the device command retains a toolbar description',
  JSON.stringify(descriptionCounts) === JSON.stringify(expectedDescriptionCounts),
  `commands=${JSON.stringify(Object.fromEntries(commandIds.map((id, index) => [id, descriptionCounts[index]])))}`,
);

const retiredDescriptionStyles = [
  '#toolbar .primary .toolbar-item-description',
  '#toolbar .danger .toolbar-item-description',
  '#toolbar button.toolbar-item:not(.toolbar-device) .toolbar-item-description { display: none; }',
].filter((needle) => css.includes(needle));
check(
  'retired command description styles stay absent',
  retiredDescriptionStyles.length === 0,
  `leftovers=${JSON.stringify(retiredDescriptionStyles)}`,
);

const presentationNeedles = [
  '#toolbar button.toolbar-item:focus-visible',
  '#toolbar .toolbar-device.connected .toolbar-item-media { color: var(--primary); }',
  'flex: 0 0 auto;',
  'width: fit-content;',
  'max-width: 240px',
  'display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;',
  '#toolbar button.toolbar-device { min-height: 44px; }',
  '#toolbar .spacer { display: none; }',
];
const missingPresentation = presentationNeedles.filter((needle) => !css.includes(needle));
check(
  'toolbar styles cover focus, connection, truncation, and compact mobile access',
  missingPresentation.length === 0,
  `missing=${JSON.stringify(missingPresentation)}`,
);

const intrinsicDesktop = css.includes('#toolbar button.toolbar-item {\n  flex: 0 0 auto;\n  width: fit-content;');
const intrinsicMobile = css.includes('#toolbar button.toolbar-item { min-height: 38px; max-width: min(240px, 100%); padding: 4px 8px; }');
const fixedSizingNeedles = [
  'flex: 0 1 240px',
  'min-width: 180px',
  'flex: 1 1 96px',
  'flex: 1 1 100%',
];
const fixedSizing = fixedSizingNeedles.filter((needle) => css.includes(needle));
check(
  'toolbar buttons retire fixed desktop bases and equal or full-row mobile sizing',
  intrinsicDesktop && intrinsicMobile && fixedSizing.length === 0,
  `desktop=${intrinsicDesktop}, mobile=${intrinsicMobile}, fixed=${JSON.stringify(fixedSizing)}`,
);

const unboundedMobile = css.includes('#toolbar button.toolbar-item { min-height: 38px; max-width: 100%; padding: 4px 8px; }');
check(
  'mobile toolbar preserves the content cap within narrower available widths',
  intrinsicMobile && !unboundedMobile,
  `bounded=${intrinsicMobile}, unbounded=${unboundedMobile}`,
);

console.log(results.map((result) => (
  `${result.pass ? 'PASS' : 'FAIL'}  ${result.name}\n        ${result.detail}`
)).join('\n'));
const failed = results.filter((result) => !result.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
nodeProcess.exit(failed === 0 ? 0 : 1);
