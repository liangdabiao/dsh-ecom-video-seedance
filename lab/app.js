// 带货视频拆解工作台 · 页面逻辑（无框架，hash 路由 + fetch /api/*）
// 布局对齐「投资尽调」：左侧 rail，右侧按路由渲染；
// 「拆解 / 在对话里改」通过 postMessage 让宿主开新对话并填好指令。
const app = document.getElementById('app')
const navBoards = document.getElementById('nav-boards')
const navHistory = document.getElementById('nav-history')
const railFoot = document.getElementById('rail-foot')
const viewer = document.getElementById('viewer')
const viewerTitle = document.getElementById('viewer-title')
const viewerBody = document.getElementById('viewer-body')
const viewerCopy = document.getElementById('viewer-copy')
const toastEl = document.getElementById('toast')

// 页面挂在 /ecom-video-seedance/ 下，接口同前缀（不能用 '/api/...' 根绝对路径，会打到宿主）
const BASE = location.pathname.replace(/\/+$/, '') || '/ecom-video-seedance'

const state = { catalog: null, kind: 'all', q: '', current: null }

const KIND = { create: '新建', update: '更新', delete: '删除', restore: '恢复' }
const KIND_TONE = { create: 'ok', update: 'solid', delete: 'bad', restore: 'gold' }
const STYLES = [
  ['忠实复刻', 'faithful', '照原片的镜头、节奏、光影写提示词'],
  ['自然流种草', 'organic', '弱化广告感，像真人日常分享'],
  ['付费流千川', 'paid', '强钩子快节奏，冲转化的投放素材']
]
const SASC = [
  ['S', 'Subject 主体', '画面里是谁 / 是什么产品，长什么样', '两位深棕肤色女性，黑色长直发，深灰运动背心'],
  ['A', 'Action 动作', '在做什么，按时间顺序一步步写', '双手伸入 → 分开头发 → 向下滑动 → 滑至发尾'],
  ['C', 'Context 场景', '在哪里，光怎么打，有什么细节', '美发沙龙，镜前柔光侧逆光'],
  ['S', 'Shot 镜头', '景别 / 视角 / 景深 / 运镜', '特写，平视，浅景深，固定镜头'],
  ['C', 'Color 情绪', '色调 / 饱和度 / 对比度', '冷色调，高饱和，对比适中']
]

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const date = (iso) => (iso ? String(iso).slice(0, 10) : '')
const shortTime = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const kindLabel = (k) => KIND[k] || k || ''
const sec = (n) => (n ? `${Math.round(n * 10) / 10}s` : '—')

async function api(path, opts) {
  const res = await fetch(BASE + path, opts)
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.ok === false) throw new Error(body.error || `请求失败（${res.status}）`)
  return body
}

async function post(path, payload) {
  return api(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload || {})
  })
}

function copy(text) {
  const value = String(text || '')
  if (!value) return
  try { navigator.clipboard?.writeText(value) } catch { /* ignore */ }
  toast('已复制到剪贴板')
}

// ---------------------------------------------------------------- 宿主通信 / 主题

addEventListener('message', (e) => {
  if (e.origin !== location.origin) return
  const m = e.data
  if (m && m.type === 'ecom-video-seedance:scheme' && m.scheme) document.documentElement.dataset.scheme = m.scheme
  if (m && m.type === 'ecom-video-seedance:start-failed') toast('开新对话失败：' + (m.message || ''))
})

function start(prompt) {
  try {
    parent.postMessage({ type: 'ecom-video-seedance:start', prompt }, location.origin)
    toast('已把任务填进新对话，确认后发送即可')
  } catch {
    toast('当前环境开不了新对话，请手动复制：\n' + prompt)
  }
}

let toastTimer
function toast(text) {
  toastEl.textContent = text
  toastEl.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3400)
}

// ---------------------------------------------------------------- viewer

let viewerCopyText = ''
function openViewer({ title, copyText = '', html = '' }) {
  viewer.hidden = false
  viewerTitle.textContent = title || ''
  viewerBody.innerHTML = html
  viewerCopy.hidden = !copyText
  viewerCopyText = copyText
}
function closeViewer() {
  viewer.hidden = true
  viewerBody.innerHTML = ''
}
document.getElementById('viewer-close').addEventListener('click', closeViewer)
viewer.addEventListener('click', (e) => { if (e.target === viewer) closeViewer() })
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !viewer.hidden) closeViewer() })
viewerCopy.addEventListener('click', () => copy(viewerCopyText))

