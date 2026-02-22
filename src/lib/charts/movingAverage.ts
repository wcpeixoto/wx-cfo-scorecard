export function computeProgressiveMovingAverage(values: number[], window: number): number[] {
  if (values.length === 0) return [];
  if (window <= 1) return [...values];

  const results: number[] = new Array(values.length);
  let runningSum = 0;

  for (let index = 0; index < values.length; index += 1) {
    runningSum += values[index];
    if (index >= window) {
      runningSum -= values[index - window];
    }

    const currentWindowSize = Math.min(index + 1, window);
    results[index] = runningSum / currentWindowSize;
  }

  return results;
}

export type LinearTrendResult = {
  values: number[];
  slopePerMonth: number;
  intercept: number;
};

export function computeLinearTrendLine(values: number[]): LinearTrendResult {
  const count = values.length;
  if (count === 0) {
    return { values: [], slopePerMonth: 0, intercept: 0 };
  }

  if (count === 1) {
    return {
      values: [values[0]],
      slopePerMonth: 0,
      intercept: values[0],
    };
  }

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let index = 0; index < count; index += 1) {
    const x = index;
    const y = values[index];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }

  const denominator = count * sumXX - sumX * sumX;
  const slopePerMonth = denominator === 0 ? 0 : (count * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slopePerMonth * sumX) / count;
  const trendValues = values.map((_, index) => intercept + slopePerMonth * index);

  return {
    values: trendValues,
    slopePerMonth,
    intercept,
  };
}
