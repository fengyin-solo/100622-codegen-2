<template>
  <section class="page" data-module="patrol">
    <header class="page-head">
      <div>
        <h2>现场巡视隐患清单</h2>
        <p class="page-desc">
          这里只读周界安防的权威结论（{{ authority }}），周界告警复核归档后把出警结论回写到本清单，不在此面板直接改。
          仅显示本班组（{{ session.crew }}）的周界隐患。
        </p>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card"><span class="stat-label">本班组周界隐患</span><strong class="stat-value">{{ hazards.length }}</strong></article>
      <article class="stat-card"><span class="stat-label">有处置结论</span><strong class="stat-value">{{ valid.length }}</strong></article>
      <article class="stat-card"><span class="stat-label">历史回填缺字段</span><strong class="stat-value">{{ legacyItems.length }}</strong></article>
    </div>

    <table class="data-table">
      <thead>
        <tr><th>隐患编号</th><th>来源告警单</th><th>点位 / 摄像机</th><th>发现时间</th><th>周界处置结论</th><th>归档时间</th><th>备注</th></tr>
      </thead>
      <tbody>
        <tr v-for="h in hazards" :key="h.hazardNo" :class="{ legacy: h.legacy }">
          <td>{{ h.hazardNo }}</td>
          <td>{{ h.sourceAlarmNo }}</td>
          <td>{{ h.pointName }}<br /><small>{{ h.cameraName }}</small></td>
          <td>{{ h.foundTime }}</td>
          <td>{{ h.conclusion || '—（无回写结论）' }}</td>
          <td>{{ h.archivedTime }}</td>
          <td>
            <span v-if="h.legacy" class="tag legacy">早期缺字段·另列说明</span>
            <span v-else>来自周界面板，只读</span>
            <div v-if="h.note" class="flow-note">{{ h.note }}</div>
          </td>
        </tr>
        <tr v-if="!hazards.length">
          <td colspan="7" class="empty-state">本班组暂无从周界告警回写的隐患，或当前班组无权查看其他班组记录</td>
        </tr>
      </tbody>
    </table>

    <div v-if="legacyNotes.length" class="legacy-block">
      <h3>早期历史回填缺字段说明（另列一行）</h3>
      <ul>
        <li v-for="n in legacyNotes" :key="n.alarmNo">
          <strong>{{ n.alarmNo }}</strong> · 登记时间 {{ n.registeredTime }} · 缺字段：{{ n.missingFields.join('、') }}
          <div class="flow-note">{{ n.note }}</div>
        </li>
      </ul>
    </div>

    <footer class="page-foot">
      <span>本入口只读，周界隐患的处置与状态请在「周界入侵告警」面板完成</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { useSessionStore } from '@/stores/session'
import { authorityVersion, listHazards, listLegacyNotes } from '@/api/perimeter-service'
import type { HazardItem, LegacyNote } from '@/data/intrusion/types'

const session = useSessionStore()
const authority = authorityVersion()
const hazards = ref<HazardItem[]>([])
const legacyNotes = ref<LegacyNote[]>([])
const valid = computed(() => hazards.value.filter((h) => !h.legacy && h.conclusion))
const legacyItems = computed(() => hazards.value.filter((h) => h.legacy))

function reload() {
  hazards.value = listHazards(session.crew)
  legacyNotes.value = listLegacyNotes()
}

onMounted(reload)
</script>
