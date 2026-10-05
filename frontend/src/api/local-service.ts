import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  DISPATCH_ROLE,
  DUTY_ROLES,
  MERGE_WINDOW_MS,
  PERIMETER_CAMERAS,
  PERIMETER_FLOW,
  PERIMETER_LEGACY,
} from '@/data/perimeter'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 操作人上下文：每一次状态变更都要带上岗位与时间，班组用来卡越权处理。
export type OperatorContext = {
  name: string
  role: string
  team: string
  nightWatch: boolean
}

const DEFAULT_OPERATOR: OperatorContext = {
  name: '值班管理员',
  role: '值班长',
  team: '运行一班',
  nightWatch: false,
}

function now(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function parseTime(value: string): number {
  const t = Date.parse(value.replace(' ', 'T'))
  return Number.isNaN(t) ? 0 : t
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
}

function appendLine(log: unknown, line: string): string {
  const text = String(log ?? '').trim()
  return text ? `${text}；${line}` : line
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(
  key: string,
  filters: Record<string, string> = {},
  operator: OperatorContext = DEFAULT_OPERATOR,
): PageResult {
  let rows = listRows(key)
  // 周界告警按班组隔离：只看得到属于自己的记录，别的班组的单不在这里出现。
  if (key === 'perimeter') {
    rows = rows.filter((row) => String(row['责任班组'] ?? '') === operator.team)
  }
  const matched = filterRows(rows, filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(
  key: string,
  id: number,
  action: string,
  operator: OperatorContext = DEFAULT_OPERATOR,
  extra: Record<string, string> = {},
): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  // 跨模块同步过来的记录只读：哪一版该保留由周界安防决定，别的入口只读这一份结论。
  if (String(rows[index]['只读'] ?? '') === '是') {
    return {
      ok: false,
      message: `该记录由周界安防结案后同步生成，此处只读，结论以周界安防模块的${rows[index]['来源单号'] ?? '原始告警'}为准`,
    }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  if (key === 'perimeter') {
    return runPerimeterAction(rows, index, action, target, operator, extra)
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 周界入侵告警处置链：只能向前走，一次只走一格，走到归档就回不了头。
function runPerimeterAction(
  rows: EntryRow[],
  index: number,
  action: string,
  target: string,
  operator: OperatorContext,
  extra: Record<string, string>,
): ActionResult {
  const row = rows[index]
  const current = String(row.status)
  // 越权替别的班组处理的一律拒绝。
  if (String(row['责任班组'] ?? '') !== operator.team) {
    return {
      ok: false,
      message: `越权拒绝：该告警责任班组是「${row['责任班组']}」，${operator.team}不能替别的班组处理`,
    }
  }
  // 夜间无人值守时段，非值班岗一律不能操作。
  if (operator.nightWatch && !DUTY_ROLES.includes(operator.role)) {
    return {
      ok: false,
      message: `夜间属于无人值守时段，非值班岗「${operator.role}」不能操作周界告警`,
    }
  }
  // 只有值班长能推进出警环节。
  if (target === '已出警' && operator.role !== DISPATCH_ROLE) {
    return { ok: false, message: `只有${DISPATCH_ROLE}能推进出警环节，当前岗位「${operator.role}」无权确认出警` }
  }
  // 已归档的记录回不到上一档。
  if (current === PERIMETER_FLOW[PERIMETER_FLOW.length - 1]) {
    return { ok: false, message: `该告警已归档，归档后回不到「${target}」，处置链到此为止` }
  }
  // 不许跳级：人手还没到就点已复核的，当场挡回去并指出卡在哪一段。
  const stepIndex = PERIMETER_FLOW.indexOf(current as (typeof PERIMETER_FLOW)[number])
  const expected = PERIMETER_FLOW[stepIndex + 1]
  if (target !== expected) {
    return {
      ok: false,
      message: `不能跳级：当前卡在「${current} → ${expected}」这一段，请先按顺序完成「${expected}」，不能直接到「${target}」`,
    }
  }
  if (action === '现场复核' && !String(extra['处理结论'] ?? row['处理结论'] ?? '').trim()) {
    return { ok: false, message: '现场复核前请先在详情面板填写处理结论，结论要回写到隐患清单' }
  }
  const time = now()
  const updated: EntryRow = {
    ...row,
    ...Object.fromEntries(Object.entries(extra).filter(([, value]) => value.trim() !== '')),
    status: target,
    pending: target !== PERIMETER_FLOW[PERIMETER_FLOW.length - 1],
    abnormal: false,
    最后操作岗位: operator.role,
    最后操作时间: time,
  }
  updated['流转记录'] = appendLine(
    row['流转记录'],
    `${time}｜${operator.role}｜${operator.name}｜${action}：${current} → ${target}`,
  )
  const next = [...rows]
  next[index] = updated
  saveRows('perimeter', next)

  // 处置结论不只留在安防面板：复核后回写隐患清单，归档后落到泄洪操作待办。
  let syncNote = ''
  if (target === '已复核') {
    syncNote = syncDefectHazard(updated, time)
  } else if (target === PERIMETER_FLOW[PERIMETER_FLOW.length - 1]) {
    syncNote = syncFloodTodo(updated, time)
  }
  return { ok: true, message: `入侵告警已${action}，当前状态「${target}」${syncNote}` }
}

// 出警结论回写到现场巡视的隐患清单（缺陷处置模块），巡视员在另一个入口能看到。
function syncDefectHazard(alarm: EntryRow, time: string): string {
  const rows = listRows('defect')
  const sourceId = String(alarm['告警编号'])
  if (rows.some((row) => String(row['来源单号'] ?? '') === sourceId)) {
    return '，隐患清单里已有这条周界隐患，不重复回写'
  }
  const id = nextId(rows)
  const hazardNo = `YH-${sourceId}`
  rows.push({
    id,
    status: '待处理',
    pending: true,
    abnormal: false,
    缺陷编号: hazardNo,
    设备名称: String(alarm['点位名称'] ?? ''),
    缺陷描述: `周界入侵隐患（${sourceId}）：${String(alarm['处理结论'] ?? '') || '现场复核确认存在入侵隐患'}`,
    缺陷等级: '一般',
    发现日期: time.slice(0, 10),
    处理期限: '',
    处理人员: '',
    缺陷状态: '待处理',
    来源模块: '周界安防',
    来源单号: sourceId,
    只读: '是',
  })
  saveRows('defect', rows)
  return `，隐患已回写到缺陷处置清单（${hazardNo}），该条只读`
}

// 处理结果落到泄洪操作的待办清单，跨模块的条数跟着一起变。
function syncFloodTodo(alarm: EntryRow, time: string): string {
  const rows = listRows('flood')
  const sourceId = String(alarm['告警编号'])
  if (rows.some((row) => String(row['来源单号'] ?? '') === sourceId)) {
    return '，泄洪待办里已有这条记录，不重复下发'
  }
  const id = nextId(rows)
  const todoNo = `TODO-${sourceId}`
  rows.push({
    id,
    status: '待审批',
    pending: true,
    abnormal: false,
    操作编号: todoNo,
    泄洪闸号: '待安排',
    开启孔数: 0,
    泄洪流量: '—',
    下游预警: `周界安防联动：${String(alarm['点位名称'] ?? '')}`,
    操作时间: time,
    操作人员: '',
    操作状态: '待审批',
    来源模块: '周界安防',
    来源单号: sourceId,
    只读: '是',
  })
  saveRows('flood', rows)
  return `，处理结果已落入泄洪操作待办清单（${todoNo}），该条只读`
}

export type AlarmReport = {
  点位名称: string
  批次号: string
  触发时间?: string
}

// 告警接入：先查摄像机离线原因，再查重复报送，再合并同一分钟内的重复触发。
export function reportPerimeterAlarm(
  input: AlarmReport,
  operator: OperatorContext = DEFAULT_OPERATOR,
): ActionResult {
  const camera = PERIMETER_CAMERAS.find((item) => item.点位名称 === input.点位名称)
  if (!camera) {
    return { ok: false, message: `点位「${input.点位名称}」不在周界摄像机台账里` }
  }
  // 摄像机离线：在待确认之前给出离线原因，不落单。
  if (camera.摄像机状态 === '离线') {
    return { ok: false, message: `摄像机离线，告警未进入待确认：${camera.离线原因}` }
  }
  const batchNo = input.批次号.trim()
  if (!batchNo) {
    return { ok: false, message: '报送批次号不能为空，同一份数据按批次号只算一次' }
  }
  const rows = listRows('perimeter')
  // 同一份数据重复报送只算一次，后到的那一份直接退回。
  const duplicated = rows.some((row) =>
    String(row['已收批次'] ?? row['批次号'] ?? '')
      .split(/[;；]/)
      .includes(batchNo),
  )
  if (duplicated) {
    return { ok: false, message: `批次号 ${batchNo} 已报送过，同一份数据只算一次，后到的那一份直接退回` }
  }
  const triggerTime = input.触发时间?.trim() || now()
  // 同一点位一分钟内无论触发几次都只记一次：按首次触发时间建单，后续触发只追加轨迹。
  const merged = rows.find(
    (row) =>
      String(row['点位名称']) === input.点位名称 &&
      Math.abs(parseTime(triggerTime) - parseTime(String(row['首次触发时间']))) <= MERGE_WINDOW_MS,
  )
  if (merged) {
    const index = rows.findIndex((row) => Number(row.id) === Number(merged.id))
    const updated: EntryRow = {
      ...rows[index],
      触发次数: Number(rows[index]['触发次数'] ?? 1) + 1,
      已收批次: `${String(rows[index]['已收批次'] ?? '')};${batchNo}`,
    }
    updated['触发轨迹'] = appendLine(rows[index]['触发轨迹'], `${triggerTime}（批次 ${batchNo}）`)
    const next = [...rows]
    next[index] = updated
    saveRows('perimeter', next)
    return {
      ok: true,
      message: `同一分钟内的重复触发，已并入 ${merged['告警编号']}（第 ${updated['触发次数']} 次），只追加轨迹不新建单`,
    }
  }
  const id = nextId(rows)
  const alarmNo = `PERI-${String(id).padStart(4, '0')}`
  rows.push({
    id,
    status: '待确认',
    pending: true,
    abnormal: false,
    告警编号: alarmNo,
    点位名称: input.点位名称,
    摄像机状态: camera.摄像机状态,
    首次触发时间: triggerTime,
    触发次数: 1,
    责任班组: operator.team,
    处理结论: '',
    登记时间: triggerTime,
    批次号: batchNo,
    已收批次: batchNo,
    触发轨迹: `${triggerTime}（批次 ${batchNo}）`,
    流转记录: `${triggerTime}｜系统｜告警接入｜落单：待确认`,
    最后操作岗位: '系统',
    最后操作时间: triggerTime,
    回填说明: '',
  })
  saveRows('perimeter', rows)
  return { ok: true, message: `告警已落单 ${alarmNo}，当前状态「待确认」，责任班组 ${operator.team}` }
}

// 历史数据按登记时间整体回填：缺字段的早期记录另列一行说明，重复批次直接退回。
export function backfillPerimeterHistory(
  operator: OperatorContext = DEFAULT_OPERATOR,
): ActionResult {
  const rows = listRows('perimeter')
  const received = new Set(
    rows.flatMap((row) =>
      String(row['已收批次'] ?? row['批次号'] ?? '')
        .split(/[;；]/)
        .filter(Boolean),
    ),
  )
  const sorted = [...PERIMETER_LEGACY].sort(
    (a, b) => parseTime(a.登记时间) - parseTime(b.登记时间),
  )
  let filled = 0
  let returned = 0
  let missing = 0
  for (const legacy of sorted) {
    if (received.has(legacy.批次号)) {
      returned += 1
      continue
    }
    const required: (keyof typeof legacy)[] = ['点位名称', '首次触发时间', '责任班组', '处理结论']
    const missingFields = required.filter((field) => !String(legacy[field] ?? '').trim())
    if (missingFields.length > 0) {
      missing += 1
    }
    const id = nextId(rows)
    const alarmNo = `PERI-${String(id).padStart(4, '0')}`
    rows.push({
      id,
      status: '已归档',
      pending: false,
      abnormal: false,
      告警编号: alarmNo,
      点位名称: legacy.点位名称,
      摄像机状态: '在线',
      首次触发时间: legacy.首次触发时间,
      触发次数: legacy.触发次数 ?? 1,
      责任班组: legacy.责任班组,
      处理结论: legacy.处理结论 ?? '',
      登记时间: legacy.登记时间,
      批次号: legacy.批次号,
      已收批次: legacy.批次号,
      触发轨迹: `${legacy.首次触发时间}（批次 ${legacy.批次号}）`,
      流转记录: `${legacy.登记时间}｜系统｜历史回填｜按登记时间整体回填为已归档`,
      最后操作岗位: '系统',
      最后操作时间: legacy.登记时间,
      回填说明:
        missingFields.length > 0
          ? `早期记录缺字段：${missingFields.join('、')}，已按登记时间整体回填`
          : '',
    })
    received.add(legacy.批次号)
    filled += 1
  }
  saveRows('perimeter', rows)
  if (filled === 0 && returned === 0) {
    return { ok: false, message: '没有待回填的历史数据' }
  }
  return {
    ok: true,
    message: `历史回填完成（操作人 ${operator.team}·${operator.role}）：按登记时间回填 ${filled} 条，重复报送退回 ${returned} 条，缺字段另列说明 ${missing} 条`,
  }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
