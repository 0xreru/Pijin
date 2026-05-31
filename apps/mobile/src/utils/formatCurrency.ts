export function formatCurrency(value: number | string): string {
  const numeric = typeof value === 'string' ? Number(value || 0) : value;
  const safeValue = Number.isFinite(numeric) ? numeric : 0;

  return `✦${safeValue.toLocaleString('en-PH', {
    minimumFractionDigits: safeValue % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
