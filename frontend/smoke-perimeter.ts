import {
  backfillPerimeterHistory,
  listEntries,
  reportPerimeterAlarm,
  runAction,
  type OperatorContext,
} from '@/api/local-service'

const lead1: OperatorContext = { name: '张三', role: '值班长', team: '运行一班', nightWatch: false }
const op1: OperatorContext = { name: '李四', role: '值班员', team: '运行一班', nightWatch: false }
const patrolNight: OperatorContext = { name: '王五', role: '巡视员', team: '运行一班', nightWatch: true }
const lead2: OperatorContext = { name: '赵六', role: '值班长', team: '运行二班', nightWatch: false }

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`PASS  ${name}`)
  } else {
    failures += 1
    console.log(`FAIL  ${name}  ${detail}`)
  }
}

// 1. 班组隔离：只看得到属于自己的记录
check('一班看到3条', listEntries('perimeter', {}, lead1).total === 3)
check('二班看到2条', listEntries('perimeter', {}, lead2).total === 2)

// 2. 越权替别的班组处理一律拒绝
const cross = runAction('perimeter', 3, '确认出警', lead1)
check('越权处理被拒', !cross.ok && cross.message.includes('越权'), cross.message)

// 3. 只有值班长能推进出警
const notLead = runAction('perimeter', 1, '确认出警', op1)
check('值班员不能出警', !notLead.ok && notLead.message.includes('值班长'), notLead.message)

// 4. 跳级被挡回并指出卡在哪一段
const skip = runAction('perimeter', 1, '归档结案', lead1)
check('跳级被挡并指出段位', !skip.ok && skip.message.includes('待确认 → 已出警'), skip.message)

// 5. 夜间无人值守时段非值班岗一律拒绝
const night = runAction('perimeter', 2, '现场复核', patrolNight)
check('夜间非值班岗被拒', !night.ok && night.message.includes('无人值守'), night.message)

// 6. 正序推进：确认出警 → 现场复核（须带结论）→ 归档结案
const dispatch = runAction('perimeter', 1, '确认出警', lead1)
check('值班长确认出警', dispatch.ok, dispatch.message)
const noConclusion = runAction('perimeter', 1, '现场复核', op1)
check('复核缺结论被拒', !noConclusion.ok, noConclusion.message)
const review = runAction('perimeter', 1, '现场复核', op1, { 处理结论: '现场核查为人员翻越，已控制并移交公安' })
check('现场复核成功', review.ok && review.message.includes('缺陷处置'), review.message)
const defectRows = listEntries('defect').items
const hazard = defectRows.find((r) => r['来源单号'] === 'PERI-0001')
check('隐患回写到缺陷处置', !!hazard && String(hazard['缺陷描述']).includes('人员翻越'))
const readonly1 = runAction('defect', Number(hazard?.id), '派发处理')
check('隐患清单条目只读', !readonly1.ok && readonly1.message.includes('只读'), readonly1.message)
const archive = runAction('perimeter', 1, '归档结案', lead1)
check('归档结案成功', archive.ok && archive.message.includes('泄洪操作'), archive.message)
const floodRows = listEntries('flood').items
const todo = floodRows.find((r) => r['来源单号'] === 'PERI-0001')
check('待办落入泄洪操作', !!todo && todo.status === '待审批')
const readonly2 = runAction('flood', Number(todo?.id), '提交审批')
check('泄洪待办条目只读', !readonly2.ok && readonly2.message.includes('只读'), readonly2.message)

// 7. 已归档回不到上一档
const back = runAction('perimeter', 1, '确认出警', lead1)
check('归档后回不到已出警', !back.ok && back.message.includes('归档'), back.message)

// 8. 流转记录带岗位与时间
const row1 = listEntries('perimeter', {}, lead1).items.find((r) => Number(r.id) === 1)
const log = String(row1?.['流转记录'] ?? '')
check('流转记录带岗位时间', log.includes('值班长') && log.includes('确认出警：待确认 → 已出警'), log)
check('最后操作岗位已记录', row1?.['最后操作岗位'] === '值班长')

// 9. 摄像机离线：待确认之前给出离线原因
const offline = reportPerimeterAlarm({ 点位名称: '泄洪闸室周界', 批次号: 'RPT-X1' }, lead1)
check('离线原因先于落单', !offline.ok && offline.message.includes('光纤熔接盒进水'), offline.message)

// 10. 重复报送只算一次
const dup = reportPerimeterAlarm({ 点位名称: '尾水平台周界', 批次号: 'RPT-20261004-003' }, lead1)
check('重复批次直接退回', !dup.ok && dup.message.includes('只算一次'), dup.message)

// 11. 同一分钟内的重复触发只追加轨迹
const before = listEntries('perimeter', {}, lead1).total
const merge = reportPerimeterAlarm(
  { 点位名称: '尾水平台周界', 批次号: 'RPT-NEW-1', 触发时间: '2026-10-04 23:40:50' },
  lead1,
)
const afterMerge = listEntries('perimeter', {}, lead1).total
check('一分钟内合并不新建单', merge.ok && afterMerge === before, merge.message)
const mergedRow = listEntries('perimeter', {}, lead1).items.find((r) => Number(r.id) === 2)
check('轨迹已追加次数+1', Number(mergedRow?.['触发次数']) === 2 && String(mergedRow?.['触发轨迹']).includes('RPT-NEW-1'))

// 12. 正常报送落单到待确认
const fresh = reportPerimeterAlarm(
  { 点位名称: '尾水平台周界', 批次号: 'RPT-NEW-2', 触发时间: '2026-10-05 01:00:00' },
  lead1,
)
check('新告警落入待确认', fresh.ok && fresh.message.includes('待确认'), fresh.message)

// 13. 历史回填：按登记时间回填、重复退回、缺字段另列说明
const backfill = backfillPerimeterHistory(lead1)
check('回填2条退回1条缺字段1条', backfill.ok && backfill.message.includes('回填 2 条') && backfill.message.includes('退回 1 条') && backfill.message.includes('缺字段另列说明 1 条'), backfill.message)
const legacyMissing = listEntries('perimeter', {}, lead2).items.find((r) => r['批次号'] === 'RPT-20260402-001')
check('缺字段记录另列说明', String(legacyMissing?.['回填说明'] ?? '').includes('处理结论'), String(legacyMissing?.['回填说明']))
const again = backfillPerimeterHistory(lead1)
check('二次回填全部退回', again.ok && again.message.includes('回填 0 条') && again.message.includes('退回 3 条'), again.message)

// 14. 跨模块条数联动
check('缺陷处置条数+1', listEntries('defect').total === 4, String(listEntries('defect').total))
check('泄洪操作条数+1', listEntries('flood').total === 4, String(listEntries('flood').total))

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项未通过`)
process.exit(failures === 0 ? 0 : 1)
