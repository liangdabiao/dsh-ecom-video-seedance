// 接口验收：起一个本地 http 挂 registerApi 的 handler，用真实 fetch 打一遍工作台接口。
// 不碰真实数据目录（DSH_HOME 指到 .tmp/），不联网。
import { createServer } from 'node:http'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(process.cwd(), '.tmp', 'api-test')
rmSync(ROOT, { recursive: true, force: true })
mkdirSync(ROOT, { recursive: true })
process.env.DSH_HOME = join(ROOT, 'home')

const { registerApi } = await import('../lib/api.js')
const data = await import('../lib/data.js')

let handler = null
const ctx = { get: () => undefined, webServer: { register(cfg) { handler = cfg.handler; return () => {} } } }
const pickStub = { result: null }
registerApi(ctx, { skillDirs: [join(process.cwd(), 'skills')], picker: async () => pickStub.result })
if (!handler) throw new Error('registerApi 没注册 handler')

const server = createServer((req, res) => handler(req, res))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const P = '/ecom-video-seedance'

let failed = 0
const check = (name, ok, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const get = async (path) => {
  const res = await fetch(base + path)
  const text = await res.text()
  return { status: res.status, type: res.headers.get('content-type') || '', text }
}
const postJson = async (path, body) => {
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
  return { status: res.status, json: JSON.parse((await res.text()) || '{}') }
}

try {
  // 先造两张分镜表（一张更新两次 → 3 个版本）
  const b1 = data.saveBoard({ product: '保温杯', style: '痛点开头', scenes: [
    { shot: '痛点开场', narration: '夏天还不敢穿浅色？', visual: '特写汗渍', duration: 3 },
    { shot: '产品登场', narration: '直到遇见它', visual: '产品特写', duration: 4 }
  ], note: '初版' })
  data.saveBoard({ id: b1.id, product: '保温杯 Pro', scenes: [
    { shot: '新开场', narration: 'a', visual: 'b', duration: 2 }
  ], note: '压缩到 1 镜' })
  const b2 = data.saveBoard({ product: '洗发水', style: '自然流种草', scenes: [
    { shot: '晨间', narration: '晨间护理', visual: '窗边光线', duration: 5 }
  ] })

  const ping = await get(`${P}/api/ping`)
  check('ping', ping.status === 200 && /^\d+\.\d+\.\d+/.test(String(JSON.parse(ping.text).version)), ping.text)

  const cat = JSON.parse((await get(`${P}/api/catalog`)).text)
  check('catalog: 分镜表 2 张', cat.ok && cat.boards.length === 2, `boards=${cat.boards.length}`)
  check('catalog: 统计正确', cat.stats.scenes === 2 && cat.stats.revisions === 3 && cat.stats.events === 3, JSON.stringify(cat.stats).slice(0, 120))
  check('catalog: 历史 3 条', cat.history.length === 3, cat.history.map((h) => h.kind).join(','))
  check('catalog: 技能目录', cat.skills.length === 1 && cat.skills[0].name === 'ecom-video-seedance-prompt', cat.skills[0]?.name)

  const board = JSON.parse((await get(`${P}/api/board?id=${encodeURIComponent(b2.id)}`)).text)
  check('board: 详情 + 渲染提示', board.ok && board.rendered.includes('[分镜 1]') && board.board.scenes.length === 1, board.rendered.split('\n')[0])
  const missing = await get(`${P}/api/board?id=nope`)
  check('board: 不存在 404', missing.status === 404, String(missing.status))

  const hi = JSON.parse((await get(`${P}/api/history?kind=update`)).text)
  check('history: 按类型过滤', hi.list.length === 1 && hi.list[0].boardId === b1.id, hi.list[0]?.summary)

  // 删除 → 历史留快照 → 恢复
  const del = await postJson(`${P}/api/board/remove`, { id: b2.id })
  check('board/remove', del.status === 200 && del.json.ok === true)
  const afterDel = JSON.parse((await get(`${P}/api/catalog`)).text)
  const delEvent = afterDel.history.find((e) => e.kind === 'delete')
  check('删除留快照', Boolean(delEvent && delEvent.snapshot && delEvent.snapshot.scenes.length === 1), delEvent?.id)
  const restore = await postJson(`${P}/api/board/restore`, { eventId: delEvent.id })
  check('board/restore', restore.status === 200 && restore.json.board.scenes.length === 1, restore.json.summary)
  const afterRestore = JSON.parse((await get(`${P}/api/catalog`)).text)
  check('恢复后分镜表 3 张（新 id）', afterRestore.boards.length === 2 && afterRestore.boards.some((b) => b.id === restore.json.board.id))

  // 静态页面
  const page = await get(`${P}/`)
  check('静态页面 index.html', page.status === 200 && page.text.includes('带货视频拆解'), `${page.status} ${page.type}`)
  const css = await get(`${P}/app.css`)
  check('静态页面 app.css', css.status === 200 && css.type.includes('css'))
  const js = await get(`${P}/app.js`)
  check('静态页面 app.js', js.status === 200 && js.text.includes('renderHistory'))
  const traversal = await get(`${P}/..%2f..%2fpackage.json`)
  check('静态页面越界被拒', traversal.status === 404, String(traversal.status))

  // ── 选视频弹窗（picker 注入 stub，不真的弹框）
  const videoFile = join(ROOT, 'demo.mp4')
  writeFileSync(videoFile, 'fake', 'utf8')
  pickStub.result = { ok: true, path: videoFile }
  const picked = await postJson(`${P}/api/pick`, { title: '选择带货视频' })
  check('pick: 选中文件返回绝对路径', picked.status === 200 && picked.json.ok === true && picked.json.path === videoFile && picked.json.isFile === true, picked.json.path)
  pickStub.result = { ok: false, cancelled: true }
  const cancelled = await postJson(`${P}/api/pick`, {})
  check('pick: 取消', cancelled.json.ok === false && cancelled.json.cancelled === true)
  pickStub.result = { ok: false, error: 'dialog failed' }
  const pickErr = await postJson(`${P}/api/pick`, {})
  check('pick: 出错透传', pickErr.json.ok === false && pickErr.json.error === 'dialog failed')
  const cap = JSON.parse((await get(`${P}/api/catalog`)).text)
  check('catalog: capabilities.pickVideo', typeof cap.capabilities.pickVideo === 'boolean', String(cap.capabilities.pickVideo))

  // 兼容旧面板
  const legacyBoards = JSON.parse((await get(`${P}/api/boards`)).text)
  check('兼容 /api/boards', Array.isArray(legacyBoards.boards) && legacyBoards.boards.length === 2)
  const legacySkills = JSON.parse((await get(`${P}/api/skills`)).text)
  check('兼容 /api/skills', legacySkills.count === 1)
  const legacyHealth = JSON.parse((await get(`${P}/api/health`)).text)
  check('兼容 /api/health', legacyHealth.ok === true)

  // 清空历史
  const cleared = await postJson(`${P}/api/history/clear`, {})
  const afterClear = JSON.parse((await get(`${P}/api/catalog`)).text)
  check('history/clear', cleared.json.ok === true && afterClear.history.length === 0 && afterClear.boards.length === 2)
} finally {
  server.close()
}

console.log(failed ? `\n${failed} 项失败` : `\n全部通过`)
process.exit(failed ? 1 : 0)
