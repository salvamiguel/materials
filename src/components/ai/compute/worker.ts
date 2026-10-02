/* The Web Worker that trains the AI demos, so the page stays smooth while it
 * computes. It only relays messages to the Host. */

import { Host, type ToHost } from './host';
import { makeTrainer } from './trainers';

const scope = self as unknown as { postMessage: (m: unknown, t?: Transferable[]) => void; onmessage: ((e: MessageEvent<ToHost>) => void) | null };
const host = new Host((m, transfer) => scope.postMessage(m, transfer ?? []), makeTrainer);
scope.onmessage = (e) => host.handle(e.data);
