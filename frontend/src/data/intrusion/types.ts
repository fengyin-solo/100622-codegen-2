/** 周界入侵告警处置链的领域类型。
 * 链路只能向前：待确认 → 已出警 → 已复核（归档），不允许跳级、不允许回退。 */

// 处置链四档（含摄像机离线的落单前标注），顺序即唯一允许的流转方向。
export const INTRUSION_STATUSES = ['待确认', '已出警', '已复核'] as const
export type IntrusionStatus = (typeof INTRUSION_STATUSES)[number]
export const ARCHIVED_STATUS: IntrusionStatus = '已复核'

// 操作岗位：只有值班长能推进出警、复核归档；非值班岗任何时候都不能点出警。
export const POSTS = ['值班长', '值班员', '现场巡视员', '非值班岗'] as const
export type Post = (typeof POSTS)[number]
export const DISPATCH_POST: Post = '值班长'

export type Actor = {
  name: string
  post: Post
  crew: string
}

// 一次摄像机触发轨迹。同一点位一分钟内多次触发只建一单，后续触发都追加到这里。
export type Trigger = {
  time: string
  epoch: number
  kind: string
  reportId: string
}

// 状态流转/系统事件日志：每次状态变更都带操作岗位与时间，谁在什么时候推进了哪一档可追溯。
export type FlowEvent = {
  time: string
  from: string
  to: string
  action: string
  actor: Actor
  note?: string
}

export type IntrusionAlarm = {
  id: number
  alarmNo: string
  cameraId: string
  cameraName: string
  pointName: string
  owningCrew: string
  status: IntrusionStatus
  // 首次触发时间即建单时间。
  firstTriggerTime: string
  firstTriggerEpoch: number
  registeredTime: string
  registeredEpoch: number
  triggers: Trigger[]
  flow: FlowEvent[]
  // 摄像机离线时，在落「待确认」之前先给出离线原因。
  cameraOffline: boolean
  offlineReason: string
  // 现场处置结论，复核归档前必须已由现场回写。
  conclusion: string
  conclusionActor: Actor | null
  conclusionTime: string
  // 派警/到场信息。
  dispatchActor: Actor | null
  dispatchTime: string
  reviewActor: Actor | null
  reviewTime: string
  // 历史回填数据：早期缺字段的记录另列一行说明。
  legacy: boolean
  missingFields: string[]
  archived: boolean
  abnormal: boolean
  pending: boolean
}

// 上报报文：同一报文重复报送只算一次，后到的一份直接退回。
export type ReportReceipt = {
  reportId: string
  alarmId: number
  time: string
  accepted: boolean
  reason: string
}

export type CameraInfo = {
  id: string
  name: string
  point: string
  online: boolean
  offlineReason: string
}

export type LegacyNote = {
  alarmNo: string
  registeredTime: string
  missingFields: string[]
  note: string
}

// 现场巡视隐患清单（只读投影）：结论从周界告警权威记录回写而来。
export type HazardItem = {
  hazardNo: string
  sourceAlarmNo: string
  pointName: string
  cameraName: string
  foundTime: string
  conclusion: string
  crew: string
  archivedTime: string
  legacy: boolean
  note: string
}

// 泄洪操作待办清单（只读投影）：周界处置结果落到这里，跨模块条数随告警一起变。
export type FloodTodo = {
  todoNo: string
  sourceAlarmNo: string
  title: string
  pointName: string
  crew: string
  createdAt: string
  done: boolean
}

export type OperateContext = {
  actor: Actor
  // 当前是否处于夜间无人值守时段。
  isNight: boolean
  // 操作人是否本班当班（夜间只有当班值班长能推进出警）。
  onDuty: boolean
}

export type OperateResult = {
  ok: boolean
  message: string
  // 被挡回时指出卡在哪一段。
  blockedAt?: string
  alarmId?: number
}

export type IngestInput = {
  cameraId: string
  reportId: string
  time: string
  kind: string
  crew: string
}
