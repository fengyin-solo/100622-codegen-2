<template>
  <section class="page" data-module="perimeter">
    <header class="page-head">
      <div>
        <h2>周界安防管理</h2>
        <p class="page-desc">{{ meta.desc }}</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="backfill">历史数据回填</button>
        <button class="btn" type="button" @click="exportRows">导出周界安防清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <h3 class="section-title">摄像机点位台账（离线原因在告警进入待确认之前公示）</h3>
    <table class="data-table">
      <thead>
        <tr><th>点位名称</th><th>摄像机状态</th><th>离线原因</th></tr>
      </thead>
      <tbody>
        <tr v-for="camera in cameras" :key="camera.点位名称">
          <td>{{ camera.点位名称 }}</td>
          <td>{{ camera.摄像机状态 }}</td>
          <td>{{ camera.离线原因 || '—' }}</td>
        </tr>
      </tbody>
    </table>

    <form class="filter-bar" @submit.prevent="report">
      <label class="filter-item">
        <span>触发点位</span>
        <select v-model="reportForm.点位名称">
          <option v-for="camera in cameras" :key="camera.点位名称" :value="camera.点位名称">
            {{ camera.点位名称 }}
          </option>
        </select>
      </label>
      <label class="filter-item">
        <span>报送批次号</span>
        <input v-model="reportForm.批次号" placeholder="同一份数据按批次号只算一次" />
      </label>
      <button class="btn primary" type="submit">报送入侵告警</button>
      <button class="btn ghost" type="button" @click="regenerateBatch">换一批次号</button>
    </form>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="String(row.id)"
          :class="{ 'selected-row': selected && Number(selected.id) === Number(row.id) }"
          @click="selectRow(row)"
        >
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions" @click.stop>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">
            本班组暂无周界入侵告警，可在上方报送
          </td>
        </tr>
      </tbody>
    </table>

    <section v-if="selected" class="detail-panel">
      <h3>告警详情：{{ selected['告警编号'] }}（{{ selected.status }}）</h3>
      <dl class="detail-grid">
        <template v-for="field in detailFields" :key="field">
          <dt>{{ field }}</dt>
          <dd>{{ selected[field] || '—' }}</dd>
        </template>
      </dl>
      <p v-if="selected['回填说明']" class="backfill-note">{{ selected['回填说明'] }}</p>
      <h4>触发轨迹</h4>
      <ul class="detail-log">
        <li v-for="(line, i) in splitLog(selected['触发轨迹'])" :key="i">{{ line }}</li>
      </ul>
      <h4>流转记录（每次变更带操作岗位与时间）</h4>
      <ul class="detail-log">
        <li v-for="(line, i) in splitLog(selected['流转记录'])" :key="i">{{ line }}</li>
      </ul>
      <label class="filter-item conclusion-item">
        <span>处理结论（现场复核时写入，并回写隐患清单）</span>
        <input v-model="conclusion" placeholder="现场核查结论" />
      </label>
      <div class="row-actions">
        <button
          v-for="action in actions"
          :key="action"
          class="btn"
          type="button"
          @click="runAction(action, selected)"
        >
          {{ action }}
        </button>
      </div>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条入侵告警记录（仅显示{{ store.team }}的记录）</span>
      <span v-if="message" class="ok-text">{{ message }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import {
  backfillPerimeterHistory,
  downloadEntries,
  listEntries,
  moduleMeta,
  reportPerimeterAlarm,
  runAction as applyAction,
  type OperatorContext,
} from '@/api/local-service'
import { PERIMETER_CAMERAS } from '@/data/perimeter'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('perimeter')
const store = useSessionStore()
const columns = meta.fields
const actions = meta.actions
const statuses = meta.statuses
const cameras = PERIMETER_CAMERAS
const detailFields = [...meta.fields, '最后操作岗位', '最后操作时间', '批次号']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const message = ref('')
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const selectedId = ref<number | null>(null)
const conclusion = ref('')
const reportForm = ref({ 点位名称: cameras[0].点位名称, 批次号: '' })

const operator = computed<OperatorContext>(() => ({
  name: store.operator,
  role: store.role,
  team: store.team,
  nightWatch: store.nightWatch,
}))

// 详情面板直接取列表里的同一条记录，两边的取值一定对得上。
const selected = computed(() =>
  selectedId.value === null
    ? null
    : (rows.value.find((row) => Number(row.id) === selectedId.value) ?? null),
)

const stats = computed(() => [
  { label: '待确认告警', value: rows.value.filter((row) => row.status === '待确认').length },
  { label: '出警中告警', value: rows.value.filter((row) => row.status === '已出警').length },
  { label: '已归档告警', value: rows.value.filter((row) => row.status === '已归档').length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function splitLog(log: unknown): string[] {
  return String(log ?? '')
    .split('；')
    .map((line) => line.trim())
    .filter(Boolean)
}

function selectRow(row: EntryRow) {
  selectedId.value = Number(row.id)
  conclusion.value = String(row['处理结论'] ?? '')
}

function regenerateBatch() {
  reportForm.value.批次号 = `RPT-${Date.now()}`
}

function report() {
  message.value = ''
  errorMessage.value = ''
  const result = reportPerimeterAlarm(
    { 点位名称: reportForm.value.点位名称, 批次号: reportForm.value.批次号 },
    operator.value,
  )
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  message.value = result.message
  regenerateBatch()
  reload()
}

function backfill() {
  message.value = ''
  errorMessage.value = ''
  const result = backfillPerimeterHistory(operator.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  message.value = result.message
  reload()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  message.value = ''
  errorMessage.value = ''
  const extra: Record<string, string> = action === '现场复核' ? { 处理结论: conclusion.value } : {}
  const result = applyAction(meta.key, Number(row.id), action, operator.value, extra)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  message.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value, operator.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '周界安防列表读取失败'
  }
}

watch(() => store.team, reload)

onMounted(() => {
  regenerateBatch()
  reload()
})
</script>
