/**
 * 独立预览（pnpm dev:vite）专用富演示数据 —— D1 归零改造后从 schema.ts 默认值整体搬家至此。
 * 仅 store.ts 的预览分支引用；真机路径（defineMvuDataStore）零引用，未经驾驶员确认的演示数据不得充当开局正史。
 */
import type { Schema } from './schema';

/** 预览基底：等价于归零改造前的 schema 富默认值（两基地/7机娘/4队列/2情报/4势力/1任务/3选项等） */
export const previewBaseline: z.input<typeof Schema> = {
  schema_version: 2,
  meta: {
    world_id: 'xiuzhen',
    date: '秋·九月十七',
    day_count: 47,
    location: '青岚山北坡',
  },

  economy: {
    credits: 1514,
    credits_daily: 120,
    wallet: { 铜钱: 2340, 银两: 15, 下品灵石: 8, 中品灵石: 0, 上品灵石: 0 },
  },

  exposure: {
    value: 2.35,
    trend: '+0.02/日',
    last_change: 'MH-6夜间试飞 +0.15',
  },

  bases: [
    {
      id: 'beipo',
      name: '北坡主基地',
      location: '青岚山北坡',
      status: '隐蔽中',
      power: { gen: 200, use: 130 },
      buildings: [
        { name: '棚屋主体', layer: '地表层', state: '运转' },
        { name: '品字石灶', layer: '地表层', state: '运转' },
        { name: '晾药架', layer: '地表层', state: '运转' },
        { name: '发电厂', layer: '地下层', state: '运转' },
        { name: '建造厂核心', layer: '地下层', state: '运转' },
        { name: '兵营', layer: '地下层', state: '运转' },
        { name: '矿石精炼厂', layer: '地下层', state: '运转' },
        { name: '战车工厂', layer: '空腔层', state: '建造中', progress: 62, eta: '余3日' },
      ],
      alerts: ['灵脉脉动异常：加速0.5拍，疑似引脉法术'],
    },
    {
      id: 'yunxi',
      name: '云溪镇联络点',
      location: '云溪镇东巷',
      status: '隐蔽中',
      power: { gen: 12, use: 6 },
      buildings: [
        { name: '安全屋', layer: '地表层', state: '运转' },
        { name: '情报中转站', layer: '地下层', state: '运转' },
        { name: '同位素电源(RTG)', layer: '地下层', state: '运转' },
        { name: '应急物资窖', layer: '地下层', state: '建造中', progress: 40, eta: '余2日' },
      ],
      alerts: [],
    },
  ],

  queues: [
    { type: '建造', item: '战车工厂', base: 'beipo', progress: 62, eta: '余3日' },
    { type: '研究', item: '装甲载具工学', base: '', progress: 38, eta: '余2日' },
    { type: '生产', item: '5.56mm步枪弹 ×2000', base: 'beipo', progress: 80, eta: '余1日' },
    { type: '建造', item: '应急物资窖', base: 'yunxi', progress: 40, eta: '余2日' },
  ],

  tech: {
    done: ['基础步兵训练学', '纳米精密合成学', '个人装备工程学'],
  },

  forces: {
    girls: [
      { name: '白凌', duty: '基地中枢', hp: '完好' },
      { name: '柳翠', duty: '灵脉监听', hp: '完好' },
      { name: '乔念', duty: '碉堡值勤', hp: '完好' },
      { name: '秦筑', duty: '新腔开凿', hp: '完好' },
      { name: '沈幼宜', duty: '医堂坐诊', hp: '完好' },
      { name: '顾棠', duty: '外围侦察', hp: '完好' },
      { name: '方宁', duty: '镇内潜伏', hp: '完好' },
    ],
    troops: { 美国大兵: 4, 工程兵: 2 },
    command_cap: '6/12',
    vehicles: [],
    ammo: { '5.56mm': '充足', '.45ACP': '尚可' },
  },

  factions: [
    { name: '沈三刀', attitude: '警觉', intel: '已察觉乔念体能异常', risk: '中' },
    { name: '钱家', attitude: '敌意', intel: '', risk: '高' },
    { name: '云溪镇署', attitude: '中立', intel: '', risk: '低' },
    { name: '青岚剑派', attitude: '未接触', intel: '仅知名号', risk: '未知' },
  ],

  intel: [
    { src: '监听', content: '灵脉脉动加速0.5拍，疑似引脉法术', date: '秋·九月十七', cred: '高', read: false, pinned: false },
    { src: '渗透', content: '钱家近日购入大批灯油', date: '秋·九月十六', cred: '中', read: true, pinned: true },
  ],

  quests: {
    active: [{ name: '翎州来书·第二封', progress: '3/5', note: '' }],
    done_count: 4,
  },

  options: [
    { text: '让顾棠夜探钱家院落', tag: '侦察', cost: '暴露+0.05~0.15' },
    { text: '通过本地知情者放出“山货商队”的风声', tag: '伪装', cost: '耗时1日' },
    { text: '暂缓行动，等灵脉脉动恢复', tag: '稳妥', cost: '' },
  ],
};

