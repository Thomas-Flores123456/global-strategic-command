import { describe, expect, it } from 'vitest';
import { indexFloorProtocols } from '../parse/floorProtocolIndex';
import { stripThinking } from '../parse/floorSanitize';

describe('统一楼层协议块索引', () => {
  it('交错思考伪标签不入索引，载荷位置保持为原文位置', () => {
    const raw = '<Interleaving>\n<thinking>\n<摘要>错误</摘要>\n计划 `<timePast>`\n</thinking>\n<正文>第一段</正文>\n</thinking>\n<thinking>\n<事件>错误</事件>\n</thinking>\n<正文>第二段</正文>\n</Interleaving>\n<摘要>纪要: 真实</摘要>\n<timePast>30 M</timePast>\n<态势>天气: 沙尘暴</态势>\n<事件>类型: 目视</事件>';
    const blocks = indexFloorProtocols(raw);
    expect(blocks.map(b => b.tag)).toEqual(['摘要', 'timepast', '态势', '事件']);
    expect(blocks.every(b => b.status === 'valid')).toBe(true);
    for (const b of blocks) expect(raw.slice(b.contentStart, b.contentEnd).trim()).toBe(b.payload);
    expect(blocks[0].start).toBe(raw.indexOf('<摘要>纪要'));
    expect(stripThinking(raw, true).text.length).toBe(raw.length);
  });
  it('句中伪标签不能抢占后续真实块', () => {
    const blocks = indexFloorProtocols('说明 `<摘要>` 然后输出\n<摘要>真实</摘要>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].payload).toBe('真实');
  });
  it('完整正文容器中的协议示例不生效', () => {
    expect(indexFloorProtocols('<正文>\n<timePast>99 D</timePast>\n</正文>\n<timePast>30 M</timePast>').map(b => b.payload)).toEqual(['30 M']);
  });
  it('无效块保留序号且不暴露可被误用的载荷', () => {
    const blocks = indexFloorProtocols('<事件>损坏\n<事件>有效</事件>');
    expect(blocks.map(b => [b.ordinal, b.status, b.payload])).toEqual([[0, 'boundary-crossing', ''], [1, 'valid', '有效']]);
  });
  it('不跨思考或正文闭标签拼接块', () => {
    const blocks = indexFloorProtocols('<摘要>草稿\n</thinking>\n<正文>故事</正文>\n<摘要>真实</摘要>');
    expect(blocks.filter(b => b.status === 'valid').map(b => b.payload)).toEqual(['真实']);
  });
  it('大小写、全角标签与摘要属性兼容，不跨调用保留状态', () => {
    const blocks = indexFloorProtocols('＜中摘要 from="1" to="3"＞卷宗＜/中摘要＞\n<TIMEPAST>30 M</TIMEPAST>');
    expect(blocks.map(b => b.payload)).toEqual(['卷宗', '30 M']);
    expect(blocks[0].openTag).toContain('from="1"');
    expect(indexFloorProtocols('<事件>另一楼</事件>')[0].ordinal).toBe(0);
  });
});
