// 带货视频拆解 · 分镜表持久化（$DSH_HOME/ecom-video-seedance/）。
// storyboards.json：[{ id, product, style, scenes: [{ index, shot, narration, duration, visual }], updatedAt }]
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DATA_DIR = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'ecom-video-seedance')
const SB_FILE = join(DATA_DIR, 'storyboards.json')
const MAX_BOARDS = 100

export function ensureDirs() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
}

function load() {
  try {
    const raw = JSON.parse(readFileSync(SB_FILE, 'utf8'))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function save(boards) {
  ensureDirs()
  const tmp = `${SB_FILE}.tmp`
  writeFileSync(tmp, JSON.stringify(boards, null, 2), 'utf8')
  renameSync(tmp, SB_FILE)
}

export function listBoards() {
  return load()
}

export function getBoard(id) {
  return load().find((b) => b.id === id) || null
}

// saveBoard：新建或整体更新一张分镜表（scenes 原样存储，最少 1 个分镜）。
export function saveBoard({ id, product, style, scenes }) {
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
  const board = {
    id: id || `sb-${Date.now()}`,
    product: String(product || '').slice(0, 100),
    style: String(style || '').slice(0, 100),
    scenes: normalized,
    updatedAt: new Date().toISOString(),
    createdAt: prev?.createdAt || new Date().toISOString(),
  }
  const next = prev ? boards.map((b) => (b.id === id ? board : b)) : [board, ...boards]
  if (next.length > MAX_BOARDS) next.length = MAX_BOARDS
  save(next)
  return board
}

export function deleteBoard(id) {
  const boards = load()
  const next = boards.filter((b) => b.id !== id)
  if (next.length === boards.length) return false
  save(next)
  return true
}

// 把分镜表渲染成 Seedance 生视频可用的分段提示文本。
export function renderBoard(board) {
  return board.scenes.map((s) =>
    `[分镜 ${s.index}] ${s.shot}${s.duration ? `（${s.duration}s）` : ''}\n画面：${s.visual || '-'}\n口播：${s.narration || '-'}`).join('\n\n')
}
