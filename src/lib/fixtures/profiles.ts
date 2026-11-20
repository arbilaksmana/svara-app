import type { DeploymentProfile } from '../types';

/**
 * Cache profil deployment dari bootstrap server. UI tidak memakai entri ini untuk
 * memilih kebijakan survei; sumbernya `surveyProfiles` dari payload server.
 */
export const profiles: Record<string, DeploymentProfile> = {};
