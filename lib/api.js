// 面板数据面：/ecom-video-seedance 前缀路由。
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readDir } from './skills.js'
import { listBoards } from './data.js'

const BASE = '/ecom-video-seedance'
const SKILL_DIRS = [join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')]

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

export function requestRejection(ctx, req) {
  const connection = ctx.get('connection')
  if (typeof connection?.requestRejection !== 'function') return false // dsh 0.2.x 宿主已 token 鉴权，服务缺席时放行（fail-closed 会把面板永久 403）
  return connection.requestRejection({ headers: req.headers })
}

export function registerApi(ctx, { skillDirs }) {
  return ctx.webServer.register({
    kind: 'prefix',
    path: BASE,
    async handler(req, res) {
      try {
        const rejection = requestRejection(ctx, req)
        if (typeof rejection === 'number') return json(res, rejection, { error: '未授权' })
        const url = new URL(req.url, 'http://x')
        const path = url.pathname.slice(BASE.length) || '/'

        if (path === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true })
        if (path === '/api/boards' && req.method === 'GET') {
          return json(res, 200, { boards: listBoards() })
        }
        if (path === '/api/skills' && req.method === 'GET') {
          const skills = skillDirs.flatMap((dir) => readDir(dir)).map((s) => ({ name: s.name, description: s.description }))
          return json(res, 200, { count: skills.length, skills })
        }
        json(res, 404, { error: 'not found' })
      } catch (err) {
        json(res, 500, { error: err?.message || '内部错误' })
      }
    },
  })
}
