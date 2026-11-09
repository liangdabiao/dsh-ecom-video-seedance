// 工作台数据面：/ecom-video-seedance 前缀路由。
//   GET  /                     工作台页面（lab/ 静态资源，布局对齐「投资尽调」）
//   GET  /api/catalog          分镜表列表 + 生成历史 + 统计 + 技能目录
//   GET  /api/board?id=        单张分镜表（含每版 revision + 渲染好的 Seedance 分段提示）
//   GET  /api/history?kind=&q= 生成历史（新建/更新/删除/恢复）
//   POST /api/board/remove     删分镜表（留删除快照）
//   POST /api/board/restore    从删除快照恢复
//   POST /api/history/clear    清空历史（不动分镜表）
//   兼容旧面板：/api/health、/api/boards、/api/skills
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readDir } from './skills.js'
import { pickFile, pickerSupported } from './picker.js'
import {
  KIND_LABEL, boardSummary, deleteBoard, getBoard, getHistory, listBoards,
  listHistory, renderBoard, restoreFromHistory, clearHistory, stats
} from './data.js'

const BASE = '/ecom-video-seedance'
const LAB = fileURLToPath(new URL('../lab/', import.meta.url))
const SKILL_DIRS = [fileURLToPath(new URL('../skills/', import.meta.url))]

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.md': 'text/markdown; charset=utf-8'
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

export function requestRejection(ctx, req) {
  const connection = ctx.get('connection')
  if (typeof connection?.requestRejection !== 'function') return false // dsh 0.2.x 宿主已 token 鉴权，服务缺席时放行（fail-closed 会把面板永久 403）
  return connection.requestRejection({ headers: req.headers })
}

function version() {
  try { return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version } catch { return null }
}

// 只放行 lab/ 里的文件：拒绝 ..、点开头的路径和指到目录外的符号链接
function safeLabFile(rel) {
  if (!rel || String(rel).split('/').some((p) => p.startsWith('.'))) return null
  let base
  try { base = realpathSync(LAB) } catch { return null }
  const file = normalize(join(base, rel))
  if (!file.startsWith(base + sep) || !existsSync(file)) return null
  const real = realpathSync(file)
  return real.startsWith(base + sep) && statSync(real).isFile() ? real : null
}

function serve(req, res, file) {
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'content-length': statSync(file).size,
    'cache-control': 'no-cache'
  })
  if (req.method === 'HEAD') return res.end()
  createReadStream(file).pipe(res)
}

// 只接受同源页面发来的 JSON
function readJson(req, max = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const origin = req.headers.origin
    if (req.method !== 'POST') return reject(Object.assign(new Error('method'), { status: 405 }))
    if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return reject(Object.assign(new Error('需要 JSON'), { status: 415 }))
    if (origin && origin.replace(/^https?:\/\//, '') !== req.headers.host) return reject(Object.assign(new Error('origin'), { status: 403 }))
    let size = 0
    const chunks = []
    req.on('data', (c) => { size += c.length; if (size > max) req.destroy(); else chunks.push(c) })
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch (e) { reject(Object.assign(e, { status: 400 })) } })
    req.on('error', reject)
  })
}

function skillCatalog() {
  return SKILL_DIRS.flatMap((dir) => readDir(dir)).map((s) => ({
    name: s.name,
    description: s.description,
    dirName: s.dirName,
    bodyChars: String(s.body || '').length
  }))
}

function catalog() {
  const boards = listBoards()
  const history = listHistory({ limit: 60 })
  return {
    version: version(),
    platform: process.platform,
    capabilities: { pickVideo: pickerSupported() },
    boards: boards.map(boardSummary),
    history,
    stats: stats(),
    kinds: KIND_LABEL,
    skills: skillCatalog()
  }
}

