export function isValidAmount(value: string, max?: number): boolean {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return false;
  }

  return max === undefined || amount <= max;
}
