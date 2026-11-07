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


// ---------- 分镜表 ----------
function fmtTime(iso) {
  try {
    const d = new Date(iso)
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
  } catch { return iso || '' }
}

function BoardsTab() {
  const [boards, setBoards] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)
  useEffect(() => {
    fetchJson('/api/boards').then((d) => setBoards(d.boards)).catch((e) => setError(e.message))
  }, [])
  if (error) return h('div', { style: styles.error }, error)
  if (boards === null) return h('div', { style: styles.muted }, '加载中…')
  if (!boards.length) {
    return h('div', { style: styles.muted },
      '还没有分镜表。在对话里说「拆解这条带货视频（贴链接）」或「给保温杯写一条 15 秒种草分镜脚本」，模型会用 seedance_storyboard 保存。')
  }
  const board = open ? boards.find((b) => b.id === open) : null
  if (board) {
    return h('div', null,
      h('div', { style: styles.row },
        h('button', { style: styles.chip, onClick: () => setOpen(null) }, '← 返回列表'),
        h('div', { style: styles.boardTitle }, board.product || board.id),
        board.style ? h('span', { style: styles.note }, board.style) : null),
      board.scenes.map((s) => h('div', { key: s.index, style: styles.card },
        h('div', { style: styles.sceneTitle }, '分镜 ' + s.index + (s.duration ? '（' + s.duration + 's）' : '') + '：' + s.shot),
        s.visual ? h('div', { style: styles.mutedSmall }, '画面：' + s.visual) : null,
        s.narration ? h('div', { style: styles.narration }, '口播：' + s.narration) : null)))
  }
  return h('div', null, boards.map((b) => h('div', {
    key: b.id, style: styles.card, onClick: () => setOpen(b.id), title: '点击展开分镜',
  },
    h('div', { style: styles.boardTitle }, b.product || b.id),
    h('div', { style: styles.mutedSmall }, b.scenes.length + ' 镜' + (b.style ? ' · ' + b.style : '') + ' · ' + fmtTime(b.updatedAt)))))
}

function Panel() {
  const [tab, setTab] = useState('boards')
  return h('div', { style: styles.wrap },
    h('div', { style: styles.row },
      h('button', { style: tab === 'boards' ? styles.tabActive : styles.tab, onClick: () => setTab('boards') }, '🎬 分镜表'),
      h('button', { style: tab === 'guide' ? styles.tabActive : styles.tab, onClick: () => setTab('guide') }, '📖 使用指南')),
    tab === 'boards' ? h(BoardsTab) : h(GuideTab))
}

const styles = {
  chip: { padding: '4px 12px', border: '1px solid #d9d9de', borderRadius: 999, background: '#fff', cursor: 'pointer', fontSize: 12 },
  boardTitle: { fontWeight: 700, color: '#4c6bfb' },
  sceneTitle: { fontWeight: 600, fontSize: 12.5, marginBottom: 4 },
  narration: { color: '#4a4a50', fontSize: 12, lineHeight: 1.6 },
  note: { background: '#e8eef7', color: '#4c6bfb', borderRadius: 4, padding: '1px 6px', fontSize: 11 },
  mutedSmall: { color: '#a0a0a8', fontSize: 12, lineHeight: 1.7 },
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
