import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  inferPrimaryThemeFromSnapshot,
  installCrossFrameThemeSync,
  normalizeThemeKey,
  onThemeChange,
  RA_THEME_MESSAGE_TYPE,
  setTheme,
  THEME_STORE_KEY,
  ui,
} from '../../红警指挥系统/ui/ui';
import { syncHostAndChildFramesTheme } from '../host/modalHost';

function createMockElement(tagName = 'DIV') {
  const attrs = new Map<string, string>();
  const styleProps = new Map<string, string>();
  return {
    tagName: tagName.toUpperCase(),
    id: '',
    setAttribute: (k: string, v: string) => attrs.set(k, String(v)),
    getAttribute: (k: string) => attrs.get(k) ?? null,
    removeAttribute: (k: string) => attrs.delete(k),
    style: {
      setProperty: (k: string, v: string) => styleProps.set(k, String(v)),
      getPropertyValue: (k: string) => styleProps.get(k) ?? '',
    },
    querySelector: (_sel: string) => null as unknown,
  };
}

describe('中控台阵营终端色与跨 iframe 实时联动总线 (CROSS-FRAME-THEME-01)', () => {
  const storageMap = new Map<string, string>();
  const listeners = new Map<string, Set<(e: any) => void>>();

  beforeEach(() => {
    storageMap.clear();
    listeners.clear();

    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storageMap.get(k) ?? null,
      setItem: (k: string, v: string) => storageMap.set(k, String(v)),
      clear: () => storageMap.clear(),
    });

    const mockWin: Record<string, any> = {
      addEventListener: (type: string, fn: (e: any) => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: (e: any) => void) => {
        listeners.get(type)?.delete(fn);
      },
      dispatchEvent: (ev: { type: string; detail?: unknown }) => {
        for (const fn of listeners.get(ev.type) ?? []) fn(ev);
        return true;
      },
      postMessage: (data: unknown) => {
        for (const fn of listeners.get('message') ?? []) fn({ data });
      },
    };
    mockWin.parent = mockWin;
    vi.stubGlobal('window', mockWin);

    setTheme('allied', { broadcast: false, persist: false });
  });

  it('1. normalizeThemeKey：兼容中英文阵营名与标准主题键', () => {
    expect(normalizeThemeKey('allied')).toBe('allied');
    expect(normalizeThemeKey('allies')).toBe('allied');
    expect(normalizeThemeKey('盟军')).toBe('allied');
    expect(normalizeThemeKey('MCV（盟军）')).toBe('allied');
    expect(normalizeThemeKey('soviet')).toBe('soviet');
    expect(normalizeThemeKey('苏联')).toBe('soviet');
    expect(normalizeThemeKey('苏维埃工业工厂')).toBe('soviet');
    expect(normalizeThemeKey('yuri')).toBe('yuri');
    expect(normalizeThemeKey('尤里')).toBe('yuri');
    expect(normalizeThemeKey('unknown')).toBeNull();
  });

  it('2. setTheme：更新 ui.theme、写入 localStorage 并触发 onThemeChange 与跨帧广播', () => {
    const received: string[] = [];
    const off = onThemeChange(t => received.push(t));
    const msgSpy = vi.fn();
    window.addEventListener('message', msgSpy);

    setTheme('soviet');
    expect(ui.theme).toBe('soviet');
    expect(localStorage.getItem(THEME_STORE_KEY)).toBe('soviet');
    expect(received).toEqual(['soviet']);
    expect(msgSpy).toHaveBeenCalledWith({
      data: { type: RA_THEME_MESSAGE_TYPE, theme: 'soviet' },
    });

    setTheme('yuri');
    expect(ui.theme).toBe('yuri');
    expect(localStorage.getItem(THEME_STORE_KEY)).toBe('yuri');
    expect(received).toEqual(['soviet', 'yuri']);

    window.removeEventListener('message', msgSpy);
    off();
  });

  it('3. installCrossFrameThemeSync：收到跨 iframe postMessage(ra-theme-changed) 时自动同步 ui.theme 且不回声死循环', () => {
    const detach = installCrossFrameThemeSync();
    expect(ui.theme).toBe('allied');

    window.postMessage({ type: RA_THEME_MESSAGE_TYPE, theme: 'yuri' }, '*');
    expect(ui.theme).toBe('yuri');

    window.postMessage({ type: RA_THEME_MESSAGE_TYPE, theme: '苏联' }, '*');
    expect(ui.theme).toBe('soviet');
    detach();
  });

  it('4. syncHostAndChildFramesTheme：同步宿主 html/body data-ra-theme、--rac-* 变量，并穿透同步子楼层 iframe 的 #app 与 .launcher-shell', () => {
    const docEl = createMockElement('HTML');
    const bodyEl = createMockElement('BODY');
    const childApp = createMockElement('DIV');
    const childLauncher = createMockElement('DIV');
    childApp.querySelector = (sel: string) => (sel === '.terminal-shell' ? createMockElement('DIV') : null);

    const childWinPostMessage = vi.fn();
    const childIframe = {
      ...createMockElement('IFRAME'),
      id: 'floor-iframe-1',
      contentWindow: { postMessage: childWinPostMessage },
      contentDocument: {
        getElementById: (id: string) => (id === 'app' ? childApp : null),
        querySelector: (sel: string) => (sel === '.launcher-shell' ? childLauncher : null),
      },
    };

    const mockHostDoc = {
      documentElement: docEl,
      body: bodyEl,
      querySelectorAll: (sel: string) => (sel === 'iframe' ? [childIframe] : []),
    } as unknown as Document;

    syncHostAndChildFramesTheme(mockHostDoc, 'soviet');

    expect(docEl.getAttribute('data-ra-theme')).toBe('soviet');
    expect(bodyEl.getAttribute('data-ra-theme')).toBe('soviet');
    expect(docEl.style.getPropertyValue('--rac-accent')).toBe('#e25555');
    expect(childIframe.getAttribute('data-ra-theme')).toBe('soviet');
    expect(childApp.getAttribute('data-theme')).toBe('soviet');
    expect(childLauncher.getAttribute('data-theme')).toBe('soviet');
    expect(childWinPostMessage).toHaveBeenCalledWith(
      { type: RA_THEME_MESSAGE_TYPE, theme: 'soviet' },
      '*',
    );

    syncHostAndChildFramesTheme(mockHostDoc, 'yuri');
    expect(docEl.getAttribute('data-ra-theme')).toBe('yuri');
    expect(docEl.style.getPropertyValue('--rac-accent')).toBe('#b892e5');
    expect(childApp.getAttribute('data-theme')).toBe('yuri');
    expect(childLauncher.getAttribute('data-theme')).toBe('yuri');
  });

  it('5. inferPrimaryThemeFromSnapshot：多阵营开局下盟军 MCV 展开为盟军建造厂后，不因剩余车队首车为 MCV（苏联）而误切苏军红', () => {
    const snap = {
      command: {
        unlocked_factions: ['allied', 'soviet', 'yuri'],
        adjutants: [
          {
            id: 'adj_allied_commander',
            role: 'faction',
            faction: 'allied',
            identity: 'commander_self',
            status: 'active',
          },
        ],
      },
      forces: {
        // 盟军 MCV 已展开移出车队，剩余待命车队首车为 MCV（苏联）
        vehicles: ['MCV（苏联）', 'MCV（尤里）'],
      },
      bases: [
        {
          id: 'base_1',
          name: '1号主基地',
          status: '运转中',
          buildings: [{ name: '盟军建造厂' }, { name: '盟军发电厂' }],
        },
      ],
    };
    expect(inferPrimaryThemeFromSnapshot(snap)).toBe('allied');
  });
});