export function registerApi(ctx, { skillDirs = SKILL_DIRS, picker = pickFile } = {}) {
  return ctx.webServer.register({
    kind: 'prefix',
    path: BASE,
    async handler(req, res) {
      try {
        const rejection = requestRejection(ctx, req)
        if (typeof rejection === 'number') return json(res, rejection, { error: '未授权' })

        const url = new URL(req.url, 'http://x')
        const path = decodeURIComponent(url.pathname.slice(BASE.length)) || '/'

        // ---- API ----
        if (path === '/api/ping' && req.method === 'GET') return json(res, 200, { ok: true, version: version() })
        if ((path === '/api/health' || path === '/health') && req.method === 'GET') return json(res, 200, { ok: true, version: version() })

        if (path === '/api/catalog' && req.method === 'GET') {
          return json(res, 200, { ok: true, ...catalog() })
        }

        if (path === '/api/board' && req.method === 'GET') {
          const id = url.searchParams.get('id') || ''
          const board = getBoard(id)
          if (!board) return json(res, 404, { ok: false, error: '没有这张分镜表' })
          return json(res, 200, { ok: true, board, rendered: renderBoard(board) })
        }

        if (path === '/api/history' && req.method === 'GET') {
          const list = listHistory({
            kind: url.searchParams.get('kind') || 'all',
            q: url.searchParams.get('q') || '',
            limit: url.searchParams.get('limit') || 100
          })
          return json(res, 200, { ok: true, list, kinds: KIND_LABEL })
        }

        if (path === '/api/board/remove' && req.method === 'POST') {
          const body = await readJson(req).catch((err) => err)
          if (body instanceof Error) return json(res, body.status || 400, { ok: false, error: body.message })
          const id = String(body.id || '')
          const removed = deleteBoard(id)
          return json(res, removed ? 200 : 404, { ok: removed, id, error: removed ? undefined : '没有这张分镜表' })
        }

        if (path === '/api/board/restore' && req.method === 'POST') {
          const body = await readJson(req).catch((err) => err)
          if (body instanceof Error) return json(res, body.status || 400, { ok: false, error: body.message })
          const eventId = String(body.eventId || '')
          const event = getHistory(eventId)
          if (!event || event.kind !== 'delete') return json(res, 400, { ok: false, error: '只有删除记录能恢复（要传 eventId）' })
          const board = restoreFromHistory(eventId)
          if (!board) return json(res, 400, { ok: false, error: '这条记录没有快照' })
          return json(res, 200, { ok: true, board, summary: `已恢复成「${board.product || board.id}」（${board.scenes.length} 镜）` })
        }

        if (path === '/api/history/clear' && req.method === 'POST') {
          const body = await readJson(req).catch((err) => err)
          if (body instanceof Error) return json(res, body.status || 400, { ok: false, error: body.message })
          clearHistory()
          return json(res, 200, { ok: true })
        }

        // 弹系统原生「打开文件」对话框选视频；返回绝对路径给页面填进输入框
        if (path === '/api/pick' && req.method === 'POST') {
          const body = await readJson(req).catch((err) => err)
          if (body instanceof Error) return json(res, body.status || 400, { ok: false, error: body.message })
          if (!pickerSupported()) {
            return json(res, 200, { ok: false, unsupported: true, error: '当前系统暂不支持弹窗选文件，请手动填写路径' })
          }
          const picked = await picker({ title: String(body.title || '选择带货视频') })
          if (!picked.ok) return json(res, 200, { ok: false, cancelled: Boolean(picked.cancelled), error: picked.error || '' })
          const target = String(picked.path)
          const exists = existsSync(target)
          let isFile = false
          try { isFile = exists && statSync(target).isFile() } catch { isFile = false }
          return json(res, 200, { ok: true, path: target, exists, isFile })
        }

        // ---- 兼容旧面板 ----
        if (path === '/api/boards' && req.method === 'GET') {
          return json(res, 200, { boards: listBoards() })
        }
        if (path === '/api/skills' && req.method === 'GET') {
          const skills = skillCatalog()
          return json(res, 200, { count: skills.length, skills })
        }

        if (path.startsWith('/api/')) return json(res, 404, { ok: false, error: 'not found' })

        // ---- 静态页面 ----
        if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { ok: false, error: 'method' })
        const rel = path === '/' ? 'index.html' : path.replace(/^\/+/, '')
        const file = safeLabFile(rel)
        return file ? serve(req, res, file) : json(res, 404, { ok: false, error: 'not found' })
      } catch (err) {
        return json(res, 500, { ok: false, error: String(err?.message || '内部错误') })
      }
    },
  })
}
