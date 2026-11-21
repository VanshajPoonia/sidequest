// The backend this build uses. Paste the deployed Worker's URL into BACKEND_URL to share
// events across phones (worker/, README "Team events"). Empty keeps every event in the
// browser that made it, which is how the live site works until a Worker is deployed.
import { createLocalBackend } from './local.js';
import { createCloudBackend } from './cloud.js';

export const BACKEND_URL = '';

export const backend = BACKEND_URL ? createCloudBackend({ url: BACKEND_URL }) : createLocalBackend();
