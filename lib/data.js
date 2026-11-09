// 带货视频拆解 · 分镜表 + 生成历史持久化（$DSH_HOME/ecom-video-seedance/）。
//
//   storyboards.json  [{ id, product, style, scenes[], createdAt, updatedAt,
//                        revisions: [{ rev, at, kind, product, style, scenes[], note }] }]
//   history.json      [{ id, at, kind: create|update|delete|restore, boardId, product, style,
//                        sceneCount, duration, rev, summary, snapshot? }]
//
// 每保存一次就多一版（revisions，最多 20 版）；每次保存/删除/恢复都往 history 里记一条，
// 页面「生成历史」和 seedance_storyboard 工具的 history 动作读的是同一份。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DATA_DIR = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'ecom-video-seedance')
const SB_FILE = join(DATA_DIR, 'storyboards.json')
const HIST_FILE = join(DATA_DIR, 'history.json')
const MAX_BOARDS = 100
const MAX_REVISIONS = 20
const MAX_HISTORY = 300

export const KIND_LABEL = { create: '新建', update: '更新', delete: '删除', restore: '恢复' }

export function ensureDirs() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
}

// 原子写：先 .tmp 再 rename，页面轮询时不会读到半截 JSON。
function writeJson(file, value) {
  ensureDirs()
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  try {
    renameSync(tmp, file)
  } catch (err) {
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    throw err
  }
}

function readJson(file, fallback) {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    return raw ?? fallback
  } catch {
    return fallback
  }
}

function load() {
  const raw = readJson(SB_FILE, [])
  return Array.isArray(raw) ? raw : []
}

function save(boards) {
  writeJson(SB_FILE, boards)
}

// ---------------------------------------------------------------- 分镜表

function scenesOf(board) {
  return Array.isArray(board.scenes) ? board.scenes : []
}

export function sceneDuration(board) {
  return scenesOf(board).reduce((sum, s) => sum + (Number(s.duration) || 0), 0)
}

// 列表只给摘要（页面卡片用），正文用 getBoard。
export function listBoards() {
  return load()
}

export function boardSummary(board) {
  return {
    id: board.id,
    product: board.product || '',
    style: board.style || '',
    sceneCount: scenesOf(board).length,
    duration: sceneDuration(board),
    rev: (board.revisions || []).length || 1,
    createdAt: board.createdAt || board.updatedAt || null,
    updatedAt: board.updatedAt || board.createdAt || null,
    firstShot: scenesOf(board)[0] ? String(scenesOf(board)[0].shot || '').slice(0, 60) : ''
  }
}

export function getBoard(id) {
  return load().find((b) => b.id === id) || null
}

// 新建或整体更新一张分镜表；scenes 原样存（最少 1 个分镜），同时追加一版 revision + 一条历史。
export function saveBoard({ id, product, style, scenes, note }) {
  if (!Array.isArray(scenes) || !scenes.length) throw new Error('scenes 至少要有一个分镜。')
  const boards = load()
  const normalized = scenes.map((s, i) => ({
    index: i + 1,
    shot: String(s.shot || s.title || `分镜${i + 1}`).slice(0, 100),
    narration: String(s.narration || s.voiceover || '').slice(0, 500),
    visual: String(s.visual || s.picture || '').slice(0, 500),
    duration: Number(s.duration) || null,
  }))
  const prev = id ? boards.find((b) => b.id === id) : null
  const at = new Date().toISOString()
  const boardId = id && prev ? id : id || `sb-${Date.now()}`
  const revisions = (prev?.revisions || []).slice()
  const rev = revisions.length + 1
  revisions.push({
    rev,
    at,
    kind: prev ? 'update' : 'create',
    product: String(product || prev?.product || '').slice(0, 100),
    style: String(style || prev?.style || '').slice(0, 100),
    scenes: normalized,
    note: String(note || '').slice(0, 300)
  })
  if (revisions.length > MAX_REVISIONS) revisions.splice(0, revisions.length - MAX_REVISIONS)
  const board = {
    id: boardId,
    product: String(product ?? prev?.product ?? '').slice(0, 100),
    style: String(style ?? prev?.style ?? '').slice(0, 100),
    scenes: normalized,
    revisions,
    updatedAt: at,
    createdAt: prev?.createdAt || at,
  }
  const next = prev ? boards.map((b) => (b.id === boardId ? board : b)) : [board, ...boards]
  if (next.length > MAX_BOARDS) next.length = MAX_BOARDS
  save(next)

  const duration = sceneDuration(board)
  appendHistory({
    kind: prev ? 'update' : 'create',
    boardId: board.id,
    product: board.product,
    style: board.style,
    sceneCount: normalized.length,
    duration,
    rev,
    summary: prev
      ? `更新「${board.product || board.id}」：${normalized.length} 镜 · ${duration}s（第 ${rev} 版）`
      : `新建「${board.product || board.id}」：${normalized.length} 镜 · ${duration}s`
  })
  return board
}

