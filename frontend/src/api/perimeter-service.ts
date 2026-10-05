import { cameras, db, legacyNotes, persist, resetPerimeter } from '@/data/intrusion/store'
import { isNightTime, parseTime } from '@/data/intrusion/clock'
import type {
  FloodTodo,
  HazardItem,
  IngestInput,
  IntrusionAlarm,
  OperateContext,
  OperateResult,
  ReportReceipt,
} from '@/data/intrusion/types'
import { INTRUSION_STATUSES } from '@/data/intrusion/types'

const MERGE_WINDOW_MS = 60_000
const AUTHORITY_VERSION = '周界安防面板（权威版）'

// 权威版本由本模块决定：告警工单只在周界面板产生与流转，其他入口只读这一份结论。
export function authorityVersion(): string {
  return AUTHORITY_VERSION
}

export function listCameras() {
  return cameras()
}

export function listLegacyNotes() {
  return legacyNotes()
}

function nextAlarmNo(epoch: number): string {
  const d = new Date(epoch)
  const p = (n: number) => String(n).padStart(2, '0')
  return `PERI-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${String(db().seq + 1).padStart(3, '0')}`
}

function seen(alarm: IntrusionAlarm, status: string): boolean {
  return alarm.flow.some((ev) => ev.to === status)
}

// 跳级/回退拦截：链路只能走到「当前档的下一档」，挡回时指出卡在哪一段。
function guardForward(alarm: IntrusionAlarm, target: string): OperateResult | null {
  const currentIdx = INTRUSION_STATUSES.indexOf(alarm.status)
  const targetIdx = INTRUSION_STATUSES.indexOf(target as (typeof INTRUSION_STATUSES)[number])
  if (targetIdx <= currentIdx) {
    return {
      ok: false,
      blockedAt: alarm.status,
      message:
        alarm.status === '已复核'
          ? `记录已归档，「已复核」是最后一档，归档后回不到上一档（不能退回${target}）`
          : `处置链只许向前，${alarm.status}不能退回${target}`,
    }
  }
  if (targetIdx !== currentIdx + 1) {
    const missing = INTRUSION_STATUSES.slice(currentIdx + 1, targetIdx)
    return {
      ok: false,
      blockedAt: alarm.status,
      message: `不许跳级：当前卡在「${alarm.status}」，必须先经过「${missing.join('」「')}」，不能直接到「${target}」`,
    }
  }
  return null
}

// 班组隔离：只能处理属于自己班组的记录，替别的班组提交一律拒绝。
function guardCrew(alarm: IntrusionAlarm, ctx: OperateContext): OperateResult | null {
  if (ctx.actor.crew !== alarm.owningCrew) {
    return {
      ok: false,
      blockedAt: alarm.status,
      message: `该工单属于「${alarm.owningCrew}」，当前是「${ctx.actor.crew}」，越权替别的班组处理已拒绝`,
    }
  }
  return null
}

function findAlarm(id: number): { alarm?: IntrusionAlarm; index: number; rows: IntrusionAlarm[] } {
  const rows = db().alarms
  const index = rows.findIndex((item) => item.id === id)
  return { alarm: rows[index], index, rows }
}

/**
 * 摄像机触发上报。
 * - 同一报文重复报送只算一次，后到的直接退回；
 * - 同一点位一分钟内多次触发只建一单，按首次触发时间建单，后续只追加轨迹；
 * - 摄像机离线时，先落离线原因再进待确认。
 */
