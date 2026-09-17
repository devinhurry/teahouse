<script setup lang="ts">
import type { ScreenRecord } from '../../../shared/remote-view'
import { screenDuration, screenRecordText } from '../../../i18n/messages'
import { tr } from '../utils/i18n'
import { separatorTime } from '../utils/time'
import PantryIcon from './PantryIcon.vue'
defineProps<{ record: ScreenRecord }>()
function time(ts: number): string { return `${separatorTime(ts)}:${String(new Date(ts).getSeconds()).padStart(2, '0')}` }
</script>

<template>
  <article class="screen-card" :class="{ active: record.phase === 'active' }" :aria-label="tr('屏幕协助记录')">
    <header><PantryIcon name="screen" :size="18" /><strong>{{ tr('屏幕协助') }}</strong><span>{{ tr('仅查看') }}</span></header>
    <p class="direction">{{ record.role === 'viewer' ? tr('你请求查看对方屏幕') : tr('对方请求查看你的屏幕') }}</p>
    <p class="outcome" aria-live="polite"><strong>{{ screenRecordText(record, tr) }}</strong></p>
    <dl>
      <div><dt>{{ tr('请求时间') }}</dt><dd>{{ time(record.requestedAt) }}</dd></div>
      <div v-if="record.startedAt !== undefined"><dt>{{ tr('开始时间') }}</dt><dd>{{ time(record.startedAt) }}</dd></div>
      <div v-if="record.phase === 'ended'"><dt>{{ tr('结束时间') }}</dt><dd>{{ record.endedAt ? time(record.endedAt) : tr('未知') }}</dd></div>
      <div v-if="record.startedAt !== undefined && record.phase === 'ended'"><dt>{{ tr('持续时间') }}</dt><dd>{{ record.durationMs === undefined ? tr('未知') : screenDuration(record.durationMs) }}</dd></div>
    </dl>
  </article>
</template>

<style scoped>
.screen-card { width: min(340px, 100%); margin: 10px auto; padding: 12px 14px; border: 1px solid var(--line); border-radius: var(--radius-panel); color: var(--text-1); background: var(--bg-window); font-size: var(--font-sm); }
header { display: flex; align-items: center; gap: 8px; }
header span { margin-left: auto; }
p { margin: 6px 0 0; line-height: 1.6; }
header span, .direction, dl { font-size: var(--font-xs); }
header span, .direction, dt { color: var(--text-2); }
dl { border-top: 1px solid var(--line); padding-top: 8px; margin: 10px 0 0; }
dl div { display: flex; justify-content: space-between; gap: 16px; line-height: 1.8; }
dd { margin: 0; text-align: right; }
</style>
