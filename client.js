// ============================================================================
// 带货视频拆解 · 浏览器半边（最小面板）。
// ============================================================================
const h = require('react').createElement
const { useState, useEffect } = require('react')

const PANEL_ID = 'ecom-video-seedance'
const BASE = 'ecom-video-seedance'

function PanelIcon(props) {
  return h('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', ...props },
    h('rect', { x: 2.5, y: 2.5, width: 19, height: 19, rx: 5, fill: '#4c6bfb' }),
    h('text', { x: 12, y: 15.5, 'font-size': 8, 'font-weight': 'bold', fill: '#fff', 'text-anchor': 'middle' }, '带货'))
}

async function fetchJson(path) {
  const res = await fetch(BASE + path)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`)
  return data
}

function GuideTab() {
  return h('div', null,
    h('div', { style: styles.card },
      h('div', { style: styles.sectionTitle }, '带货视频拆解'),
      h('div', { style: styles.stepList },
        '在对话里使用：',
        h('div', { style: styles.quote }, 'C:/Program Files/Git/ecom-video-seedance 视频路径'),
        '模型按技能正文方法论执行，产出文件写到工作区。')),
    h('div', { style: styles.card },
      h('div', { style: styles.sectionTitle }, '技能说明'),
      h('div', { style: styles.muted }, 'Reverse-engineer ecom videos into Seedance prompts')))
}

function Panel() {
  const [tab, setTab] = useState('guide')
  return h('div', { style: styles.wrap },
    h('div', { style: styles.row },
      h('button', { style: styles.tabActive }, '📖 使用指南')),
    h(GuideTab))
}

const styles = {
  wrap: { padding: 16, overflow: 'auto', height: '100%', boxSizing: 'border-box', fontFamily: '-apple-system, "Segoe UI", "Microsoft YaHei", sans-serif', fontSize: 13, color: '#1a1a1a' },
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 },
  tabActive: { padding: '8px 16px', border: '1px solid #4c6bfb', borderRadius: 8, background: '#eef1fd', color: '#1a3a8c', fontWeight: 600, fontSize: 13 },
  card: { background: '#fff', border: '1px solid #e3e3e6', borderRadius: 10, padding: 12, marginBottom: 10 },
  sectionTitle: { fontWeight: 700, marginBottom: 6, color: '#1a3a8c' },
  stepList: { lineHeight: 1.9 },
  quote: { background: '#eef1fd', borderRadius: 6, padding: '4px 10px', margin: '4px 0', color: '#1a3a8c' },
  muted: { color: '#8a8a92' },
}

function apply(ctx) {
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 21, label: () => '带货视频拆解' }, PanelIcon))
  ctx.slots.inject('main', () =>
    ctx.slots.register({ name: 'main', key: PANEL_ID }, Panel))
}

exports.isPlugin = true
exports.inject = ['slots']
exports.apply = apply
