'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function widgetCompilerArguments() {
  const script = fs.readFileSync(path.join(root, 'scripts/build-widgets.sh'), 'utf8');
  const command = script.replace(/\\\r?\n/g, ' ').split(/\r?\n/)
    .find(line => /^\s*(?:\S*\/)?xcrun\s+swiftc\s/.test(line));
  assert.ok(command, 'The widget build must invoke swiftc.');
  // Tokenize the existing simple compiler command without executing the build.
  return (command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [])
    .map(token => token.replace(/^(["'])(.*)\1$/, '$2'));
}

test('widget build enters through the system extension bootstrap', () => {
  const args = widgetCompilerArguments();
  assert.ok(args.includes('-application-extension'), 'Keep extension API restrictions enabled.');
  assert.ok(args.some((arg, index) => arg === '-framework' && args[index + 1] === 'Foundation'),
    'Foundation supplies NSExtensionMain.');
  const linkerArgs = args.flatMap((arg, index) => arg === '-Xlinker' ? [args[index + 1]] : []);
  const entryIndex = linkerArgs.lastIndexOf('-e');
  assert.ok(entryIndex >= 0, 'Set the extension linker entry point explicitly.');
  assert.equal(linkerArgs[entryIndex + 1], '_NSExtensionMain',
    'Starting directly in Swift main bypasses system extension initialization.');
});

test('widget bundle retains the Swift entry point invoked after system initialization', () => {
  const source = fs.readFileSync(path.join(root, 'Widgets/CampusDeskWidgets.swift'), 'utf8');
  assert.match(source, /@main\s+struct\s+CampusDeskWidgets\s*:\s*WidgetBundle\b/);
  assert.ok(!widgetCompilerArguments().some((arg, index, args) =>
    arg === '-DWIDGET_RENDER' || (arg === '-D' && args[index + 1] === 'WIDGET_RENDER')),
  'Production builds must include the @main bundle, not the render-test entry point.');
});

const widgetBinary = process.env.CAMPUSDESK_WIDGET_BINARY;
test('built widget Mach-O starts at the NSExtensionMain stub', {
  skip: !widgetBinary ? 'Set CAMPUSDESK_WIDGET_BINARY to verify a built extension.' : process.platform !== 'darwin'
}, () => {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  const loadCommands = execFileSync('/usr/bin/otool', ['-arch', arch, '-l', widgetBinary], { encoding: 'utf8' });
  const textSegment = loadCommands.split(/(?=Load command \d+\r?\n)/)
    .find(block => /\bcmd LC_SEGMENT_64\b/.test(block) && /\bsegname __TEXT\s/.test(block));
  assert.ok(textSegment, 'The widget binary must have a __TEXT segment.');
  const vmAddress = textSegment.match(/\bvmaddr (0x[\da-f]+)/i);
  const fileOffset = textSegment.match(/\bfileoff (\d+)/);
  const main = loadCommands.match(/\bcmd LC_MAIN\s+cmdsize \d+\s+entryoff (\d+)/);
  assert.ok(vmAddress && fileOffset && main, 'The widget binary must have a usable LC_MAIN entry point.');
  const entryAddress = BigInt(vmAddress[1]) + BigInt(main[1]) - BigInt(fileOffset[1]);
  const symbols = execFileSync('/usr/bin/otool', ['-arch', arch, '-Iv', widgetBinary], { encoding: 'utf8' });
  const stubs = symbols.split(/(?=Indirect symbols for )/)
    .find(block => /^Indirect symbols for \(__TEXT,__stubs\)/.test(block));
  assert.ok(stubs, 'The widget binary must have executable symbol stubs.');
  const bootstrapAddresses = [...stubs.matchAll(/^\s*(0x[\da-f]+)\s+\d+\s+_NSExtensionMain\s*$/gmi)]
    .map(match => BigInt(match[1]));
  assert.ok(bootstrapAddresses.includes(entryAddress),
    'LC_MAIN must point to the NSExtensionMain stub, not the Swift-generated main function.');
});
