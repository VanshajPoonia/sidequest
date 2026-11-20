// The backend this build uses. A hosted adapter that passes tests/backend-contract.mjs
// gets swapped in here, and nothing else in the game changes.
import { createLocalBackend } from './local.js';

export const backend = createLocalBackend();