// ---------------------------------------------------------------- 路由

const route = () => location.hash.replace(/^#\/?/, '').split('?')[0]

function render() {
  const r = route()
  document.querySelectorAll('.nav a').forEach((a) => {
    const v = a.dataset.view
    const on = (v === 'home' && r === '') || (v === 'boards' && (r.startsWith('boards') || r.startsWith('b/'))) ||
      (v === 'history' && r.startsWith('history')) || (v === 'new' && r === 'new') || (v === 'guide' && r === 'guide')
    if (on) a.setAttribute('aria-current', 'true')
    else a.removeAttribute('aria-current')
  })
  if (r === '') return renderHome()
  if (r.startsWith('boards')) return renderBoards()
  if (r.startsWith('b/')) return renderBoard(decodeURIComponent(r.slice(2)))
  if (r.startsWith('history')) return renderHistory()
  if (r === 'new') return renderNew()
  if (r === 'guide') return renderGuide()
  return renderHome()
}

function wrap(html) {
  app.innerHTML = `<div class="wrap">${html}</div>`
}

function bindGo() {
  app.querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', () => { location.hash = el.dataset.go }))
}
function bindHistory() {
  app.querySelectorAll('[data-ev]').forEach((el) => el.addEventListener('click', () => openEvent(el.dataset.ev)))
}

// ---------------------------------------------------------------- 概览

function renderHome() {
  const d = state.catalog
  const s = d.stats
  wrap(`
    <header class="head">
      <span class="eyebrow">Ecom Video → Seedance Prompt</span>
      <h1>带货视频拆解工作台</h1>
      <p>把一条带货爆款视频「看懂」（拆成镜头级分镜表），再「翻译」成即梦 / Seedance 能直接执行的提示词。
         每保存一次分镜表就多一版，新建 / 更新 / 删除都记进生成历史。</p>
    </header>

    <div class="stats">
      <div class="stat accent"><b>${s.boards}</b><small>分镜表</small></div>
      <div class="stat"><b>${s.scenes}</b><small>镜头合计</small></div>
      <div class="stat jade"><b>${sec(s.duration)}</b><small>时长合计</small></div>
      <div class="stat"><b>${s.revisions}</b><small>版本数</small></div>
      <div class="stat gold"><b>${s.events}</b><small>历史事件</small></div>
    </div>

    <div class="sec-head"><h2>最近分镜</h2><a class="more" href="#/boards">全部 →</a></div>
    ${d.boards.length ? `<div class="grid">${d.boards.slice(0, 3).map(boardCard).join('')}</div>`
      : `<div class="empty-box"><b>还没有分镜表</b>
          在对话里说「拆解这条带货视频：&lt;视频路径&gt;」或「给保温杯写一条 15 秒种草分镜」，
          模型会用 seedance_storyboard 存下来，这里就会出现卡片。</div>`}

    <div class="sec-head"><h2>最近动作</h2><a class="more" href="#/history">全部 →</a>
      <span class="sub">新建 / 更新 / 删除 / 恢复各算一条</span></div>
    ${d.history.length ? `<div class="panel">${d.history.slice(0, 6).map(eventRow).join('')}</div>`
      : `<div class="empty-box"><b>还没有历史记录</b>保存或删除一张分镜表就会留档。</div>`}

    <div class="sec-head"><h2>下一步</h2></div>
    <div class="grid">
      <div class="card" data-go="#/new">
        <div class="card-top"><span class="dot" style="background:var(--accent)"></span><span class="card-title">拆解一条新视频</span></div>
        <div class="card-sub">填视频路径和产品信息，打开新对话并带上「拆解 → 复刻提示词 → 存分镜表」指令</div>
      </div>
      <div class="card" data-go="#/boards">
        <div class="card-top"><span class="dot" style="background:var(--jade)"></span><span class="card-title">翻之前的拆解</span></div>
        <div class="card-sub">镜头表、Seedance 分段提示、每个版本改了什么</div>
      </div>
      <div class="card" data-go="#/history">
        <div class="card-top"><span class="dot" style="background:var(--gold)"></span><span class="card-title">看生成历史</span></div>
        <div class="card-sub">谁在什么时候改了哪张表；删掉的可以一键恢复</div>
      </div>
      <div class="card" data-go="#/guide">
        <div class="card-top"><span class="dot" style="background:var(--ink-3)"></span><span class="card-title">S-A-C-S-C 规范</span></div>
        <div class="card-sub">五个必填项、三步流程、常见翻车点</div>
      </div>
    </div>
  `)
  bindGo()
  bindHistory()
}

function boardCard(b) {
  return `<div class="card" data-go="#/b/${encodeURIComponent(b.id)}">
    <div class="card-top">
      <span class="dot" style="background:${b.style ? 'var(--accent)' : 'var(--grey)'}"></span>
      <span class="card-title">${esc(b.product || b.id)}</span>
      ${b.style ? `<span class="badge">${esc(b.style)}</span>` : ''}
      ${b.rev > 1 ? `<span class="badge grey">第 ${b.rev} 版</span>` : ''}
    </div>
    <div class="card-sub muted">${b.sceneCount} 镜 · ${sec(b.duration)} · ${b.firstShot ? esc(b.firstShot) : '—'}</div>
    <div class="card-foot">
      <span>${esc(b.id)}</span>
      <span class="grow"></span>
      <span>${date(b.updatedAt)}</span>
    </div>
  </div>`
}

function eventRow(e) {
  return `<div class="hrow" data-ev="${esc(e.id)}">
    <span class="when">${esc(shortTime(e.at))}</span>
    <span class="badge ${KIND_TONE[e.kind] || 'grey'}">${esc(kindLabel(e.kind))}</span>
    <span class="what">
      <b>${esc(e.product || e.boardId)}</b>
      <div>${esc(e.summary || '')}</div>
    </span>
    <span class="card-sub muted" style="font-size:11px">${e.sceneCount ? `${e.sceneCount} 镜 · ${sec(e.duration)}` : ''}</span>
  </div>`
}

// ---------------------------------------------------------------- 我的分镜

function renderBoards() {
  const d = state.catalog
  const needle = state.q.trim().toLowerCase()
  const boards = d.boards.filter((b) => !needle || `${b.product} ${b.style} ${b.firstShot} ${b.id}`.toLowerCase().includes(needle))
  wrap(`
    <header class="head">
      <h1>我的分镜</h1>
      <p>共 ${d.boards.length} 张分镜表、${d.stats.scenes} 个镜头。点开看镜头表、Seedance 分段提示和版本变化。</p>
    </header>
    <div class="toolbar">
      <input class="search" id="q" placeholder="搜产品 / 风格 / 首个镜头" value="${esc(state.q)}">
      <span class="badge grey">平均每镜 ${sec(d.stats.avgShot)}</span>
      <span class="badge grey">平均每张 ${sec(d.stats.avgDuration)}</span>
    </div>
    ${boards.length ? `<div class="grid">${boards.map(boardCard).join('')}</div>`
      : `<div class="empty-box"><b>${needle ? '没有匹配的分镜表' : '还没有分镜表'}</b>
          ${needle ? '换个关键词试试。' : '去「拆解 / 创作」发起一次，模型会把结果存进来。'}</div>`}
  `)
  const q = document.getElementById('q')
  q.addEventListener('input', (e) => {
    state.q = e.target.value
    renderBoards()
    setTimeout(() => { const n = document.getElementById('q'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length) } }, 0)
  })
  bindGo()
}

