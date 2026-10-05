import { defineStore } from 'pinia'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    role: '值班长',
    team: '运行一班',
    shiftLabel: '白班 08:00-20:00',
    nightWatch: false,
    scope: '水电站机组运行检修管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
      // 夜班属于无人值守时段，非值班岗的操作会被数据层拒绝
      this.nightWatch = label.includes('无人值守')
    },
    setRole(role: string) {
      this.role = role
    },
    setTeam(team: string) {
      this.team = team
    },
  },
})
