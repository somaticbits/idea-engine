import { presets, type Dose } from '../config.js';
import { callJev, ResultError } from './provider.js';

export type Score = { surprise: number; coherent: number; safe: number; kit?: number };
const MIN_PLAUSIBLE_COHERENCE = 0.65;
export function questionsFor(candidates: string[], kit: string[]) {
  const questions: Record<string, object> = {};
  candidates.forEach((_, i) => {
    questions[`c${i}_surprise`] = { type: 'score', instructions: `How unexpected is candidates[${i}] as an association of parent?`, criteria: ['Obvious', 'Fresh', 'Strange', 'Startling'] };
    questions[`c${i}_coherent`] = { type: 'noul', instructions: `Can a person readily explain a plausible semantic, sensory, functional, emotional, or conceptual connection from parent to candidates[${i}]? Answer no for gibberish, word salad, malformed text, or an association that requires inventing a story.` };
    questions[`c${i}_safe`] = { type: 'noul', instructions: `Is candidates[${i}] free of hateful, sexual or violent content?` };
    if (kit.length) questions[`c${i}_kit`] = { type: 'noul', instructions: `Could candidates[${i}] plausibly use something in kit?` };
  });
  return questions;
}
function probability(answer: unknown): number {
  if (!answer || typeof answer !== 'object') throw new ResultError('Jev answer missing.');
  const a = answer as Record<string, unknown>;
  // Score is a weighted level index (0..3 here), not a probability.
  const value = a.type === 'score' && typeof a.score === 'number' ? a.score / 3 : a.type === 'noul' && typeof a.noul === 'number' ? a.noul : NaN;
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new ResultError('Jev returned an invalid score.');
  return value;
}
export function select(candidates: string[], answers: Record<string, unknown>, dose: Dose, withKit: boolean) {
  const preset = presets[dose];
  return candidates.map((label, i) => {
    const surprise = probability(answers[`c${i}_surprise`]);
    const coherent = probability(answers[`c${i}_coherent`]);
    const safe = probability(answers[`c${i}_safe`]);
    const kit = withKit ? probability(answers[`c${i}_kit`]) : undefined;
    const scores: Score = { surprise, coherent, safe, ...(kit === undefined ? {} : { kit }) };
    return { label, scores, rank: surprise * preset.surprise + coherent * (1 - preset.surprise) + (kit ?? 0) * 0.1 };
  }).filter(item => item.scores.safe >= 0.8 && item.scores.coherent >= Math.max(preset.coherence, MIN_PLAUSIBLE_COHERENCE))
    .sort((a, b) => b.rank - a.rank).slice(0, 8);
}
export async function filter(key: string, seed: string, parent: string, kit: string[], candidates: string[], dose: Dose, model: string, operationId?: string) {
  const result = await callJev(key, { model, state: { seed, parent, kit, candidates }, questions: questionsFor(candidates, kit) }, 'jev', operationId);
  if (!result.answers || typeof result.answers !== 'object') throw new ResultError('Jev returned no answers.');
  return select(candidates, result.answers, dose, kit.length > 0);
}
