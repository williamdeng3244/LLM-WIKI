import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import Diff from '@/components/Diff';

describe('Diff', () => {
  it('marks added and removed lines distinctly', () => {
    const { container } = render(
      <Diff oldText={'a\nb\nc'} newText={'a\nx\nc'} contextOnly={false} />,
    );
    const adds = [...container.querySelectorAll('.diff-add')].map((e) => e.textContent);
    const dels = [...container.querySelectorAll('.diff-del')].map((e) => e.textContent);
    expect(adds).toContain('x'); // 'x' added
    expect(dels).toContain('b'); // 'b' removed
  });

  it('renders unchanged lines as context', () => {
    const { container } = render(
      <Diff oldText={'a\nb'} newText={'a\nx'} contextOnly={false} />,
    );
    const ctx = [...container.querySelectorAll('.diff-ctx')].map((e) => e.textContent);
    expect(ctx).toContain('a'); // 'a' unchanged
  });

  it('shows a "no textual changes" message for two empty bodies', () => {
    const { container } = render(<Diff oldText="" newText="" />);
    expect(container.textContent).toMatch(/no textual changes/i);
  });
});
