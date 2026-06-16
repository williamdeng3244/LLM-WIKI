import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import Markdown from '@/components/Markdown';

// Frontend half of the stored-XSS lock (the backend half is
// backend/tests/test_security_xss.py). The wiki renders user markdown via
// react-markdown WITHOUT rehype-raw, so raw HTML is inert. If anyone adds
// rehype-raw, these fail.
describe('Markdown — XSS safety + rendering', () => {
  it('renders markdown but never creates a live <script> (no rehype-raw)', () => {
    const { container } = render(
      <Markdown>{"# Title\n\n<script>alert('XSSMD')</script>\n\n**bold**"}</Markdown>,
    );
    // core lock: no executable <script> element is produced
    expect(container.querySelector('script')).toBeNull();
    // markdown still renders structurally
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    // the payload survives only as inert text
    expect(container.textContent).toContain('XSSMD');
  });

  it('does not emit a javascript: href', () => {
    const { container } = render(
      <Markdown>{"[click me](javascript:alert('XSSLINK'))"}</Markdown>,
    );
    const hrefs = Array.from(container.querySelectorAll('a')).map(
      (a) => a.getAttribute('href') || '',
    );
    expect(hrefs.some((h) => h.toLowerCase().includes('javascript:'))).toBe(false);
  });
});