export function ingestReport(input: IngestInput, now: string = input.time): OperateResult & { receipt: ReportReceipt } {
  const cam = cameras().find((item) => item.id === input.cameraId)
  const epoch = parseTime(input.time)
  const rejectReceipt = (reason: string): ReportReceipt => ({
    reportId: input.reportId,
    alarmId: -1,
    time: now,
    accepted: false,
    reason,
  })
  if (!cam) {
    const receipt = rejectReceipt('找不到该摄像机点位')
    logReceipt(receipt)
    return { ok: false, message: receipt.reason, receipt }
  }
  if (Number.isNaN(epoch)) {
    const receipt = rejectReceipt('上报时间格式不合法')
    logReceipt(receipt)
    return { ok: false, message: receipt.reason, receipt }
  }

  const database = db()
  // 同一份数据重复报送：查历史轨迹与报送回执，命中即退。
  const dupInAlarm = database.alarms.some((alarm) => alarm.triggers.some((t) => t.reportId === input.reportId))
  const dupReceipt = database.reports.find((r) => r.reportId === input.reportId && r.accepted)
  if (dupInAlarm || dupReceipt) {
    const receipt = rejectReceipt('同一份数据重复报送，只算一次，后到的一份直接退回')
    logReceipt(receipt)
    return { ok: false, message: receipt.reason, receipt }
  }

  // 同一点位一分钟内：对仍在「待确认」的工单，只在一分钟窗口内追加轨迹，不新建单。
  const mergeTarget = database.alarms.find(
    (alarm) =>
      alarm.cameraId === input.cameraId &&
      alarm.status === '待确认' &&
      epoch - alarm.firstTriggerEpoch >= 0 &&
      epoch - alarm.firstTriggerEpoch <= MERGE_WINDOW_MS,
  )
  if (mergeTarget) {
    const next = [...database.alarms]
    const idx = next.indexOf(mergeTarget)
    const updated: IntrusionAlarm = {
      ...mergeTarget,
      triggers: [
        ...mergeTarget.triggers,
        { time: input.time, epoch, kind: input.kind, reportId: input.reportId },
      ],
      flow: [
        ...mergeTarget.flow,
        {
          time: now,
          from: '待确认',
          to: '待确认',
          action: '追加轨迹',
          actor: { name: '联动平台', post: '值班员', crew: input.crew },
          note: '同一摄像机一分钟内再次触发，不重复建单，仅追加触发轨迹',
        },
      ],
    }
    next[idx] = updated
    persist({ ...database, alarms: next })
    const receipt: ReportReceipt = {
      reportId: input.reportId,
      alarmId: updated.id,
      time: now,
      accepted: true,
      reason: `并入工单 ${updated.alarmNo}（一分钟内重复触发，只追加轨迹）`,
    }
    logReceipt(receipt)
    return {
      ok: true,
      alarmId: updated.id,
      message: `${cam.name} 一分钟内再次触发，已并入 ${updated.alarmNo}，不重复建单，只追加轨迹`,
      receipt,
    }
  }

  // 新建工单：按首次触发时间建单，落在「待确认」；离线时在待确认之前先给离线原因。
  const id = database.seq + 1
  const alarmNo = nextAlarmNo(epoch)
  const flow = []
  if (!cam.online) {
    flow.push({
      time: now,
      from: '—',
      to: '摄像机离线',
      action: '离线标注',
      actor: { name: '联动平台', post: '值班员' as const, crew: input.crew },
      note: `摄像机离线：${cam.offlineReason}；告警先挂离线原因，待链路恢复后核对画面`,
    })
  }
  flow.push({
    time: now,
    from: cam.online ? '—' : '摄像机离线',
    to: '待确认',
    action: '系统建单',
    actor: { name: '联动平台', post: '值班员' as const, crew: input.crew },
    note: cam.online ? '按首次触发时间建单' : '离线补传告警，离线原因已在待确认之前标注',
  })
  const alarm: IntrusionAlarm = {
    id,
    alarmNo,
    cameraId: cam.id,
    cameraName: cam.name,
    pointName: cam.point,
    owningCrew: input.crew,
    status: '待确认',
    firstTriggerTime: input.time,
    firstTriggerEpoch: epoch,
    registeredTime: input.time,
    registeredEpoch: epoch,
    triggers: [{ time: input.time, epoch, kind: input.kind, reportId: input.reportId }],
    flow,
    cameraOffline: !cam.online,
    offlineReason: cam.online ? '' : cam.offlineReason,
    conclusion: '',
    conclusionActor: null,
    conclusionTime: '',
    dispatchActor: null,
    dispatchTime: '',
    reviewActor: null,
    reviewTime: '',
    legacy: false,
    missingFields: [],
    archived: false,
    abnormal: false,
    pending: true,
  }
  persist({ ...database, seq: id, alarms: [...database.alarms, alarm] })
  const receipt: ReportReceipt = { reportId: input.reportId, alarmId: id, time: now, accepted: true, reason: `新建工单 ${alarmNo}` }
  logReceipt(receipt)
  return {
    ok: true,
    alarmId: id,
    message: cam.online
      ? `${cam.name} 触发「${input.kind}」，已按首次触发时间建单 ${alarmNo}，落「待确认」`
      : `${cam.name} 当前离线（${cam.offlineReason}），离线原因已先标注，再落「待确认」，工单 ${alarmNo}`,
    receipt,
  }
}

function logReceipt(receipt: ReportReceipt): void {
  const database = db()
  persist({ ...database, reportSeq: database.reportSeq + 1, reports: [...database.reports, receipt] })
}

export function listReceipts(): ReportReceipt[] {
  return [...db().reports].reverse()
}

