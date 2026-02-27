export function parseTestSpecifier(input: string): { targetName: string; testIdentifier: string } {
  const value = input.trim();
  const slash = value.indexOf('/');
  if (slash <= 0) {
    throw new Error(
      `Invalid test specifier '${input}'. Expected format: TargetName/testName()`,
    );
  }
  const targetName = value.slice(0, slash).trim();
  if (!targetName) {
    throw new Error(
      `Invalid test specifier '${input}'. Expected format: TargetName/testName()`,
    );
  }
  return {
    targetName,
    testIdentifier: value,
  };
}