export function deleteBoard(id) {
  const boards = load()
  const board = boards.find((b) => b.id === id)
  if (!board) return false
  const next = boards.filter((b) => b.id !== id)
  save(next)
  const duration = sceneDuration(board)
  appendHistory({
    kind: 'delete',
    boardId: board.id,
    product: board.product || '',
    style: board.style || '',
    sceneCount: scenesOf(board).length,
    duration,
    rev: (board.revisions || []).length || 1,
    summary: `删除「${board.product || board.id}」：${scenesOf(board).length} 镜`,
    // 留一份快照，「生成历史」里能一键恢复
    snapshot: { product: board.product || '', style: board.style || '', scenes: scenesOf(board), note: '删除前快照' }
  })
  return true
}

// 从删除快照恢复：生成一张新 id 的分镜表（原 id 不复活，避免和后来的表撞号）。
export function restoreFromHistory(eventId) {
  const event = getHistory(eventId)
  if (!event || event.kind !== 'delete' || !event.snapshot) return null
  const board = saveBoard({
    product: event.snapshot.product,
    style: event.snapshot.style,
    scenes: event.snapshot.scenes,
    note: `从 ${String(event.at).slice(0, 16).replace('T', ' ')} 的删除快照恢复`
  })
  return board
}

// 把分镜表渲染成 Seedance 生视频可用的分段提示文本。
export function renderBoard(board) {
  return board.scenes.map((s) =>
    `[分镜 ${s.index}] ${s.shot}${s.duration ? `（${s.duration}s）` : ''}\n画面：${s.visual || '-'}\n口播：${s.narration || '-'}`).join('\n\n')
}

// ---------------------------------------------------------------- 生成历史

function loadHistory() {
  const raw = readJson(HIST_FILE, [])
  return Array.isArray(raw) ? raw : []
}

function appendHistory(event) {
  const list = loadHistory()
  const record = {
    id: `ev-${Date.now().toString(36)}-${list.length + 1}`,
    at: new Date().toISOString(),
    kind: event.kind,
    ...event
  }
  list.unshift(record)
  writeJson(HIST_FILE, list.slice(0, MAX_HISTORY))
  return record
}

export function listHistory({ kind, q, limit = 50 } = {}) {
  let list = loadHistory()
  if (kind && kind !== 'all') list = list.filter((e) => e.kind === kind)
  if (q) {
    const needle = String(q).toLowerCase()
    list = list.filter((e) => `${e.product} ${e.summary} ${e.style}`.toLowerCase().includes(needle))
  }
  return list.slice(0, Math.max(1, Math.min(MAX_HISTORY, Number(limit) || 50)))
}

export function getHistory(id) {
  return loadHistory().find((e) => e.id === id) || null
}

export function clearHistory() {
  writeJson(HIST_FILE, [])
  return true
}

// ---------------------------------------------------------------- 统计

export function stats() {
  const boards = load()
  const history = loadHistory()
  const scenes = boards.reduce((n, b) => n + scenesOf(b).length, 0)
  const duration = boards.reduce((n, b) => n + sceneDuration(b), 0)
  const revisions = boards.reduce((n, b) => n + ((b.revisions || []).length || 1), 0)
  const styles = {}
  for (const b of boards) {
    const key = b.style || '未标注'
    styles[key] = (styles[key] || 0) + 1
  }
  return {
    boards: boards.length,
    scenes,
    duration,
    revisions,
    avgDuration: boards.length ? Math.round((duration / boards.length) * 10) / 10 : 0,
    avgShot: scenes ? Math.round((duration / scenes) * 10) / 10 : 0,
    styles,
    events: history.length,
    lastAt: boards.length ? boards.map((b) => b.updatedAt || '').sort().at(-1) : null,
    lastEventAt: history.length ? history[0].at : null
  }
}