/** 待确认 → 已出警：只有值班长能推进出警；夜间无人值守时段非当班一律拒绝。 */
export function confirmDispatch(id: number, ctx: OperateContext, now: string): OperateResult {
  const { alarm, index, rows } = findAlarm(id)
  if (!alarm) {
    return { ok: false, message: `没有找到编号为 ${id} 的周界告警工单` }
  }
  const crewError = guardCrew(alarm, ctx)
  if (crewError) return crewError
  const forwardError = guardForward(alarm, '已出警')
  if (forwardError) return forwardError

  if (ctx.actor.post !== '值班长') {
    return {
      ok: false,
      blockedAt: '待确认→已出警',
      message:
        ctx.actor.post === '非值班岗'
          ? '夜间无人值守时段，非值班岗无权直接点「已出警」，出警环节只有当班值班长能推进'
          : `只有值班长能推进出警环节，${ctx.actor.post}无权点「已出警」`,
    }
  }
  if (ctx.isNight && !ctx.onDuty) {
    return {
      ok: false,
      blockedAt: '待确认→已出警',
      message: '当前是夜间无人值守时段（22:00-06:00），你不在本班当班，越权派警已拒绝；只有当班值班长能推进出警',
    }
  }

  const updated: IntrusionAlarm = {
    ...alarm,
    status: '已出警',
    dispatchActor: { ...ctx.actor },
    dispatchTime: now,
    pending: true,
    abnormal: false,
    flow: [
      ...alarm.flow,
      {
        time: now,
        from: '待确认',
        to: '已出警',
        action: '确认有情况·派警',
        actor: { ...ctx.actor },
        note: ctx.isNight ? '夜间无人值守时段，由当班值班长推进出警' : '',
      },
    ],
  }
  const next = [...rows]
  next[index] = updated
  persist({ ...db(), alarms: next })
  return { ok: true, alarmId: id, message: `工单 ${alarm.alarmNo} 已确认有情况并派警，进入「已出警」，操作岗位：值班长 ${ctx.actor.name}（${now}）` }
}

/** 现场处置结论回写（不改变状态）：现场巡视员/值班长可登记，必须在复核前完成。 */
export function submitConclusion(id: number, conclusion: string, ctx: OperateContext, now: string): OperateResult {
  const { alarm, index, rows } = findAlarm(id)
  if (!alarm) {
    return { ok: false, message: `没有找到编号为 ${id} 的周界告警工单` }
  }
  const crewError = guardCrew(alarm, ctx)
  if (crewError) return crewError
  if (alarm.archived) {
    return { ok: false, blockedAt: '已复核', message: '工单已归档，结论已锁定，不能再改' }
  }
  if (alarm.status !== '已出警') {
    return { ok: false, blockedAt: alarm.status, message: `当前卡在「${alarm.status}」，还没出警，现场结论要等出警到场后才能回写` }
  }
  if (!conclusion.trim()) {
    return { ok: false, blockedAt: '已出警', message: '现场处置结论不能为空，复核归档前必须先回写结论' }
  }
  if (ctx.actor.post !== '现场巡视员' && ctx.actor.post !== '值班长') {
    return { ok: false, blockedAt: '已出警', message: `现场处置结论由现场巡视员回写，${ctx.actor.post}无权登记` }
  }
  const updated: IntrusionAlarm = {
    ...alarm,
    conclusion: conclusion.trim(),
    conclusionActor: { ...ctx.actor },
    conclusionTime: now,
    flow: [
      ...alarm.flow,
      {
        time: now,
        from: '已出警',
        to: '已出警',
        action: '回写现场结论',
        actor: { ...ctx.actor },
        note: conclusion.trim(),
      },
    ],
  }
  const next = [...rows]
  next[index] = updated
  persist({ ...db(), alarms: next })
  return { ok: true, alarmId: id, message: `工单 ${alarm.alarmNo} 现场结论已回写，将同步到现场巡视隐患清单（操作岗位：${ctx.actor.post} ${ctx.actor.name}）` }
}

