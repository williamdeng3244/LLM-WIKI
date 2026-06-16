import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Accessibility (WCAG 2 A/AA) scan of the app shell via axe-core. Surfaces real
 * a11y violations and gates the worst (critical). Serious/moderate ones are
 * logged for visibility but don't fail the build yet — fix-then-tighten.
 */
test('FR-A11Y app shell has no critical axe violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Enflame Wiki').first()).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  const byImpact = (impact: string) =>
    results.violations.filter((v) => v.impact === impact).map((v) => ({ id: v.id, nodes: v.nodes.length }));

  // Always log the full picture so the a11y state is visible in CI logs.
  console.log('a11y violations:', JSON.stringify({
    critical: byImpact('critical'),
    serious: byImpact('serious'),
    moderate: byImpact('moderate'),
    minor: byImpact('minor'),
  }, null, 2));

  const critical = byImpact('critical');
  expect(critical, `critical a11y violations: ${critical.map((v) => v.id).join(', ')}`).toHaveLength(0);
});
