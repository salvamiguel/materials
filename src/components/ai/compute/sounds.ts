/* Sounds named by the training worker (it cannot play audio itself). */

import { sfx } from '../perceptron/chiptune';
import type { Sound } from './host';

export function playSounds(sounds: Sound[]) {
  for (const s of sounds) {
    if (s === 'win') sfx.win();
    else if (s === 'ok') sfx.ok();
    else if (s === 'error') sfx.error();
    else if (s === 'click') sfx.click();
    else sfx.epoch(s.epoch);
  }
}
