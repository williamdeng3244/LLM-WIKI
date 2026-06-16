import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import ContextMenu from '@/components/ContextMenu';

// ContextMenu portals into document.body, so queries go through `screen`.
describe('ContextMenu', () => {
  it('renders item labels (and tolerates dividers)', () => {
    render(
      <ContextMenu
        x={0}
        y={0}
        onClose={() => {}}
        items={[
          { kind: 'item', label: 'Open' },
          { kind: 'divider' },
          { kind: 'item', label: 'Delete', danger: true },
        ]}
      />,
    );
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('clicking an enabled item fires its onClick', () => {
    const onClick = vi.fn();
    render(
      <ContextMenu x={0} y={0} onClose={vi.fn()} items={[{ kind: 'item', label: 'Open', onClick }]} />,
    );
    fireEvent.click(screen.getByText('Open'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('a disabled item does not fire onClick', () => {
    const onClick = vi.fn();
    render(
      <ContextMenu
        x={0}
        y={0}
        onClose={() => {}}
        items={[{ kind: 'item', label: 'Locked', onClick, disabled: true }]}
      />,
    );
    fireEvent.click(screen.getByText('Locked'));
    expect(onClick).not.toHaveBeenCalled();
  });
});
