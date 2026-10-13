// Arrow navigation inside a menu rendered in an open shadow root: Radix's own helper stalls
// there (document.activeElement is the host), ours reads the root's activeElement.
import { describe, expect, it } from 'vitest';
import { menuItems, navigateMenu } from '../../src/ui/Menu';

function mount(inShadow: boolean) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: ShadowRoot | HTMLElement = inShadow ? host.attachShadow({ mode: 'open' }) : host;
  const menu = document.createElement('div');
  menu.setAttribute('data-menuzone', '');
  menu.innerHTML = '<div role="menuitem" tabindex="-1">A</div><div role="menuitem" tabindex="-1" data-disabled="">B</div>' +
    '<div role="menuitemcheckbox" tabindex="-1">C</div><div role="menuitem" tabindex="-1">D</div>';
  root.appendChild(menu);
  return { menu, active: () => (menu.getRootNode() as Document | ShadowRoot).activeElement?.textContent };
}

describe.each([false, true])('menu navigation (shadow root: %s)', (inShadow) => {
  it('walks enabled items with wrap, Home and End', () => {
    const { menu, active } = mount(inShadow);
    expect(menuItems(menu).map((e) => e.textContent)).toEqual(['A', 'C', 'D']);
    expect(navigateMenu(menu, 'ArrowDown')).toBe(true);
    expect(active()).toBe('A');
    navigateMenu(menu, 'ArrowDown'); expect(active()).toBe('C');
    navigateMenu(menu, 'ArrowDown'); expect(active()).toBe('D');
    navigateMenu(menu, 'ArrowDown'); expect(active()).toBe('A');
    navigateMenu(menu, 'ArrowUp'); expect(active()).toBe('D');
    navigateMenu(menu, 'Home'); expect(active()).toBe('A');
    navigateMenu(menu, 'End'); expect(active()).toBe('D');
    expect(navigateMenu(menu, 'ArrowLeft')).toBe(false);
  });
});
