import { describe, expect, it } from 'vitest';
import {
  advanceCalendar,
  DEFAULT_FALLBACK_MINUTES,
  formatTimePast,
  parseTimePast,
  stripTimePast,
} from '../parse/timePastParser';

describe('timePastParser - CTRL-TIME-PARSER-01', () => {
  describe('1. 鲁棒语法提取（parseTimePast）', () => {
    it('应精准解析标准格式 <timePast>0 D 8 H 0 M</timePast>', () => {
      const text = '<timePast>0 D 8 H 0 M</timePast>\n正文：基地展开完毕，雷达上线。';
      const res = parseTimePast(text);
      expect(res.success).toBe(true);
      expect(res.isFallback).toBe(false);
      expect(res.deltaMinutes).toBe(480);
      expect(res.days).toBe(0);
      expect(res.hours).toBe(8);
      expect(res.minutes).toBe(0);
      expect(res.rawText).toBe('0 D 8 H 0 M');
    });

    it('应支持跨天与多小时分钟混合计算 (1 D 2 H 30 M = 1590 分钟)', () => {
      const text = '<timePast>1 D 2 H 30 M</timePast>';
      const res = parseTimePast(text);
      expect(res.success).toBe(true);
      expect(res.deltaMinutes).toBe(1590);
      expect(res.days).toBe(1);
      expect(res.hours).toBe(2);
      expect(res.minutes).toBe(30);
    });

    it('应容忍各种标签大小写变体 (<timepast>, <TimePast>, <TIMEPAST>)', () => {
      const t1 = '<timepast>2 D 4 H</timepast>';
      const t2 = '<TimePast>15 M</TimePast>';
      const t3 = '<TIMEPAST> 36 H </TIMEPAST>';

      const r1 = parseTimePast(t1);
      expect(r1.success).toBe(true);
      expect(r1.deltaMinutes).toBe(2 * 1440 + 4 * 60);

      const r2 = parseTimePast(t2);
      expect(r2.success).toBe(true);
      expect(r2.deltaMinutes).toBe(15);

      const r3 = parseTimePast(t3);
      expect(r3.success).toBe(true);
      expect(r3.deltaMinutes).toBe(36 * 60); // 2160 分钟
      expect(r3.days).toBe(1);
      expect(r3.hours).toBe(12);
      expect(r3.minutes).toBe(0);
    });

    it('应容忍标签内多行换行与空白', () => {
      const text = `<timePast>
        0 D
        12 H
        30 M
      </timePast>`;
      const res = parseTimePast(text);
      expect(res.success).toBe(true);
      expect(res.deltaMinutes).toBe(12 * 60 + 30);
      expect(res.hours).toBe(12);
      expect(res.minutes).toBe(30);
    });

    it('应支持紧凑缩写语法 (2d4h, 1d2h30m, 45m)', () => {
      expect(parseTimePast('<timePast>2d4h</timePast>').deltaMinutes).toBe(2880 + 240);
      expect(parseTimePast('<timePast>1d2h30m</timePast>').deltaMinutes).toBe(1440 + 120 + 30);
      expect(parseTimePast('<timePast>45m</timePast>').deltaMinutes).toBe(45);
      expect(parseTimePast('<timePast>3hrs</timePast>').deltaMinutes).toBe(180);
      expect(parseTimePast('<timePast>2days 5hours</timePast>').deltaMinutes).toBe(2880 + 300);
    });

    it('应支持浮点数天与小时 (1.5 H = 90 M, 0.5 D = 720 M)', () => {
      const r1 = parseTimePast('<timePast>1.5 H</timePast>');
      expect(r1.success).toBe(true);
      expect(r1.deltaMinutes).toBe(90);

      const r2 = parseTimePast('<timePast>0.5 D</timePast>');
      expect(r2.success).toBe(true);
      expect(r2.deltaMinutes).toBe(720);

      const r3 = parseTimePast('<timePast>2.5 小时</timePast>');
      expect(r3.success).toBe(true);
      expect(r3.deltaMinutes).toBe(150);
    });

    it('应自然支持中文自然语言单位 (天/小时/分/半天/1天半/半小时)', () => {
      const r1 = parseTimePast('<timePast>2天4小时15分</timePast>');
      expect(r1.success).toBe(true);
      expect(r1.deltaMinutes).toBe(2 * 1440 + 4 * 60 + 15);

      const r2 = parseTimePast('<timePast>1天半</timePast>');
      expect(r2.success).toBe(true);
      expect(r2.deltaMinutes).toBe(2160); // 1.5 天 = 36 小时

      const r3 = parseTimePast('<timePast>半天</timePast>');
      expect(r3.success).toBe(true);
      expect(r3.deltaMinutes).toBe(720); // 12 小时

      const r4 = parseTimePast('<timePast>半小时</timePast>');
      expect(r4.success).toBe(true);
      expect(r4.deltaMinutes).toBe(30);

      const r5 = parseTimePast('<timePast>1小时半</timePast>');
      expect(r5.success).toBe(true);
      expect(r5.deltaMinutes).toBe(90);
    });

    it('应支持纯数字无单位降级为分钟数', () => {
      const res = parseTimePast('<timePast>120</timePast>');
      expect(res.success).toBe(true);
      expect(res.deltaMinutes).toBe(120);
      expect(res.hours).toBe(2);
      expect(res.minutes).toBe(0);
    });

    it('应支持 0 流逝时间 (0 D 0 H 0 M 或 0)', () => {
      const r1 = parseTimePast('<timePast>0 D 0 H 0 M</timePast>');
      expect(r1.success).toBe(true);
      expect(r1.isFallback).toBe(false);
      expect(r1.deltaMinutes).toBe(0);

      const r2 = parseTimePast('<timePast>0</timePast>');
      expect(r2.success).toBe(true);
      expect(r2.deltaMinutes).toBe(0);
    });
  });

  describe('2. 安全兜底与隔离（Safe Fallback）', () => {
    it('当标签完全缺失时应安全降级至默认步长 (60 分钟)', () => {
      const text = '前方出现鲍里斯的特战小队，正在建立临时防线。';
      const res = parseTimePast(text);
      expect(res.success).toBe(false);
      expect(res.isFallback).toBe(true);
      expect(res.deltaMinutes).toBe(DEFAULT_FALLBACK_MINUTES);
      expect(res.hours).toBe(1);
      expect(res.minutes).toBe(0);
      expect(res.error).toContain('not found');
    });

    it('支持调用方自定义缺省兜底步长', () => {
      const text = '未指定时间流逝。';
      const res = parseTimePast(text, { defaultMinutes: 180 });
      expect(res.success).toBe(false);
      expect(res.isFallback).toBe(true);
      expect(res.deltaMinutes).toBe(180);
      expect(res.hours).toBe(3);
    });

    it('空标签或纯空白标签应触发兜底', () => {
      const r1 = parseTimePast('<timePast></timePast>');
      expect(r1.success).toBe(false);
      expect(r1.isFallback).toBe(true);
      expect(r1.deltaMinutes).toBe(DEFAULT_FALLBACK_MINUTES);

      const r2 = parseTimePast('<timePast>   \n  </timePast>');
      expect(r2.success).toBe(false);
      expect(r2.isFallback).toBe(true);
    });

    it('包含非法负数时应严格拦截并触发兜底 (防止时空倒流)', () => {
      const r1 = parseTimePast('<timePast>-2 H</timePast>');
      expect(r1.success).toBe(false);
      expect(r1.isFallback).toBe(true);
      expect(r1.deltaMinutes).toBe(DEFAULT_FALLBACK_MINUTES);

      const r2 = parseTimePast('<timePast>1 D -5 H</timePast>');
      expect(r2.success).toBe(false);
      expect(r2.isFallback).toBe(true);
    });

    it('完全畸变的内容应触发兜底', () => {
      const res = parseTimePast('<timePast>invalid-syntax-nan</timePast>');
      expect(res.success).toBe(false);
      expect(res.isFallback).toBe(true);
      expect(res.deltaMinutes).toBe(DEFAULT_FALLBACK_MINUTES);
      expect(res.error).toBeDefined();
    });

    it('非字符串或空值输入防御', () => {
      // @ts-expect-error 测试边界非法类型
      const r1 = parseTimePast(null);
      expect(r1.success).toBe(false);
      expect(r1.isFallback).toBe(true);

      // @ts-expect-error 测试边界非法类型
      const r2 = parseTimePast(undefined);
      expect(r2.success).toBe(false);
      expect(r2.isFallback).toBe(true);
    });
  });

  describe('3. 正文清洗工具（stripTimePast）', () => {
    it('应从正文开头精准剥离 <timePast> 块并清除遗留空行', () => {
      const raw = `<timePast>0 D 8 H 0 M</timePast>
<生产>
- 犀牛主战坦克: 1台
</生产>
晨光破晓，第一批重装部队驶出战车工厂。`;

      const stripped = stripTimePast(raw);
      expect(stripped).not.toContain('<timePast>');
      expect(stripped).not.toContain('</timePast>');
      expect(stripped.startsWith('<生产>')).toBe(true);
      expect(stripped).toContain('晨光破晓');
    });

    it('应清洗多个 <timePast> 标签并压缩多余空行', () => {
      const raw = `<timePast>2 D</timePast>\n\n\n\n中段叙述...\n\n<timePast>4 H</timePast>\n\n结尾`;
      const stripped = stripTimePast(raw);
      expect(stripped).not.toContain('<timePast>');
      expect(stripped).toContain('中段叙述...\n\n结尾');
    });

    it('若无标签应保持原意并清理两端多余空行', () => {
      const text = '\n\n无标签正文内容。\n\n';
      expect(stripTimePast(text)).toBe('无标签正文内容。');
    });

    it('非字符串输入应安全返回空字符串', () => {
      // @ts-expect-error 测试非法输入
      expect(stripTimePast(null)).toBe('');
      // @ts-expect-error 测试非法输入
      expect(stripTimePast(undefined)).toBe('');
    });
  });

  describe('4. 日历时钟推进积分（advanceCalendar）', () => {
    it('标准 ISO 格式同日推进 (2026-09-18 08:00 + 150m)', () => {
      const res = advanceCalendar('2026-09-18 08:00', 150, 10);
      expect(res.newDate).toBe('2026-09-18 10:30');
      expect(res.dayCountDelta).toBe(0);
      expect(res.newDayCount).toBe(10);
      expect(res.timeStr).toBe('10:30');
    });

    it('标准 ISO 格式跨天推进 (2026-09-18 23:00 + 120m 跨越午夜)', () => {
      const res = advanceCalendar('2026-09-18 23:00', 120, 10);
      expect(res.newDate).toBe('2026-09-19 01:00');
      expect(res.dayCountDelta).toBe(1);
      expect(res.newDayCount).toBe(11);
      expect(res.timeStr).toBe('01:00');
    });

    it('标准 ISO 格式跨多天与跨月推进 (2026-09-30 20:00 + 2880m 跨越 2 天)', () => {
      const res = advanceCalendar('2026-09-30 20:00', 2880, 15);
      expect(res.newDate).toBe('2026-10-02 20:00');
      expect(res.dayCountDelta).toBe(2);
      expect(res.newDayCount).toBe(17);
    });

    it('游戏架空复合格式 (秋·九月十七 08:00 + 1500m / 25 小时)', () => {
      const res = advanceCalendar('秋·九月十七 08:00', 1500, 47);
      expect(res.newDate).toBe('秋·九月十七 09:00');
      expect(res.dayCountDelta).toBe(1);
      expect(res.newDayCount).toBe(48);
      expect(res.timeStr).toBe('09:00');
    });

    it('游戏“第N天”联动自增 (第47天 08:00 + 1500m 推进为第48天)', () => {
      const res = advanceCalendar('第47天 08:00', 1500, 47);
      expect(res.newDate).toBe('第48天 09:00');
      expect(res.dayCountDelta).toBe(1);
      expect(res.newDayCount).toBe(48);
      expect(res.timeStr).toBe('09:00');
    });

    it('纯时间格式推进 (08:00 + 60m / 23:30 + 60m 跨天)', () => {
      const r1 = advanceCalendar('08:00', 60, 0);
      expect(r1.newDate).toBe('09:00');
      expect(r1.dayCountDelta).toBe(0);

      const r2 = advanceCalendar('23:30', 60, 5);
      expect(r2.newDate).toBe('00:30');
      expect(r2.dayCountDelta).toBe(1);
      expect(r2.newDayCount).toBe(6);
    });

    it('纯文本架空日期无时钟 (秋·九月十七 + 2880m)', () => {
      const res = advanceCalendar('秋·九月十七', 2880, 47);
      expect(res.newDate).toBe('秋·九月十七');
      expect(res.dayCountDelta).toBe(2);
      expect(res.newDayCount).toBe(49);
    });

    it('纯文本“第N天”无时钟 (第47天 + 1440m 推进为第48天)', () => {
      const res = advanceCalendar('第47天', 1440, 47);
      expect(res.newDate).toBe('第48天');
      expect(res.dayCountDelta).toBe(1);
      expect(res.newDayCount).toBe(48);
    });

    it('appendTimeIfMissing 选项对纯日期生效', () => {
      const res = advanceCalendar('2026-09-18', 120, 0, {
        appendTimeIfMissing: true,
        defaultStartTime: '08:00',
      });
      expect(res.newDate).toBe('2026-09-18 10:00');
      expect(res.timeStr).toBe('10:00');
      expect(res.dayCountDelta).toBe(0);
    });

    it('空日期与非法 deltaMinutes 边界防御', () => {
      const r1 = advanceCalendar('', 60, 2);
      expect(r1.newDate).toBe('');
      expect(r1.dayCountDelta).toBe(0);
      expect(r1.newDayCount).toBe(2);

      const r2 = advanceCalendar('2026-09-18 08:00', -60, 2);
      expect(r2.newDate).toBe('2026-09-18 08:00');
      expect(r2.dayCountDelta).toBe(0);
      expect(r2.newDayCount).toBe(2);
    });
  });

  describe('5. 时间格式化工具（formatTimePast）', () => {
    it('应将整型分钟数格式化为标准标签', () => {
      expect(formatTimePast(480)).toBe('<timePast>0 D 8 H 0 M</timePast>');
      expect(formatTimePast(1590)).toBe('<timePast>1 D 2 H 30 M</timePast>');
      expect(formatTimePast(0)).toBe('<timePast>0 D 0 H 0 M</timePast>');
    });

    it('负数应安全截断为 0', () => {
      expect(formatTimePast(-100)).toBe('<timePast>0 D 0 H 0 M</timePast>');
    });
  });

  describe('6. BUG-LIVE-23a（#70楼 Swipe 1 实机复现）：<time_Anchor> 内联 timePast: 属性提取', () => {
    it('无独立 <timePast> 标签时，应从 <time_Anchor> 内联 timePast:2 D 提取 Δt=2880 分钟（忽略 <think> 内伪标签）', () => {
      const raw70 = `<think>
<time_Anchor>date:2078-01-29 time:20:00:00 time_zone:UTC-8 timePast:99 D</time_Anchor>
</think>
<正文>
<time_Anchor>date:2078-01-29 time:20:00:00 time_zone:UTC-8 timePast:2 D</time_Anchor>
铁砧重矿前哨分基地的装甲车间轰鸣运转，2辆犀牛主战坦克与10名动员兵整装待发。
</正文>`;
      const res = parseTimePast(raw70);
      expect(res.success).toBe(true);
      expect(res.isFallback).toBe(false);
      expect(res.rawText).toBe('2 D');
      expect(res.deltaMinutes).toBe(2880);
      expect(res.days).toBe(2);
      expect(res.hours).toBe(0);
      expect(res.minutes).toBe(0);
    });

    it('支持 <time_Anchor> 内联 timePast 后紧跟其他 key:value 属性或分隔符', () => {
      const raw = '<time_Anchor>date:2078-01-29 timePast: 1 D 6 H 30 M weather:晴</time_Anchor>';
      const res = parseTimePast(raw);
      expect(res.success).toBe(true);
      expect(res.rawText).toBe('1 D 6 H 30 M');
      expect(res.deltaMinutes).toBe(1440 + 360 + 30);
    });
  });
});