// ---------------------------------------------------------------- 分镜详情

async function renderBoard(id) {
  app.innerHTML = '<div class="loading">读取分镜表…</div>'
  let data
  try {
    data = await api(`/api/board?id=${encodeURIComponent(id)}`)
  } catch (err) {
    wrap(`<div class="empty-box"><b>读不到这张分镜表</b>${esc(err.message)}</div>`)
    return
  }
  state.current = data
  const b = data.board
  const scenes = b.scenes || []
  const duration = scenes.reduce((n, s) => n + (Number(s.duration) || 0), 0)
  const revisions = (b.revisions || []).slice().reverse()
  wrap(`
    <header class="head">
      <a class="card-sub" href="#/boards">← 我的分镜</a>
      <div class="detail-head" style="margin-top:6px">
        <h1>${esc(b.product || b.id)}</h1>
        ${b.style ? `<span class="badge">${esc(b.style)}</span>` : ''}
        <span class="badge grey">${scenes.length} 镜 · ${sec(duration)}</span>
        <span class="badge grey">第 ${(b.revisions || []).length || 1} 版</span>
      </div>
      <p style="margin-top:6px">${esc(b.id)} · 建 ${esc(shortTime(b.createdAt))} · 改 ${esc(shortTime(b.updatedAt))}</p>
    </header>

    <div class="actions" style="margin-bottom:14px">
      <button class="btn" id="copy-render">复制 Seedance 分段提示</button>
      <button class="btn ghost" id="copy-json">复制分镜 JSON</button>
      <button class="btn ghost" id="continue">在对话里改这张表</button>
      <button class="btn danger" id="remove">删除</button>
    </div>

    <div class="sec-head"><h2>镜头表</h2><span class="sub">口播 = 配音文案；画面 = 提示词要还原的内容</span></div>
    <div class="panel" style="padding:6px 0">
      <table class="shots">
        <thead><tr><th style="width:42px">镜</th><th>镜头</th><th>画面</th><th>口播</th><th style="width:52px">时长</th></tr></thead>
        <tbody>
          ${scenes.map((s) => `<tr>
            <td class="num">${s.index}</td>
            <td>${esc(s.shot || '')}</td>
            <td class="visual">${esc(s.visual || '')}</td>
            <td class="narration">${esc(s.narration || '')}</td>
            <td class="sec">${s.duration ? `${s.duration}s` : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div class="sec-head"><h2>Seedance 分段提示</h2><span class="sub">可直接粘进即梦，逐镜生成</span></div>
    <div class="panel"><pre class="pre">${esc(data.rendered || '')}</pre></div>

    <div class="sec-head"><h2>版本历史</h2><span class="sub">每保存一次多一版</span></div>
    ${revisions.length ? `<div class="panel"><ul class="rev-list">
      ${revisions.map((r) => `<li>
        <span class="rev">v${r.rev}</span>
        <span class="grow"><b>${esc(r.product || '')}</b>${r.style ? ` · ${esc(r.style)}` : ''} · ${(r.scenes || []).length} 镜 · ${sec((r.scenes || []).reduce((n, s) => n + (Number(s.duration) || 0), 0))}${r.note ? ` · ${esc(r.note)}` : ''}</span>
        <span class="card-sub muted" style="font-size:11px">${esc(shortTime(r.at))}</span>
      </li>`).join('')}
    </ul></div>` : '<div class="empty-box"><b>这张表还没有版本记录</b>再保存一次（save 带同一个 id）就会多一版。</div>'}
  `)

  document.getElementById('copy-render').addEventListener('click', () => copy(data.rendered))
  document.getElementById('copy-json').addEventListener('click', () => copy(JSON.stringify(scenes, null, 2)))
  document.getElementById('continue').addEventListener('click', () => start(
    `继续改这张分镜表「${b.product || b.id}」（id=${b.id}）。先用 seedance_storyboard action=get id=${b.id} 看现在的 ${scenes.length} 个镜头，` +
    `按我的要求逐镜改（保持 S-A-C-S-C 齐全、每镜 ≤200 字、带约束尾和负面词），改完用 action=save 带同一个 id 保存，note 写清这次改了什么。`))
  document.getElementById('remove').addEventListener('click', async () => {
    if (!confirm(`删除分镜表「${b.product || b.id}」？生成历史里会留快照，可以恢复。`)) return
    try {
      await post('/api/board/remove', { id: b.id })
      await boot()
      location.hash = '#/boards'
      toast('已删除（可在生成历史里恢复）')
    } catch (err) { toast('删除失败：' + err.message) }
  })
}

// ---------------------------------------------------------------- 生成历史

function renderHistory() {
  const d = state.catalog
  const needle = state.q.trim().toLowerCase()
  const list = d.history.filter((e) => {
    const hitKind = state.kind === 'all' || e.kind === state.kind
    const hitQ = !needle || `${e.product} ${e.summary} ${e.style}`.toLowerCase().includes(needle)
    return hitKind && hitQ
  })
  wrap(`
    <header class="head">
      <h1>生成历史</h1>
      <p>每次保存 / 删除 / 恢复分镜表都留一条：${d.stats.events} 条记录。点任意一行看当次详情，删除的记录可以一键恢复。</p>
    </header>
    <div class="toolbar">
      ${['all', 'create', 'update', 'delete', 'restore'].map((k) => `
        <button class="pill" data-kind="${k}" aria-pressed="${state.kind === k}">${k === 'all' ? '全部' : KIND[k]}</button>`).join('')}
      <input class="search" id="h-q" placeholder="搜产品 / 摘要" value="${esc(state.q)}">
    </div>
    ${list.length ? `<div class="panel">${list.map(eventRow).join('')}</div>`
      : `<div class="empty-box"><b>没有匹配的记录</b>换个筛选条件，或先去拆一条视频。</div>`}
    <div class="toolbar" style="margin-top:16px">
      <button class="btn ghost small" id="clear">清空历史</button>
      <span class="card-sub muted" style="font-size:11px">只删记录，不动分镜表本身。</span>
    </div>
  `)
  app.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => { state.kind = b.dataset.kind; renderHistory() }))
  const q = document.getElementById('h-q')
  q.addEventListener('input', (e) => {
    state.q = e.target.value
    if (q._t) clearTimeout(q._t)
    q._t = setTimeout(() => renderHistory(), 240)
  })
  document.getElementById('clear').addEventListener('click', async () => {
    if (!confirm('清空全部生成历史？（分镜表不会删）')) return
    try {
      await post('/api/history/clear', {})
      await boot()
      toast('历史已清空')
    } catch (err) { toast('清空失败：' + err.message) }
  })
  bindHistory()
}

function openEvent(id) {
  const e = (state.catalog.history || []).find((x) => x.id === id)
  if (!e) { toast('找不到这条记录'); return }
  const snap = e.snapshot
  openViewer({
    title: `${kindLabel(e.kind)} · ${e.product || e.boardId}`,
    copyText: e.summary || '',
    html: `
      <div class="detail-head" style="margin-bottom:8px">
        <h1 style="font-size:19px;margin:0">${esc(e.product || e.boardId)}</h1>
        <span class="badge ${KIND_TONE[e.kind] || 'grey'}">${esc(kindLabel(e.kind))}</span>
        ${e.style ? `<span class="badge grey">${esc(e.style)}</span>` : ''}
        <span class="badge grey">${e.sceneCount || 0} 镜 · ${sec(e.duration)}</span>
        ${e.rev ? `<span class="badge grey">第 ${e.rev} 版</span>` : ''}
      </div>
      <div class="card-sub muted" style="margin-bottom:10px">${esc(shortTime(e.at))} · ${esc(e.summary || '')} · event ${esc(e.id)}</div>
      ${snap && snap.scenes ? `
        <div class="card-sub" style="margin-bottom:4px"><b>删除前快照（${snap.scenes.length} 镜）</b></div>
        <div class="panel" style="padding:6px 0"><table class="shots">
          <thead><tr><th style="width:42px">镜</th><th>镜头</th><th>画面</th><th>口播</th><th style="width:52px">时长</th></tr></thead>
          <tbody>${snap.scenes.map((s) => `<tr>
            <td class="num">${s.index}</td><td>${esc(s.shot || '')}</td><td class="visual">${esc(s.visual || '')}</td>
            <td class="narration">${esc(s.narration || '')}</td><td class="sec">${s.duration ? `${s.duration}s` : '—'}</td></tr>`).join('')}
          </tbody></table></div>
        <div class="actions" style="margin-top:12px"><button class="btn" id="restore">恢复成新分镜表</button></div>`
        : e.kind === 'delete' ? '<div class="note warn">这条删除记录没有快照（旧版本留下的记录），恢复不了。</div>' : ''}
    `
  })
  const restore = document.getElementById('restore')
  if (restore) restore.addEventListener('click', async () => {
    try {
      const r = await post('/api/board/restore', { eventId: e.id })
      closeViewer()
      await boot()
      location.hash = '#/b/' + encodeURIComponent(r.board.id)
      toast(r.summary || '已恢复')
    } catch (err) { toast('恢复失败：' + err.message) }
  })
}

// ---------------------------------------------------------------- 拆解 / 创作

function renderNew() {
  wrap(`
    <header class="head">
      <span class="eyebrow">Analyze → Replicate → Save</span>
      <h1>拆解 / 创作</h1>
      <p>填好之后会打开一个新对话，指令已经写全：拆镜头 → 生成 S-A-C-S-C 提示词包 → 存分镜表（侧栏可回看、可改版）。</p>
    </header>

    <div class="panel">
      <div class="form">
        <label class="fld full">视频路径 / 链接（有原片就填，直接创作可留空）
          <div class="input-row">
            <input id="f-video" placeholder="如 D:\\videos\\爆款.mp4 或 https://...">
            <button class="btn ghost" id="f-pick" title="打开系统的「打开文件」对话框">浏览…</button>
          </div>
          <span class="fld-hint" id="pick-hint">点「浏览…」可以直接在资源管理器里挑视频，不用手打路径。</span>
        </label>
        <label class="fld">产品信息
          <input id="f-product" placeholder="品牌名，主打卖点，色号/规格">
        </label>
        <label class="fld">风格
          <select id="f-style">
            ${STYLES.map(([label, value, desc]) => `<option value="${value}">${label} — ${desc}</option>`).join('')}
          </select>
        </label>
        <label class="fld">目标时长（秒）<input id="f-duration" type="number" min="4" max="60" value="15"></label>
        <label class="fld full">补充要求（可选）
          <textarea id="f-note" rows="3" placeholder="如：口播要口语化、不要出现真人脸、突出便携、结尾带促单"></textarea>
        </label>
      </div>
      <div class="actions" style="margin-top:14px">
        <button class="btn" id="f-analyze">拆解这条视频 →</button>
        <button class="btn ghost" id="f-create">没有原片，直接写一条 →</button>
      </div>
      <div class="note" style="margin-top:12px">
        拆解由 <b>agent 直接看帧</b>完成：<code>analyze.py</code> 只用 ffmpeg 抽帧 + 场景切换检测切镜头，
        再用 <code>replicate.py</code> 做字数/字段硬校验并渲染提示词包。
        <b>零 API 密钥</b>，只需要 PATH 里的 ffmpeg。没有原片也能直接按产品写脚本。
      </div>
    </div>

    <div class="sec-head"><h2>没有原片时怎么问</h2></div>
    <div class="panel card-sub">
      直接填产品信息和风格，点「没有原片，直接写一条」；模型会按 S-A-C-S-C 从零写镜头表，
      不经过 analyze.py，同样会存成一张分镜表，之后可以逐镜改（save 带同一个 id 就多一版）。
    </div>
  `)
  const readForm = () => ({
    video: document.getElementById('f-video').value.trim(),
    product: document.getElementById('f-product').value.trim(),
    styleLabel: document.querySelector('#f-style option:checked').textContent.split('—')[0].trim(),
    style: document.getElementById('f-style').value,
    duration: Number(document.getElementById('f-duration').value) || 15,
    note: document.getElementById('f-note').value.trim()
  })

  // 选视频：宿主弹系统原生文件框，选完把绝对路径填进输入框
  const pickBtn = document.getElementById('f-pick')
  const pickHint = document.getElementById('pick-hint')
  const caps = (state.catalog && state.catalog.capabilities) || {}
  if (caps.pickVideo === false) {
    pickBtn.disabled = true
    pickBtn.style.opacity = 0.45
    if (pickHint) pickHint.textContent = '当前系统不支持弹窗选文件（仅 Windows 支持），请手动填写路径。'
  } else {
    pickBtn.addEventListener('click', async () => {
      const label = pickBtn.textContent
      pickBtn.disabled = true
      pickBtn.textContent = '选择中…'
      if (pickHint) pickHint.textContent = '已弹出文件选择框，选好后会自动填进来（取消就点关闭）。'
      try {
        const r = await post('/api/pick', { title: '选择带货视频' })
        if (r.ok && r.path) {
          document.getElementById('f-video').value = r.path
          if (pickHint) pickHint.textContent = r.exists === false ? '选到了路径，但文件似乎不在原处了，请确认。' : '已选择：' + r.path
          toast('已选择视频：' + String(r.path).split(/[\\/]/).pop())
        } else if (r.cancelled) {
          toast('已取消选择')
          if (pickHint) pickHint.textContent = '点「浏览…」可以直接在资源管理器里挑视频，不用手打路径。'
        } else {
          toast(r.error || '没有选到文件')
          if (pickHint) pickHint.textContent = r.error || '没有选到文件，也可以手动填路径。'
        }
      } catch (err) {
        toast('打开文件框失败：' + err.message)
        if (pickHint) pickHint.textContent = '打开文件框失败，请手动填写路径。'
      } finally {
        pickBtn.disabled = false
        pickBtn.textContent = label
      }
    })
  }
  const common = (f) => `产品信息：${f.product || '（我没写，按画面/原片推断）'}\n目标时长：${f.duration}s\n风格：${f.styleLabel}（--style ${f.style}）${f.note ? `\n补充要求：${f.note}` : ''}`

  document.getElementById('f-analyze').addEventListener('click', () => {
    const f = readForm()
    if (!f.video) return toast('先填视频路径或链接（没有原片就用「直接写一条」）')
    start(`拆解这条带货视频，产出一套可直接粘贴进即梦的 Seedance 复刻提示词，并存成一张分镜表。

原片：${f.video}
${common(f)}

请用 ecom-video-seedance-prompt 技能（零 API 密钥：脚本只抽帧/校验/渲染，看帧拆解由你自己做）：
1. 先把技能目录复制到工作区（技能正文里有 cp 命令），再在工作区副本里跑 python scripts/analyze.py "${f.video}"，拿到每镜关键帧清单。
2. 用 read_image 逐个镜头读关键帧（一次并发读 6-8 张，先通读全片再动笔），按 S-A-C-S-C 写 storyboard.json（.cache 目录）+ payload_${f.style}.json（提示词包）。
3. 跑 python scripts/replicate.py "${f.video}" --payload payload_${f.style}.json --style ${f.style} --duration ${f.duration}，校验（每镜 ≤200 字、完整版 ≤800 字）不过就改 JSON 重跑，通过后出 HTML。
4. 把分镜表用 seedance_storyboard action=save 存下来：product=${f.product || '（按原片推断）'}、style=${f.styleLabel}、note="初版"，
   scenes 是 JSON 数组，每镜 {shot 镜头一句话, narration 口播, visual 画面要点, duration 秒}。
5. 交付：给 HTML 预览路径 + 完整版提示词；说明哪些元素不可控（LOGO 等）要按差异说明处理。
每存一版，侧栏「带货视频拆解 · 生成历史」里都会留记录。`)
  })

  document.getElementById('f-create').addEventListener('click', () => {
    const f = readForm()
    start(`给一个产品写一条带货短视频的分镜脚本，并按 S-A-C-S-C 规范产出 Seedance 提示词。

产品：${f.product || '（我还没写，先问我要产品和卖点）'}
${common(f)}

请用 ecom-video-seedance-prompt 技能里的编导规范（references/seedance-knowledge.md）：
1. 先给我一版 ${f.duration} 秒的分镜脚本（${Math.max(3, Math.round(f.duration / 3))} 个镜头左右）：钩子 → 痛点/场景 → 产品登场 → 卖点演示 → 促单，口播要口语化。
2. 每个镜头写成 S-A-C-S-C 齐全的提示词（主体/动作按时间序/场景光影/景别运镜/色调），每镜 ≤200 字，附负面词与 @参考图清单。
3. 用 seedance_storyboard action=save 存成一张分镜表（product=${f.product || '待补'}、style=${f.styleLabel}、note="初版"），scenes 每镜 {shot, narration, visual, duration}。
4. 交付时说明：哪几个镜头最容易翻车、要准备哪些参考图。
后续我要改哪一镜，直接 save 带同一个 id 就会多一版。`)
  })
}

// ---------------------------------------------------------------- 方法论

function renderGuide() {
  const d = state.catalog
  wrap(`
    <header class="head">
      <span class="eyebrow">S-A-C-S-C</span>
      <h1>提示词五要素</h1>
      <p>五项缺一个，模型就在那个维度自由发挥——而自由发挥通常就是翻车现场（六根手指、脸崩、头发粘成一块）。
         技能做的事，就是让 agent 的视觉能力（直接读关键帧）替你完成这套「人肉拆解」。</p>
    </header>
    <div class="panel">
      <table>
        <thead><tr><th style="width:44px">要素</th><th>含义</th><th>写什么</th><th>例子（头发护理广告）</th></tr></thead>
        <tbody>${SASC.map(([k, name, what, example]) => `<tr>
          <td class="num" style="color:var(--accent-ink);font-weight:700">${k}</td>
          <td><b>${esc(name)}</b></td>
          <td>${esc(what)}</td>
          <td class="card-sub muted">${esc(example)}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>

    <div class="sec-head"><h2>三步流程</h2></div>
    <div class="grid">
      <div class="card plain">
        <div class="card-top"><span class="card-title" style="color:var(--accent-ink)">01 · 拆解</span></div>
        <div class="card-sub">analyze.py（零 API）：ffprobe 元信息 + 1fps 抽帧 + 场景切换检测切镜头 + 每镜关键帧清单；
          然后 agent 用 read_image 直接读帧，按 S-A-C-S-C 写拆解卡。</div>
        <div class="pre" style="margin-top:8px">python scripts/analyze.py "&lt;视频&gt;"</div>
      </div>
      <div class="card plain">
        <div class="card-top"><span class="card-title" style="color:var(--jade)">02 · 复刻</span></div>
        <div class="card-sub">replicate.py（零 API）：硬校验分镜表与提示词包（每镜 ≤200 字 / 完整版 ≤800 字 / 字段齐全 / 镜头对齐），
          通过后渲染 md + 自包含 HTML（每镜配原片关键帧）。</div>
        <div class="pre" style="margin-top:8px">python scripts/replicate.py "&lt;视频&gt;" --payload payload_faithful.json --style faithful</div>
      </div>
      <div class="card plain">
        <div class="card-top"><span class="card-title" style="color:var(--gold)">03 · 存档</span></div>
        <div class="card-sub">seedance_storyboard action=save 把分镜表存进插件：侧栏能回看镜头表、复制分段提示；save 带同一个 id 就多一版，历史里留记录。</div>
        <div class="pre" style="margin-top:8px">action=save  product / style / scenes / note</div>
      </div>
    </div>

    <div class="sec-head"><h2>交付规范</h2></div>
    <div class="panel" style="font-size:12.5px;color:var(--ink-2);line-height:1.9">
      · 先给 HTML 预览（每镜提示词配原片关键帧，可逐镜对照）→ 再贴「完整版提示词」直接可粘进即梦。<br>
      · 提醒按 @参考图清单 准备素材：产品图纯色背景自然光，真人照片需打码/抠脸过审。<br>
      · 品牌 LOGO 等不可控元素按「差异说明」处理，不要承诺 1:1。<br>
      · 视频理解基于画面，口播是从字幕/画面推断的，交付时要注明。<br>
      · 不满意某一镜：只带 <code>--shot X</code> 重出那一镜，省时省钱。
    </div>

    <div class="sec-head"><h2>常见问题</h2></div>
    <div class="panel">
      <dl class="kv">
        <dt>要装什么</dt><dd>只需要 PATH 里有 ffmpeg/ffprobe，Python 3.8+ 只用标准库。<b>不需要任何 API key</b>：脚本不联网，看帧拆解由 agent 自己做。</dd>
        <dt>为什么读不到插件目录</dt><dd>bash 沙箱读不到插件安装目录：技能正文会让你先把技能目录 cp 到工作区再跑脚本。</dd>
        <dt>能改风格吗</dt><dd>能，复制一份 payload 改文案、用 --style organic|paid 重跑；已有分镜表则直接改镜头再 save。</dd>
        <dt>历史存哪</dt><dd>$DSH_HOME/ecom-video-seedance/：storyboards.json（分镜表 + 每版快照）、history.json（新建/更新/删除/恢复事件）。</dd>
        <dt>删除能救回吗</dt><dd>能。生成历史里删除记录带快照，点「恢复成新分镜表」即可（生成新 id，原 id 不复活）。</dd>
      </dl>
    </div>

    ${d.skills && d.skills.length ? `
      <div class="sec-head"><h2>随包技能</h2></div>
      <div class="panel">
        ${d.skills.map((s) => `<div style="margin-bottom:8px"><b>${esc(s.name)}</b>
          <div class="card-sub muted">${esc(s.description)}</div></div>`).join('')}
      </div>` : ''}
  `)
}

// ---------------------------------------------------------------- 启动

async function boot() {
  try {
    state.catalog = await api('/api/catalog')
    const s = state.catalog.stats
    navBoards.textContent = s.boards || ''
    navHistory.textContent = s.events || ''
    railFoot.innerHTML = `
      <span class="txt">${s.boards} 张分镜表 · ${s.scenes} 镜</span>
      <span class="txt">${s.revisions} 版 · ${s.events} 条历史</span>
      <span class="txt">${s.lastEventAt ? '最近 ' + esc(shortTime(s.lastEventAt)) : '还没有动作'}</span>
      <span class="txt">v${esc(state.catalog.version || '')}</span>`
  } catch (err) {
    app.innerHTML = `<div class="wrap"><div class="empty-box"><b>读不到工作台数据</b>${esc(err.message)}<br>
      插件可能刚装好，刷新页面再试；如果一直这样，看看 DSH 的插件日志。</div></div>`
    return
  }
  render()
}

addEventListener('hashchange', render)
boot()
