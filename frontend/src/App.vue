<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">水电站机组运行检修管理平台</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <main class="app-main">
      <header class="app-head">
        <span class="head-desc">面向电站台账、机组运行、调速励磁、主变与闸门、大坝渗流位移监测、机组检修与发电计划的一体化水电站运行检修管理平台。</span>
        <span class="head-user">
          当前值班：{{ store.operator }} · {{ store.shiftLabel }}
        </span>
      </header>
      <div class="session-bar">
        <label>
          操作岗位
          <select :value="store.post" @change="onPostChange(($event.target as HTMLSelectElement).value)">
            <option v-for="p in posts" :key="p" :value="p">{{ p }}</option>
          </select>
        </label>
        <label>
          操作人
          <input :value="store.operator" @change="onNameChange(($event.target as HTMLInputElement).value)" />
        </label>
        <label>
          所属班组
          <select :value="store.crew" @change="onCrewChange(($event.target as HTMLSelectElement).value)">
            <option v-for="c in crews" :key="c" :value="c">{{ c }}</option>
          </select>
        </label>
        <label>
          当班班组
          <select :value="store.dutyCrew" @change="onDutyChange(($event.target as HTMLSelectElement).value)">
            <option v-for="c in crews" :key="c" :value="c">{{ c }}</option>
          </select>
        </label>
        <label>
          时段场景
          <select :value="store.scene" @change="onSceneChange(($event.target as HTMLSelectElement).value)">
            <option value="night">夜间无人值守 02:10</option>
            <option value="day">白天值守 10:10</option>
          </select>
        </label>
      </div>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { useSessionStore } from '@/stores/session'
import { CREWS } from '@/data/intrusion/seed'
import { POSTS, type Post } from '@/data/intrusion/types'

const store = useSessionStore()
const crews = CREWS
const posts = POSTS

function onPostChange(post: string) {
  const nameByPost: Record<string, string> = {
    值班长: store.crew === '大坝安防一班' ? '周建峰' : '孙立群',
    值班员: '值班员',
    现场巡视员: '李南',
    非值班岗: '外来检修',
  }
  store.setOperator(nameByPost[post] ?? '操作员', post as Post, store.crew)
}
function onNameChange(name: string) {
  store.setOperator(name || '操作员', store.post, store.crew)
}
function onCrewChange(crew: string) {
  store.setOperator(store.operator, store.post, crew)
}
function onDutyChange(crew: string) {
  store.setDutyCrew(crew)
}
function onSceneChange(scene: string) {
  store.setScene(scene === 'night' ? 'night' : 'day')
}

const navItems = [{ label: "运营概览", path: "/" }, { label: "电站台账", path: "/station" }, { label: "机组运行", path: "/unit" }, { label: "调速器", path: "/governor" }, { label: "励磁系统", path: "/excitation" }, { label: "主变压器", path: "/transformer" }, { label: "闸门启闭", path: "/gate" }, { label: "渗流监测", path: "/seepage" }, { label: "位移监测", path: "/displacement" }, { label: "拦污栅", path: "/trashrack" }, { label: "机组检修", path: "/overhaul" }, { label: "导轴承", path: "/bearing" }, { label: "技术供水", path: "/cooling" }, { label: "水情调度", path: "/hydrology" }, { label: "泄洪操作", path: "/flood" }, { label: "发电计划", path: "/generation" }, { label: "继电保护", path: "/protection" }, { label: "缺陷处置", path: "/defect" }, { label: "周界入侵告警", path: "/perimeter" }, { label: "现场巡视隐患", path: "/patrol" }, { label: "检修人员", path: "/crew" }, { label: "备品备件", path: "/spare" }]
</script>
