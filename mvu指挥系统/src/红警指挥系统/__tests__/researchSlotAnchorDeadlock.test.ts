/**
 * researchSlotAnchorDeadlock.test.ts —— 研究槽锚定建筑自锁不变量（真实世界书）
 *
 * 不变量：任一研究槽至少有一座锚定建筑（SLOT_REGISTRY.anchorNames）其前置科技（prereqs/research）
 * 不落在该槽自身 line 内——否则「开槽需建筑 → 建筑需科技 → 科技需开槽」形成死锁，
 * 该线永远无法开通。约定：开槽入门科技归「通用」线，在主建筑槽研（与装甲载具工学/个人装备工程学同例）。
 * 升级型变体锚（如扩大版战车工厂）依赖本线科技是合理的，只要基础型锚能开槽即可。
 *
 * 背景：基础环境工程学（环保）与封闭生态与副食工学（农畜业）曾各自落在本线导致自锁，已改归通用。
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseWorldbookEntries } from '../../中控悬浮窗/models/worldbookCatalogParser';
import { SLOT_REGISTRY, slotFor } from '../engines/researchSlots';

const WORLDBOOK_DIR = path.resolve(__dirname, '../../../../worldbooks');

interface Tech {
  name: string;
  line?: string;
  requirements?: unknown;
}
interface Bld {
  name: string;
  prereqs: string[];
  research?: string | null;
}

function loadCatalog(): { techs: Map<string, Tech>; buildings: Bld[] } {
  const techs = new Map<string, Tech>();
  const buildings: Bld[] = [];
  for (const file of fs.readdirSync(WORLDBOOK_DIR)) {
    if (!file.endsWith('.json')) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(WORLDBOOK_DIR, file), 'utf8'));
    } catch {
      continue;
    }
    const parsed = parseWorldbookEntries(raw, { silent: true });
    for (const r of parsed.researches) {
      const name = (r as { name?: string; id?: string }).name ?? (r as { id?: string }).id;
      if (name) techs.set(name, { name, line: (r as { line?: string }).line, requirements: (r as { requirements?: unknown }).requirements });
    }
    for (const b of parsed.buildings) {
      const bb = b as { name?: string; prereqs?: string[]; research?: string | null };
      if (!bb.name) continue;
      buildings.push({ name: bb.name, prereqs: Array.isArray(bb.prereqs) ? bb.prereqs : [], research: bb.research });
    }
  }
  return { techs, buildings };
}

describe('研究槽锚定建筑自锁不变量（真实世界书）', () => {
  const { techs, buildings } = loadCatalog();

  it('世界书已加载：研究与建筑非空', () => {
    expect(techs.size).toBeGreaterThan(100);
    expect(buildings.length).toBeGreaterThan(100);
  });

  it('每个槽至少有一座锚定建筑不依赖本槽科技（否则该槽永不可开通）', () => {
    const violations: string[] = [];
    for (const slot of SLOT_REGISTRY) {
      const anchors = buildings.filter(b => slot.anchorNames.some(a => b.name.includes(a)));
      if (anchors.length === 0) continue; // 模糊锚（如「对应阵营 MCV」）或未入目录的锚不在本不变量辖区
      const selfLocked = (b: Bld): string | undefined => {
        const reqs = new Set<string>([...b.prereqs, ...(b.research ? [b.research] : [])]);
        for (const req of reqs) {
          const tech = techs.get(req);
          if (!tech?.line) continue;
          const res = slotFor(tech.line);
          if (res.matched !== 'fallback' && res.slotId === slot.slotId) return `${req}（line=${tech.line}）`;
        }
        return undefined;
      };
      // 升级型变体（如「扩大版自动化战车工厂」）依赖本线科技是合理的，只要基础型锚定建筑能开槽即可
      const escape = anchors.find(b => selfLocked(b) === undefined);
      if (!escape) {
        violations.push(
          `${slot.slotId}（${slot.name}）全部锚定建筑均依赖本槽科技 → 自锁：` +
            anchors.map(b => `「${b.name}」←${selfLocked(b)}`).join('；'),
        );
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('两项曾自锁的入门科技已归「通用」线并落入主建筑槽', () => {
    for (const name of ['基础环境工程学', '封闭生态与副食工学']) {
      const t = techs.get(name);
      expect(t, name).toBeDefined();
      expect(t!.line, name).toBe('通用');
      expect(slotFor(t!.line!).slotId, name).toBe('slot.main');
    }
  });

  it('研究显式 requirements 中的建筑原子必须是 global/completed（研究队列全局，前置建筑任一基地建成即可）', () => {
    const violations: string[] = [];
    const walk = (name: string, node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const n = node as { conditions?: unknown[]; kind?: string; scope?: string; state?: string; name?: string };
      if (Array.isArray(n.conditions)) {
        n.conditions.forEach(c => walk(name, c));
        return;
      }
      if (n.kind === 'building' && (n.scope !== 'global' || n.state !== 'completed')) {
        violations.push(`「${name}」←「${n.name}」scope=${n.scope} state=${n.state}`);
      }
    };
    let withRequirements = 0;
    for (const t of techs.values()) {
      if (t.requirements === undefined) continue;
      withRequirements++;
      walk(t.name, t.requirements);
    }
    expect(withRequirements).toBeGreaterThan(100);
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('车族/舰族多姐妹拆分不变量：冗余总卡「模块化前线基地车族」退出生产池，盟苏 13 组拆出的 36 个具体子车/子舰全部可造', () => {
    const prodNames = new Set<string>();
    for (const file of fs.readdirSync(WORLDBOOK_DIR)) {
      if (!file.endsWith('.json')) continue;
      let raw: unknown;
      try {
        raw = JSON.parse(fs.readFileSync(path.join(WORLDBOOK_DIR, file), 'utf8'));
      } catch {
        continue;
      }
      const parsed = parseWorldbookEntries(raw, { silent: true });
      for (const p of parsed.productions) {
        const name = (p as { name?: string; id?: string }).name ?? (p as { id?: string }).id;
        if (name) prodNames.add(name);
      }
    }

    // 1. 通用·陆地载具的冗余总卡不再占生产槽，4 辆具体展开功能车保留
    expect(prodNames.has('模块化前线基地车族')).toBe(false);
    for (const sub of ['前线战车组装车', '前线整备车', '野战机场车', '前线维修车']) {
      expect(prodNames.has(sub), sub).toBe(true);
    }

    // 2. 盟军 6 组（17 姐妹）+ 苏联 7 组（19 姐妹）全部独立在列
    const expectedSisters = [
      // 盟军 6 组
      'F-35A闪电II常规起降隐身战斗机',
      'F-35B闪电II短垂起降隐身战斗机',
      'F-35C闪电II舰载隐身战斗机',
      'RCV-L“撕裂者”轻型无人侦察战车',
      'RCV-M中型无人步战伴随车',
      'RCV-H重型无人突击炮车',
      'M1283 AMPV通用装甲勤务运兵车',
      'M1284 AMPV装甲野战医疗后送车',
      'M1285 AMPV装甲战地医疗手术车',
      'M1286 AMPV装甲移动战术指挥车',
      'M1287 AMPV 120毫米自行迫击炮车',
      'FFG-62星座级隐身导弹护卫舰',
      'DDG-1000朱姆沃尔特级隐身导弹驱逐舰',
      'LUSV“游骑兵”大型无人导弹武库舰',
      'MUSV“水手”中型无人哨戒侦察舰',
      'Orca“虎鲸”超大型深海布雷无人潜航器',
      'Manta Ray“魔鬼鱼”仿生深海滑翔潜航器',
      // 苏联 7 组
      'MT-LB通用两栖装甲牵引输送车',
      'BMD-4M“园丁”两栖空降步兵战车',
      '2S3M“金合欢”152毫米自行榴弹炮',
      '2S19M2“姆斯塔-S”152毫米自行榴弹炮',
      'BM-21“冰雹”122毫米40管火箭炮',
      'BM-27“飓风”220毫米16管重型火箭炮',
      'BM-30“龙卷风”300毫米12管远程火箭炮',
      'UR-77“陨石”火箭爆破扫雷车',
      'MTU-90M重型装甲伴随架桥车',
      'PMP-M重型机械化舟桥纵列',
      '米-8AMTSh“终结者”武装突击运输直升机',
      '卡-52M“短吻鳄”共轴重型武装直升机',
      '米-26T2V“光晕”超重型运输直升机',
      'S-300PMU2“骄子”远程防空导弹系统',
      'S-400“凯旋”远程战略防空系统',
      'S-500“普罗米修斯”空天防御反导系统',
      '775型“蟾蜍”级大型坦克登陆舰',
      '11711型“伊万·格连”级大型登陆舰',
      '12322型“欧洲野牛”级重型气垫登陆艇',
    ];
    for (const s of expectedSisters) {
      expect(prodNames.has(s), s).toBe(true);
    }
  });
});
