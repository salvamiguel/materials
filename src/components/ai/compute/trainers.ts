/* Which trainer runs each demo; shared by the Web Worker and the on-page fallback. */

import { CnnTrainer } from '../cnn/trainer';
import { PerceptronTrainer } from '../perceptron/trainer';
import { TransformerTrainer } from '../transformer/trainer';
import type { Trainer } from './host';

export function makeTrainer(demo: string, state: Record<string, unknown>): Trainer {
  if (demo === 'perceptron') return new PerceptronTrainer(state);
  if (demo === 'cnn') return new CnnTrainer(state);
  if (demo === 'gpt' || demo === 'translator') return new TransformerTrainer(state);
  throw new Error(`Demo desconocida: ${demo}`);
}
