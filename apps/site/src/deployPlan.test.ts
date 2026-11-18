import { describe, expect, it } from 'vitest';
import { deployPlan } from '../scripts/deployPlan.mjs';

describe('deployPlan', () => {
  it('defaults to a preview deploy', () => expect(deployPlan([])).toMatchObject({ branch: 'preview' }));

  it('refuses production without the owner flag', () => {
    expect(deployPlan(['--production'])).toHaveProperty('error');
  });

  it('says why production was refused', () => {
    const p = deployPlan(['--production']) as { error: string };
    expect(p.error).toBe(
      "Production deploys need Mike's explicit go for this deploy. Re-run with --owner-approved only after he has said so.",
    );
  });

  it('allows production with both flags', () => {
    expect(deployPlan(['--production', '--owner-approved'])).toMatchObject({ branch: 'main' });
  });

  it('does not treat the owner flag alone as production', () => {
    expect(deployPlan(['--owner-approved'])).toMatchObject({ branch: 'preview' });
  });

  it('always targets the ascent-site project and the built dist', () => {
    const p = deployPlan([]) as { args: string[] };
    expect(p.args).toEqual(['pages', 'deploy', 'apps/site/dist', '--project-name', 'ascent-site', '--branch', 'preview']);
  });

  it('uses the main branch for an approved production deploy', () => {
    const p = deployPlan(['--production', '--owner-approved']) as { args: string[] };
    expect(p.args.slice(-2)).toEqual(['--branch', 'main']);
  });

  it('ignores --dry-run, which the wrapper handles', () => {
    expect(deployPlan(['--dry-run'])).toEqual(deployPlan([]));
  });
});
