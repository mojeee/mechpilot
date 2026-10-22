// One real call to Anthropic (claude-haiku-5-5) through the full assistant loop: the model must
// read the drawing and come back with a valid proposal for a 50 × 30 plate. Skipped unless
// ANTHROPIC_API_KEY is set in the environment or in .env.local (git-ignored); the key is never
// printed. Costs a fraction of a cent.

import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { readDotEnv } from '../app/main/ai/keys';
import { AnthropicProvider } from '../app/main/ai/providers/anthropic';
import { runAssistant } from '../app/main/ai/assistant';
import { apply } from '@shared/commands';
import { documentBox } from '@shared/doc/document';
import { blank, context, request } from './ai-helpers';

const key = process.env.ANTHROPIC_API_KEY?.trim() || readDotEnv(join(__dirname, '..', '.env.local')).ANTHROPIC_API_KEY?.trim() || '';

describe.skipIf(!key)('real Anthropic call (claude-haiku-5-5)', () => {
  it('proposes a valid 50 × 30 plate', async () => {
    const doc = blank();
    const r = await runAssistant(request('Draw a rectangular plate outline, 50 mm wide and 30 mm high, with its lower left corner at the origin. Propose it.', context(doc)), {
      provider: new AnthropicProvider(key),
      providerId: 'anthropic',
      model: 'claude-haiku-5-5',
    });
    expect(r.ok, r.ok ? '' : `${r.error.code}: ${r.error.message}`).toBe(true);
    if (!r.ok) return;
    expect(r.value.proposals.length).toBeGreaterThanOrEqual(1);
    let cur = doc;
    for (const p of r.value.proposals) {
      const a = apply(cur, { kind: 'batch', label: 'AI', commands: p.commands });
      expect(a.ok).toBe(true);
      if (a.ok) cur = a.doc;
    }
    const box = documentBox(cur, false);
    expect(box).not.toBeNull();
    // Annotations may extend the box; the geometry must at least cover 50 × 30.
    const geometry = { ...cur, entityOrder: cur.entityOrder.filter((id) => cur.entities[id].type !== 'dimension' && cur.entities[id].type !== 'note' && cur.entities[id].type !== 'text') };
    const g = documentBox(geometry, false);
    expect(g).not.toBeNull();
    if (g) {
      expect(g.max.x - g.min.x).toBeCloseTo(50, 6);
      expect(g.max.y - g.min.y).toBeCloseTo(30, 6);
    }
  }, 180_000);
});
