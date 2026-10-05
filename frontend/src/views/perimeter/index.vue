<template>
  <section class="page" data-module="perimeter">
    <header class="page-head">
      <div>
        <h2>周界入侵告警处置</h2>
        <p class="page-desc">
          处置链只能向前：待确认 → 已出警 → 已复核（归档）。只有值班长能推进出警与复核，夜间无人值守时段非当班一律拒绝。
          权威版本：{{ authority }}，其他入口只读这一份结论。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="resetData">恢复演示数据</button>
      </div>
    </header>

    <p class="status-legend">
      <span class="legend-item">当前操作岗位：{{ session.post }} · {{ session.operator }}（{{ session.crew }}）</span>
      <span class="legend-item" :class="{ night: session.isNight }">
        {{ session.isNight ? '夜间无人值守时段 22:00-06:00' : '白天值守时段' }}
      </span>
      <span class="legend-item">{{ session.onDuty ? '本班当班' : '非本班当班' }}</span>
      <span class="legend-item">当前时刻：{{ session.clockText }}</span>
    </p>

    <div class="stat-row">
      <article class="stat-card"><span class="stat-label">待确认</span><strong class="stat-value">{{ counts.待确认 }}</strong></article>
      <article class="stat-card"><span class="stat-label">已出警</span><strong class="stat-value">{{ counts.已出警 }}</strong></article>
      <article class="stat-card"><span class="stat-label">已复核（已归档）</span><strong class="stat-value">{{ counts.已复核 }}</strong></article>
      <article class="stat-card"><span class="stat-label">离线待确认</span><strong class="stat-value">{{ counts.离线待确认 }}</strong></article>
    </div>

    <div class="peri-layout">
      <!-- 左：工单列表 -->
      <div class="peri-list">
        <form class="filter-bar" @submit.prevent="applyFilter">
          <label class="filter-item">
            <span>按点位 / 单号检索</span>
            <input v-model="keyword" placeholder="点位名称或告警单号" />
          </label>
          <label class="filter-item">
            <span>状态</span>
            <select v-model="statusFilter">
              <option value="">全部</option>
              <option v-for="s in STATUSES" :key="s" :value="s">{{ s }}</option>
            </select>
          </label>
          <button class="btn" type="submit">查询</button>
        </form>

        <table class="data-table">
          <thead>
            <tr><th>告警单号</th><th>点位 / 摄像机</th><th>首次触发</th><th>状态</th></tr>
          </thead>
          <tbody>
            <tr
              v-for="row in filteredRows"
              :key="row.id"
              :class="{ active: selectedId === row.id, offline: row.cameraOffline }"
              @click="select(row.id)"
            >
              <td>
                {{ row.alarmNo }}
                <span v-if="row.legacy" class="tag legacy">历史缺字段</span>
                <span v-if="row.cameraOffline" class="tag offline-tag">摄像机离线</span>
              </td>
              <td>{{ row.pointName }}<br /><small>{{ row.cameraName }}</small></td>
              <td>{{ row.firstTriggerTime }}</td>
              <td><span :class="['status-dot', row.status]">{{ row.status }}</span></td>
            </tr>
            <tr v-if="!filteredRows.length">
              <td colspan="4" class="empty-state">本班组暂无可见工单（只看得到属于自己班组的记录）</td>
            </tr>
          </tbody>
        </table>

        <form class="report-box" @submit.prevent="submitReport">
          <h3>摄像机触发上报</h3>
          <label class="filter-item">
            <span>摄像机点位</span>
            <select v-model="report.cameraId">
              <option v-for="cam in cameras" :key="cam.id" :value="cam.id">
                {{ cam.name }}{{ cam.online ? '' : '（离线：' + cam.offlineReason + '）' }}
              </option>
            </select>
          </label>
          <label class="filter-item">
            <span>上报报文号（重复报文号直接退回）</span>
            <input v-model="report.reportId" placeholder="如 RPT-1005-090000-01" />
          </label>
          <label class="filter-item">
            <span>触发类型</span>
            <input v-model="report.kind" placeholder="翻越围栏 / 人员闯入" />
          </label>
          <label class="filter-item">
            <span>触发时间</span>
            <input v-model="report.time" placeholder="YYYY-MM-DD HH:mm:ss" />
          </label>
          <button class="btn primary" type="submit">上报建单</button>
        </form>
      </div>

      <!-- 右：详情 + 处置动作。列表与详情取同一份 rows，保证取值对得上。 -->
      <div class="peri-detail">
        <div v-if="!selected" class="empty-state detail-empty">从左侧选择一条工单查看处置链</div>
        <template v-else>
          <div class="detail-head">
            <h3>{{ selected.alarmNo }}</h3>
            <div>
              <span v-if="selected.legacy" class="tag legacy">历史回填·字段缺失</span>
              <span v-if="selected.cameraOffline" class="tag offline-tag">摄像机离线</span>
              <span :class="['status-dot', selected.status]">{{ selected.status }}{{ selected.archived ? '·已归档' : '' }}</span>
            </div>
          </div>

          <dl class="detail-grid">
            <dt>点位</dt><dd>{{ selected.pointName }}</dd>
            <dt>摄像机</dt><dd>{{ selected.cameraName }}（{{ selected.cameraId }}）</dd>
            <dt>所属班组</dt><dd>{{ selected.owningCrew }}</dd>
            <dt>首次触发 / 建单</dt><dd>{{ selected.firstTriggerTime }}</dd>
            <dt>派警</dt><dd>{{ selected.dispatchActor ? selected.dispatchActor.post + ' ' + selected.dispatchActor.name + ' · ' + selected.dispatchTime : '—' }}</dd>
            <dt>复核归档</dt><dd>{{ selected.reviewActor ? selected.reviewActor.post + ' ' + selected.reviewActor.name + ' · ' + selected.reviewTime : '—' }}</dd>
          </dl>

          <div v-if="selected.cameraOffline" class="offline-banner">
            离线原因（落待确认之前已标注）：{{ selected.offlineReason }}
          </div>

          <div v-if="selected.legacy" class="legacy-banner">
            本条为历史纸质台账按登记时间整体回填，缺失字段：{{ selected.missingFields.join('、') }}。
            无法还原逐档岗位流转，另列说明，不参与出警/复核，也不生成隐患与泄洪待办。
          </div>

          <div class="detail-section">
            <h4>触发轨迹（同点位一分钟内多次触发只追加，不重复建单）</h4>
            <ul class="track-list">
              <li v-for="t in selected.triggers" :key="t.reportId">{{ t.time }} · {{ t.kind }} · {{ t.reportId }}</li>
            </ul>
          </div>

          <div class="detail-section">
            <h4>处置链轨迹（每次状态变更都带操作岗位与时间）</h4>
            <ol class="flow-list">
              <li v-for="(ev, i) in selected.flow" :key="i">
                <strong>{{ ev.time }}</strong> {{ ev.from }} → {{ ev.to }} · {{ ev.action }}
                <div class="flow-actor">操作岗位：{{ ev.actor.post }} {{ ev.actor.name }}（{{ ev.actor.crew }}）</div>
                <div v-if="ev.note" class="flow-note">{{ ev.note }}</div>
              </li>
            </ol>
          </div>

          <div class="detail-section">
            <h4>现场处置结论（回写现场巡视隐患清单）</h4>
            <textarea
              v-model="conclusionDraft"
              rows="3"
              :disabled="!canWriteConclusion"
              placeholder="出警到场后，由现场巡视员回写现场处理结论"
            ></textarea>
            <button class="btn" type="button" :disabled="!canWriteConclusion" @click="doConclusion">回写现场结论</button>
          </div>

          <div class="detail-actions">
            <button
              class="btn primary"
              type="button"
              :disabled="!canDispatch"
              :title="dispatchHint"
              @click="doDispatch"
            >确认有情况 · 推进出警</button>
            <button
              class="btn primary"
              type="button"
              :disabled="!canReview"
              :title="reviewHint"
              @click="doReview"
            >现场处理完 · 复核并归档</button>
          </div>
          <p class="action-hint">{{ dispatchHint }} ｜ {{ reviewHint }}</p>
        </template>

        <p v-if="message" :class="['foot-msg', messageOk ? 'ok-text' : 'error-text']">{{ message }}</p>

        <div v-if="receipts.length" class="detail-section">
          <h4>报送回执（同一份数据重复报送只算一次）</h4>
          <ul class="track-list">
            <li v-for="r in recentReceipts" :key="r.reportId + r.time">
              {{ r.time }} · {{ r.reportId }} ·
              <span :class="r.accepted ? 'ok-text' : 'error-text'">{{ r.accepted ? '已接收' : '已退回' }}</span>
              ：{{ r.reason }}
            </li>
          </ul>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { useSessionStore } from '@/stores/session'
