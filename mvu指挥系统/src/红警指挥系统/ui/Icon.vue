<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.2"
    stroke-linecap="square"
    stroke-linejoin="miter"
    class="inline-block align-[-2px]"
    aria-hidden="true"
    focusable="false"
  >
    <!-- 资金：菱形币 -->
    <template v-if="name === 'credits'">
      <path d="M8 1.5 14.5 8 8 14.5 1.5 8Z" />
      <path d="M5.5 8h5M8 5.5v5" />
    </template>
    <!-- 电力：闪电 -->
    <template v-else-if="name === 'power'">
      <path d="M9 1.5 3.5 9H7.5L7 14.5 12.5 7H8.5Z" />
    </template>
    <!-- 暴露度：眼 -->
    <template v-else-if="name === 'eye'">
      <path d="M1.5 8C3.5 4.7 5.7 3 8 3s4.5 1.7 6.5 5c-2 3.3-4.2 5-6.5 5S3.5 11.3 1.5 8Z" />
      <circle cx="8" cy="8" r="2" />
    </template>
    <!-- 警报：三角叹号 -->
    <template v-else-if="name === 'alert'">
      <path d="M8 2 15 13.5H1Z" />
      <path d="M8 6.5v3.5M8 11.8v.4" />
    </template>
    <!-- 日期：方框日历 -->
    <template v-else-if="name === 'calendar'">
      <rect x="2" y="3" width="12" height="11" />
      <path d="M2 6.5h12M5 1.5v3M11 1.5v3" />
    </template>
    <!-- 置顶：图钉 -->
    <template v-else-if="name === 'pin'">
      <path d="M6 2h4v5l2 2v1H4V9l2-2Z" />
      <path d="M8 10v4" />
    </template>
    <!-- 归档：盒 -->
    <template v-else-if="name === 'archive'">
      <rect x="2" y="2.5" width="12" height="3.5" />
      <path d="M3.5 6v7.5h9V6M6.5 9h3" />
    </template>
    <!-- 建造：锤 -->
    <template v-else-if="name === 'hammer'">
      <path d="M2.5 5.5 5 3h4l2.5 2.5v2H9L4.5 12 2.5 10 7 5.5H2.5Z" transform="translate(1 1)" />
    </template>
    <!-- 研究：烧瓶 -->
    <template v-else-if="name === 'flask'">
      <path d="M6.5 1.5h3M7 1.5v4L3 13a1 1 0 0 0 .9 1.5h8.2A1 1 0 0 0 13 13L9 5.5v-4" />
      <path d="M5 10.5h6" />
    </template>
    <!-- 生产：齿轮 -->
    <template v-else-if="name === 'gear'">
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 2v2M8 12v2M2 8h2M12 8h2M3.8 3.8l1.4 1.4M10.8 10.8l1.4 1.4M12.2 3.8l-1.4 1.4M5.2 10.8l-1.4 1.4" />
    </template>
    <!-- 跳过时间：时钟 -->
    <template v-else-if="name === 'clock'">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </template>
    <!-- 发送：箭头 -->
    <template v-else-if="name === 'send'">
      <path d="M2 8h11M9.5 4.5 13.5 8l-4 3.5" />
    </template>
    <!-- 完成：勾 -->
    <template v-else-if="name === 'check'">
      <path d="M3 8.5 6.5 12 13 4.5" />
    </template>
    <!-- 锁定：锁 -->
    <template v-else-if="name === 'lock'">
      <rect x="3.5" y="7" width="9" height="7" />
      <path d="M5.5 7V4.5a2.5 2.5 0 0 1 5 0V7" />
    </template>
    <!-- 方向与展开：统一使用克制的折线 SVG -->
    <template v-else-if="name === 'chevron-left'">
      <path d="M10.5 3.5 6 8l4.5 4.5" />
    </template>
    <template v-else-if="name === 'chevron-right'">
      <path d="M5.5 3.5 10 8l-4.5 4.5" />
    </template>
    <template v-else-if="name === 'chevron-down'">
      <path d="m3.5 5.5 4.5 4.5 4.5-4.5" />
    </template>
    <template v-else-if="name === 'chevron-up'">
      <path d="M3.5 10.5 8 6l4.5 4.5" />
    </template>
    <!-- 状态点 -->
    <template v-else-if="name === 'status'">
      <circle cx="8" cy="8" r="3" fill="currentColor" stroke="none" />
    </template>
    <!-- 六面板导航图标 -->
    <template v-else-if="name === 'base'">
      <path d="M2 14V6.5L8 2l6 4.5V14M5 14V9h6v5M1.5 14h13" />
    </template>
    <template v-else-if="name === 'tech'">
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" />
    </template>
    <template v-else-if="name === 'forces'">
      <path d="M8 1.5 13 4v3.5c0 3.2-2 5.6-5 7-3-1.4-5-3.8-5-7V4Z" />
      <path d="M5.5 8h5M8 5.5v5" />
    </template>
    <!-- 防御：盾（区别于 forces 的盾+十字医疗语义） -->
    <template v-else-if="name === 'shield'">
      <path d="M8 1.5 14 3.5V8c0 3.6-2.6 5.7-6 6.5C4.6 13.7 2 11.6 2 8V3.5Z" />
    </template>
    <!-- 巨构：六面巨塔 -->
    <template v-else-if="name === 'mega'">
      <path d="M8 1.5 13.5 4.5v7L8 14.5 2.5 11.5v-7Z" />
      <path d="M8 5.5v5M6 6.8 8 5.5l2 1.3" />
    </template>
    <!-- 全部：四格 -->
    <template v-else-if="name === 'grid'">
      <rect x="2" y="2" width="5" height="5" />
      <rect x="9" y="2" width="5" height="5" />
      <rect x="2" y="9" width="5" height="5" />
      <rect x="9" y="9" width="5" height="5" />
    </template>
    <!-- 其他：省略号 -->
    <template v-else-if="name === 'dots'">
      <circle cx="3.5" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r="1.1" fill="currentColor" stroke="none" />
    </template>
    <!-- 公共设施：柱廊 -->
    <template v-else-if="name === 'civic'">
      <path d="M2.5 5 8 1.8 13.5 5M2.5 5h11" />
      <path d="M4 5v7.5M8 5v7.5M12 5v7.5M2.5 14h11" />
    </template>
    <!-- 战略超武：辐射三叶 -->
    <template v-else-if="name === 'nuke'">
      <circle cx="8" cy="8" r="1.6" />
      <path d="M8 6.4V2M9.4 8.8l3.8 2.2M6.6 8.8l-3.8 2.2" />
    </template>
    <!-- 航天工业：火箭 -->
    <template v-else-if="name === 'rocket'">
      <path d="M8 1.5c2.2 1.7 3.2 4.3 3.2 6.8L9.4 10H6.6l-1.8-1.7c0-2.5 1-5.1 3.2-6.8Z" />
      <circle cx="8" cy="5.8" r="1.1" />
      <path d="M6.6 10 5 13.5M9.4 10l1.6 3.5M8 10v3" />
    </template>
    <!-- 海军：锚 -->
    <template v-else-if="name === 'anchor'">
      <circle cx="8" cy="3" r="1.5" />
      <path d="M8 4.5V14M4.5 7h7M3 11.5c.6 1.8 2.4 2.8 5 2.8s4.4-1 5-2.8" />
    </template>
    <!-- 陆军：人形步兵 -->
    <template v-else-if="name === 'infantry'">
      <circle cx="8" cy="4.2" r="2.2" />
      <path d="M3.5 14c.5-3.5 2.2-5 4.5-5s4 1.5 4.5 5" />
    </template>
    <!-- 空军：喷气式飞机（俯视） -->
    <template v-else-if="name === 'plane'">
      <path d="M8 1.8c.9 1 1.3 2.8 1.3 4.4l4.2 2.8v1.4l-4.2-1.3-.1 2.4 1.9 1.4v1l-3.1-.9-3.1.9v-1l1.9-1.4-.1-2.4-4.2 1.3V9l4.2-2.8c0-1.6.4-3.4 1.3-4.4Z" />
    </template>
    <template v-else-if="name === 'factions'">
      <circle cx="5" cy="5" r="2" />
      <circle cx="11.5" cy="6" r="1.5" />
      <path d="M1.8 13c.3-3 1.5-4.5 3.7-4.5S9 10 9.3 13M9.2 13c.2-2.2 1.1-3.3 2.8-3.3s2.5 1.1 2.7 3.3" />
    </template>
    <template v-else-if="name === 'intel'">
      <path d="M2 12.5V3.5h12v9Z" />
      <path d="M4.5 6h7M4.5 8.5h4.5M4.5 11h6" />
    </template>
    <template v-else-if="name === 'quest'">
      <path d="M3 2.5h10v11H3Z" />
      <path d="m5 6 1 1 2-2M9.5 6h1.5M5 10h6" />
    </template>
    <template v-else-if="name === 'signal'">
      <path d="M2 12.5h2v2H2ZM6 9h2v5.5H6ZM10 5.5h2v9h-2ZM14 2v12.5" />
    </template>
    <template v-else-if="name === 'location'">
      <path d="M13 6.5c0 3.2-5 8-5 8s-5-4.8-5-8a5 5 0 0 1 10 0Z" />
      <circle cx="8" cy="6.5" r="1.5" />
    </template>
    <!-- 装备：子弹（弹头 + 弹壳收腰） -->
    <template v-else-if="name === 'ammo'">
      <path d="M6 6.5V4.5C6 3 6.8 1.9 8 1.5 9.2 1.9 10 3 10 4.5v2" />
      <path d="M6 6.5h4V14H6Z" />
      <path d="M6 9.5h4" />
    </template>
    <template v-else-if="name === 'close'">
      <path d="m3.5 3.5 9 9M12.5 3.5l-9 9" />
    </template>
    <!-- 调试/DEV：甲虫 -->
    <template v-else-if="name === 'bug'">
      <rect x="5" y="5" width="6" height="7" rx="3" />
      <path d="M6.5 5V3.5h3V5M2.5 6.5h2.5M11 6.5h2.5M2 9h3M11 9h3M2.5 11.5h2.5M11 11.5h2.5M8 5v7" />
    </template>
    <!-- 终端/PDA：手持板 -->
    <template v-else-if="name === 'pda'">
      <rect x="3.5" y="1.5" width="9" height="13" />
      <path d="M5.5 4h5v5.5h-5ZM7 12h2" />
    </template>
    <!-- 收藏：五角星 -->
    <template v-else-if="name === 'star'">
      <path d="M8 1.8 9.9 5.7l4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6Z" />
    </template>
    <!-- 加号/扩建 -->
    <template v-else-if="name === 'plus'">
      <path d="M8 3v10M3 8h10" />
    </template>
    <!-- 减号/缩小 -->
    <template v-else-if="name === 'minus'">
      <path d="M3 8h10" />
    </template>
    <!-- 全屏/尺寸切换 -->
    <template v-else-if="name === 'expand'">
      <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
    </template>
    <!-- 文档/查阅档案 -->
    <template v-else-if="name === 'doc'">
      <path d="M3.5 1.5h6l3 3v10h-9Z" />
      <path d="M9.5 1.5v3h3M5.5 7.5h5M5.5 10h5M5.5 12.5h3.5" />
    </template>
    <!-- 图鉴/手册 -->
    <template v-else-if="name === 'book'">
      <path d="M2 3h5.2c.5 0 .8.4.8.9V13c0-.5-.3-.8-.8-.8H2ZM14 3H8.8c-.5 0-.8.4-.8.9V13c0-.5.3-.8.8-.8H14Z" />
    </template>
    <!-- 扳手/编辑工程 -->
    <template v-else-if="name === 'wrench'">
      <path d="M10.2 2.2a3.5 3.5 0 0 0-3.1 5.1L2.5 11.9 4.1 13.5 8.7 8.9a3.5 3.5 0 0 0 5.1-3.1l-2.1 2.1-1.6-.4-.4-1.6Z" />
    </template>
    <!-- 双箭头切换 -->
    <template v-else-if="name === 'swap'">
      <path d="M2.5 5.5h10M10 3l2.5 2.5L10 8M13.5 10.5h-10M6 8l-2.5 2.5L6 13" />
    </template>
    <!-- 罗盘/三环沙盘 -->
    <template v-else-if="name === 'compass'">
      <circle cx="8" cy="8" r="6" />
      <path d="m10.5 5.5-1.5 4-3.5 1 1.5-4Z" />
    </template>
    <!-- 插头/负载 -->
    <template v-else-if="name === 'plug'">
      <path d="M6 2v3.5M10 2v3.5M4 5.5h8v3a4 4 0 0 1-4 4v2M4 8.5h8" />
    </template>
    <!-- 图层/分支 -->
    <template v-else-if="name === 'layers'">
      <path d="M8 2 14 5 8 8 2 5Z" />
      <path d="m2 8 6 3 6-3M2 11l6 3 6-3" />
    </template>
    <!-- 白昼 -->
    <template v-else-if="name === 'sun'">
      <circle cx="8" cy="8" r="2.8" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" />
    </template>
    <!-- 夜间 -->
    <template v-else-if="name === 'moon'">
      <path d="M12.8 10.2A5.5 5.5 0 0 1 5.8 3.2a5.5 5.5 0 1 0 7 7Z" />
    </template>
    <!-- 天气/云 -->
    <template v-else-if="name === 'weather'">
      <path d="M4.8 12.5h6.7a2.8 2.8 0 0 0 .3-5.6A4.2 4.2 0 0 0 3.7 5.8 3.3 3.3 0 0 0 4.8 12.5Z" />
    </template>
    <!-- 地球/经纬线 -->
    <template v-else-if="name === 'globe'">
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c1.8 1.8 2.6 3.8 2.6 6S9.8 12.2 8 14c-1.8-1.8-2.6-3.8-2.6-6S6.2 3.8 8 2Z" />
    </template>
    <!-- 刷新：战术双弧旋转箭头 -->
    <template v-else-if="name === 'refresh'">
      <path d="M13.5 8a5.5 5.5 0 0 1-9.3 3.9M2.5 8a5.5 5.5 0 0 1 9.3-3.9" />
      <path d="M11.8 1.8v2.6H9.2M4.2 14.2v-2.6h2.6" />
    </template>
  </svg>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    name:
      | 'credits'
      | 'power'
      | 'eye'
      | 'alert'
      | 'calendar'
      | 'pin'
      | 'archive'
      | 'hammer'
      | 'flask'
      | 'gear'
      | 'clock'
      | 'send'
      | 'check'
      | 'lock'
      | 'chevron-left'
      | 'chevron-right'
      | 'chevron-down'
      | 'chevron-up'
      | 'status'
      | 'base'
      | 'tech'
      | 'forces'
      | 'shield'
      | 'mega'
      | 'grid'
      | 'dots'
      | 'civic'
      | 'nuke'
      | 'rocket'
      | 'anchor'
      | 'infantry'
      | 'plane'
      | 'factions'
      | 'intel'
      | 'quest'
      | 'signal'
      | 'location'
      | 'ammo'
      | 'close'
      | 'bug'
      | 'pda'
      | 'star'
      | 'plus'
      | 'minus'
      | 'expand'
      | 'doc'
      | 'book'
      | 'wrench'
      | 'swap'
      | 'compass'
      | 'plug'
      | 'layers'
      | 'sun'
      | 'moon'
      | 'weather'
      | 'globe'
      | 'refresh';
    size?: number;
  }>(),
  { size: 13 },
);
</script>
