export function computeExponentialMovingAverage(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  if (period <= 1) return [...values];

  const alpha = 2 / (period + 1);
  const results: number[] = new Array(values.length);
  results[0] = values[0];

  for (let index = 1; index < values.length; index += 1) {
    results[index] = alpha * values[index] + (1 - alpha) * results[index - 1];
  }

  return results;
}
