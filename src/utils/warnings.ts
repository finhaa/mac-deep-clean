const warnings = new Set<string>();

export function addWarning(message: string): void {
  warnings.add(message);
}

export function flushWarnings(): string[] {
  const list = [...warnings];
  warnings.clear();
  return list;
}

export function hasWarnings(): boolean {
  return warnings.size > 0;
}
