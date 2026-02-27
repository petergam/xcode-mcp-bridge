import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTestSpecifier } from '../xcode-test.ts';

test('parseTestSpecifier parses valid target/test value', () => {
  const parsed = parseTestSpecifier('AppTests/testExample()');
  assert.deepEqual(parsed, {
    targetName: 'AppTests',
    testIdentifier: 'AppTests/testExample()',
  });
});

test('parseTestSpecifier trims input and target name', () => {
  const parsed = parseTestSpecifier('  AppTests /testExample()  ');
  assert.equal(parsed.targetName, 'AppTests');
  assert.equal(parsed.testIdentifier, 'AppTests /testExample()');
});

test('parseTestSpecifier throws for invalid format', () => {
  assert.throws(() => parseTestSpecifier('JustATarget'), /Invalid test specifier/);
  assert.throws(() => parseTestSpecifier('/testOnly()'), /Invalid test specifier/);
});
