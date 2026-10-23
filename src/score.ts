/**
 * Scoring rubric. Documented in RUBRIC.md, kept here as the single source of
 * truth so tests can assert against the same numbers the CLI prints.
 *
 *   start at 100
 *   every error costs 10 points
 *   every warning costs 2 points
 *   clamp to the 0 to 100 range, round to an integer
 *
 * Consequences: a clean surface scores 100; a surface with one error scores 90
 * (the A1 threshold); ten or more errors score 0. Warnings never make a valid
 * surface invalid, they only lower its score, so a valid site can score below
 * 90 and still exit 0.
 */
export const SCORE_RUBRIC = {
  start: 100,
  perError: 10,
  perWarning: 2,
  floor: 0,
  ceiling: 100,
} as const;

export function scoreFindings(errorCount: number, warningCount: number): number {
  const raw =
    SCORE_RUBRIC.start - errorCount * SCORE_RUBRIC.perError - warningCount * SCORE_RUBRIC.perWarning;
  const clamped = Math.min(SCORE_RUBRIC.ceiling, Math.max(SCORE_RUBRIC.floor, raw));
  return Math.round(clamped);
}