import {
  authorityVersion,
  confirmDispatch,
  getAlarm,
  ingestReport,
  listAlarms,
  listCameras,
  listReceipts,
  resetPerimeterData,
  reviewArchive,
  statusCounts,
  submitConclusion,
} from '@/api/perimeter-service'
import type { IntrusionAlarm, OperateContext, OperateResult, ReportReceipt } from '@/data/intrusion/types'

const STATUSES = ['待确认', '已出警', '已复核']
const session = useSessionStore()
const authority = authorityVersion()
const cameras = listCameras()

const rows = ref<IntrusionAlarm[]>([])
const selectedId = ref<number | null>(null)
const keyword = ref('')
const statusFilter = ref('')
const message = ref('')
const messageOk = ref(false)
const conclusionDraft = ref('')
const receipts = ref<ReportReceipt[]>([])

const report = ref({
  cameraId: cameras[0].id,
  reportId: `RPT-${Date.now()}`,
  kind: '翻越围栏',
  time: session.clockText,
})

const counts = ref({ 待确认: 0, 已出警: 0, 已复核: 0, 离线待确认: 0 })

// 详情直接从同一份 rows 里取，列表与详情取值必然一致。
const selected = computed<IntrusionAlarm | null>(() =>
  selectedId.value === null ? null : rows.value.find((r) => r.id === selectedId.value) ?? null,
)