/** 已出警 → 已复核并归档：值班长，现场必须已处理并回写结论；归档后不可回退。 */
export function reviewArchive(id: number, ctx: OperateContext, now: string): OperateResult {
  const { alarm, index, rows } = findAlarm(id)
  if (!alarm) {
    return { ok: false, message: `没有找到编号为 ${id} 的周界告警工单` }
  }
  const crewError = guardCrew(alarm, ctx)
  if (crewError) return crewError
  const forwardError = guardForward(alarm, '已复核')
  if (forwardError) return forwardError
  if (ctx.actor.post !== '值班长') {
    return {
      ok: false,
      blockedAt: '已出警→已复核',
      message:
        ctx.actor.post === '非值班岗'
          ? '非值班岗不能点「已复核」，复核归档必须由值班长执行'
          : `人手还没到现场不能复核：复核归档必须由值班长执行，${ctx.actor.post}无权归档`,
    }
  }
  if (!alarm.conclusion.trim()) {
    return {
      ok: false,
      blockedAt: '已出警→已复核',
      message: '人手还没到、现场处理结论还没回写，卡在「已出警」段：必须现场处理完并回写结论，才能复核归档',
    }
  }

  const updated: IntrusionAlarm = {
    ...alarm,
    status: '已复核',
    archived: true,
    pending: false,
    reviewActor: { ...ctx.actor },
    reviewTime: now,
    flow: [
      ...alarm.flow,
      { time: now, from: '已出警', to: '已复核', action: '现场处理完成·复核归档', actor: { ...ctx.actor } },
    ],
  }
  const next = [...rows]
  next[index] = updated
  persist({ ...db(), alarms: next })
  return {
    ok: true,
    alarmId: id,
    message: `工单 ${alarm.alarmNo} 已复核归档，结论同步到现场巡视隐患清单和泄洪操作待办（值班长 ${ctx.actor.name}，${now}）`,
  }
}

// 班组隔离视图：只看得到属于自己班组的记录。
export function listAlarms(crew: string | null): IntrusionAlarm[] {
  const rows = [...db().alarms].sort((a, b) => b.registeredEpoch - a.registeredEpoch)
  return crew ? rows.filter((alarm) => alarm.owningCrew === crew) : rows
}

export function getAlarm(id: number, crew: string | null): IntrusionAlarm | null {
  const alarm = db().alarms.find((item) => item.id === id) ?? null
  if (alarm && crew && alarm.owningCrew !== crew) {
    return null
  }
  return alarm
}

export function statusCounts(crew: string | null) {
  const rows = listAlarms(crew)
  return {
    待确认: rows.filter((a) => a.status === '待确认').length,
    已出警: rows.filter((a) => a.status === '已出警').length,
    已复核: rows.filter((a) => a.status === '已复核').length,
    离线待确认: rows.filter((a) => a.status === '待确认' && a.cameraOffline).length,
  }
}

/**
 * 现场巡视隐患清单（只读投影）：权威结论来自周界工单，巡视员在另一个入口看到同一条周界隐患。
 * 早期缺字段的历史记录另列一行说明，不当作有结论的隐患。
 */
export function listHazards(crew: string | null): HazardItem[] {
  const rows = listAlarms(crew).filter((a) => seen(a, '已复核'))
  const items: HazardItem[] = []
  for (const alarm of rows) {
    if (alarm.legacy) {
      const note = legacyNotes().find((n) => n.alarmNo === alarm.alarmNo)
      items.push({
        hazardNo: `HZ-${alarm.alarmNo}`,
        sourceAlarmNo: alarm.alarmNo,
        pointName: alarm.pointName,
        cameraName: alarm.cameraName,
        foundTime: alarm.registeredTime,
        conclusion: '',
        crew: alarm.owningCrew,
        archivedTime: alarm.reviewTime || '—',
        legacy: true,
        note: note ? note.note : '历史回填记录，早期字段缺失。',
      })
      continue
    }
    if (!alarm.conclusion) continue
    items.push({
      hazardNo: `HZ-${alarm.alarmNo}`,
      sourceAlarmNo: alarm.alarmNo,
      pointName: alarm.pointName,
      cameraName: alarm.cameraName,
      foundTime: alarm.firstTriggerTime,
      conclusion: alarm.conclusion,
      crew: alarm.owningCrew,
      archivedTime: alarm.reviewTime,
      legacy: false,
      note: '',
    })
  }
  return items.sort((a, b) => parseTime(b.foundTime) - parseTime(a.foundTime))
}

/** 泄洪操作待办清单（只读投影）：周界处理结果落到这里，归档一条就多一条，跨模块条数跟着变。 */
export function listFloodTodos(): FloodTodo[] {
  return listAlarms(null)
    .filter((a) => a.status === '已复核' && !a.legacy && a.conclusion)
    .sort((a, b) => parseTime(b.reviewTime) - parseTime(a.reviewTime))
    .map((alarm) => ({
      todoNo: `TODO-PERI-${alarm.alarmNo}`,
      sourceAlarmNo: alarm.alarmNo,
      title: `泄洪前核查周界隐患：${alarm.pointName}`,
      pointName: alarm.pointName,
      crew: alarm.owningCrew,
      createdAt: alarm.reviewTime,
      done: false,
    }))
}

export function resetPerimeterData() {
  resetPerimeter()
}

export { isNightTime }
