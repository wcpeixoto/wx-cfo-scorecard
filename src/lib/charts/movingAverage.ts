export function computeRollingMovingAverage(values: number[], window: number): Array<number | null> {
  if (window <= 1) {
    return values.map((value) => value);
  }

  const results: Array<number | null> = [];
  let runningSum = 0;

  for (let index = 0; index < values.length; index += 1) {
    runningSum += values[index];

    if (index >= window) {
      runningSum -= values[index - window];
    }

    if (index >= window - 1) {
      results.push(runningSum / window);
    } else {
      results.push(null);
    }
  }

  return results;
}
