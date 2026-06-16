import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import ShortcutSheet from '@/components/ShortcutSheet';

describe('ShortcutSheet', () => {
  it('renders the shortcut keys inside a labelled dialog', () => {
    render(<ShortcutSheet onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // keys render as separate <kbd> tokens, so textContent has no literal space
    expect(dialog.textContent).toContain('⌘K'); // search
    expect(dialog.textContent).toContain('Open search'); // its action label
    expect(dialog.textContent).toContain('New tab');
    expect(dialog.textContent).toContain('Esc'); // dialog-scope escape
  });

  it('Escape calls onClose', () => {
    const onClose = vi.fn();
    render(<ShortcutSheet onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