const filteredRows = computed(() =>
  rows.value.filter((row) => {
    const kw = keyword.value.trim()
    const matchKw = !kw || row.pointName.includes(kw) || row.alarmNo.includes(kw) || row.cameraName.includes(kw)
    const matchStatus = !statusFilter.value || row.status === statusFilter.value
    return matchKw && matchStatus
  }),
)

const recentReceipts = computed(() => receipts.value.slice(0, 5))

function ctx(): OperateContext {
  return { actor: session.actor, isNight: session.isNight, onDuty: session.onDuty }
}

const canDispatch = computed(() => selected.value?.status === '待确认' && !selected.value.legacy)
const canReview = computed(
  () => selected.value?.status === '已出警' && !!selected.value.conclusion.trim() && !selected.value.legacy,
)
const canWriteConclusion = computed(() => selected.value?.status === '已出警' && !selected.value.legacy)

const dispatchHint = computed(() => {
  if (!selected.value) return ''
  if (selected.value.legacy) return '历史回填记录不参与出警'
  if (selected.value.status !== '待确认') return `当前「${selected.value.status}」，出警按钮只在待确认段可用`
  if (session.post !== '值班长') return '只有值班长能推进出警环节'
  if (session.isNight && !session.onDuty) return '夜间无人值守时段，非当班值班长不能派警'
  return '满足出警条件：当班值班长可推进'
})
const reviewHint = computed(() => {
  if (!selected.value) return ''
  if (selected.value.legacy) return '历史回填记录不参与复核'
  if (selected.value.status === '待确认') return '不许跳级：必须先出警才能复核'
  if (selected.value.status === '已复核') return '已归档，回不到上一档'
  if (session.post !== '值班长') return '复核归档必须由值班长执行'
  if (!selected.value.conclusion.trim()) return '人手还没到、现场结论未回写，卡在已出警段，不能复核'
  return '满足复核条件：现场已处理并回写结论'
})

function flash(result: OperateResult) {
  message.value = result.ok ? result.message : `已拦截（卡在${result.blockedAt ?? selected.value?.status}）：${result.message}`
  messageOk.value = result.ok
}

function select(id: number) {
  selectedId.value = id
  const alarm = getAlarm(id, session.crew)
  conclusionDraft.value = alarm?.conclusion ?? ''
  message.value = ''
}

function applyFilter() {
  reload()
}

function reload(selectPreferred: number | null = null) {
  rows.value = listAlarms(session.crew)
  counts.value = statusCounts(session.crew)
  receipts.value = listReceipts()
  if (selectPreferred !== null) {
    selectedId.value = selectPreferred
  }
  const stillThere = selectedId.value !== null && rows.value.some((r) => r.id === selectedId.value)
  if (!stillThere) {
    selectedId.value = rows.value[0]?.id ?? null
  }
  if (selectedId.value !== null) {
    const alarm = getAlarm(selectedId.value, session.crew)
    conclusionDraft.value = alarm?.conclusion ?? ''
  }
}

function submitReport() {
  const result = ingestReport(
    { cameraId: report.value.cameraId, reportId: report.value.reportId.trim(), time: report.value.time, kind: report.value.kind, crew: session.crew },
    session.clockText,
  )
  flash(result)
  if (result.ok && result.alarmId) {
    reload(result.alarmId)
  } else {
    reload()
  }
}

function doDispatch() {
  if (!selected.value) return
  const result = confirmDispatch(selected.value.id, ctx(), session.clockText)
  flash(result)
  if (result.ok) reload(selected.value.id)
}

function doConclusion() {
  if (!selected.value) return
  const result = submitConclusion(selected.value.id, conclusionDraft.value, ctx(), session.clockText)
  flash(result)
  if (result.ok) reload(selected.value.id)
}

function doReview() {
  if (!selected.value) return
  const result = reviewArchive(selected.value.id, ctx(), session.clockText)
  flash(result)
  if (result.ok) reload(selected.value.id)
}

function resetData() {
  resetPerimeterData()
  message.value = '已恢复周界演示数据'
  messageOk.value = true
  reload()
}

onMounted(() => reload())
</script>
