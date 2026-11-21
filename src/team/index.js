// The backend this build uses: the Worker in worker/, so events are shared across phones.
// Empty keeps every event in the browser that made it (README "Team events").
import { createLocalBackend } from './local.js';
import { createCloudBackend } from './cloud.js';

export const BACKEND_URL = 'https://events.vanshajpoonia.com';

export const backend = BACKEND_URL ? createCloudBackend({ url: BACKEND_URL }) : createLocalBackend();
