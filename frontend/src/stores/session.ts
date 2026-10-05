import { defineStore } from 'pinia'

import type { Actor, Post } from '@/data/intrusion/types'
import { CREWS } from '@/data/intrusion/seed'
import { isNightTime } from '@/data/intrusion/clock'

type ShiftScene = 'day' | 'night'

// 模拟登录岗位：值班室屏幕上每一步操作都带「操作岗位」，夜班用 night 场景验证越权拦截。
export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '周建峰',
    post: '值班长' as Post,
    crew: CREWS[0],
    dutyCrew: CREWS[0],
    scope: '水电站机组运行检修管理平台',
    scene: 'night' as ShiftScene,
    // 场景对应的当前时刻：night 落在无人值守时段，day 落在白天。
    clockText: '2026-10-05 02:10:00',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    isNight: (state) => (state.scene === 'night' ? true : isNightTime(state.clockText)),
    // 当前操作人是否本班当班：班组对得上当班班组才算当班。
    onDuty(state): boolean {
      return state.crew === state.dutyCrew
    },
    actor(state): Actor {
      return { name: state.operator, post: state.post, crew: state.crew }
    },
    shiftLabel(state): string {
      return state.scene === 'night'
        ? `夜班（无人值守 22:00-06:00）· 当班：${state.dutyCrew}`
        : `白班 08:00-20:00 · 当班：${state.dutyCrew}`
    },
  },
  actions: {
    setOperator(name: string, post: Post, crew: string) {
      this.operator = name
      this.post = post
      this.crew = crew
    },
    setScene(scene: ShiftScene) {
      this.scene = scene
      this.clockText = scene === 'night' ? '2026-10-05 02:10:00' : '2026-10-05 10:10:00'
    },
    setDutyCrew(crew: string) {
      this.dutyCrew = crew
    },
  },
})
