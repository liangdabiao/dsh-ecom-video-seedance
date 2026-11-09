// ============================================================================
// 带货视频拆解 · 浏览器半边
//   侧栏加「带货视频拆解」入口；主区域是 /ecom-video-seedance/ 工作台页面（iframe），
//   布局对齐「投资尽调」：概览 / 我的分镜 / 生成历史 / 拆解·创作 / S-A-C-S-C 规范。
//   页面里点「拆解这条视频」「在对话里改」时 postMessage 一段指令，这里开新对话并填进输入框。
//   明暗跟随 dsh 主题，切换时把配色发给页面。
//
// 注意：scripts/build.mjs 的 banner 已经包了一层 __ModuleLoader__ 注册，
// 这个文件只写 CJS 的 exports，不要自己再调 window.__ModuleLoader__.load。
// ============================================================================
const h = require('react').createElement
const React = require('react')

const PANEL_ID = 'ecom-video-seedance'
const LABEL = '带货视频拆解'
const SRC = '/ecom-video-seedance/'

// 侧栏图标：摄像机 + 分镜条
function PanelIcon(props) {
  const s = (props && props.size) || 18
  return h('svg', {
    width: s, height: s, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round'
  },
    h('rect', { x: 3, y: 5, width: 13, height: 14, rx: 2 }),
    h('path', { d: 'M16 9.5l5-2.5v10l-5-2.5z' }),
    h('path', { d: 'M7 11.5h5M7 14.5h3' }))
}

function apply(ctx) {
  const frames = new Set()
  let scheme = null

  const post = (frame, payload) => {
    try { if (frame && frame.contentWindow) frame.contentWindow.postMessage(payload, location.origin) } catch { /* 已卸载 */ }
  }
  const pushScheme = () => {
    if (scheme) for (const frame of frames) post(frame, { type: 'ecom-video-seedance:scheme', scheme })
  }

  // 主题：有 theme 服务就跟随，没有就用页面自己的浅色默认
  try {
    if (typeof ctx.inject === 'function') {
      ctx.inject(['theme'], (c) => {
        const push = (snap) => {
          try { scheme = snap.active.colorScheme } catch { scheme = null }
          pushScheme()
        }
        try { push(c.theme.getTheme()) } catch { /* ignore */ }
        c.on('theme/change', push)
      })
    }
  } catch { /* ignore */ }

  function Panel() {
    const ref = React.useRef(null)

    React.useEffect(() => {
      const self = ref.current
      if (self) frames.add(self)
      function onMessage(e) {
        const frame = ref.current
        if (!frame || e.source !== frame.contentWindow || e.origin !== location.origin) return
        const m = e.data
        if (!m || m.type !== 'ecom-video-seedance:start' || typeof m.prompt !== 'string') return
        try {
          ctx.uiWorkspace.startSession(undefined, { prompt: m.prompt, whenDraftExists: 'replace' })
        } catch (err) {
          console.error('[ecom-video-seedance] 开新对话失败', err)
          post(frame, { type: 'ecom-video-seedance:start-failed', message: String((err && err.message) || err) })
        }
      }
      addEventListener('message', onMessage)
      pushScheme()
      return () => { removeEventListener('message', onMessage); frames.delete(self) }
    }, [])

    return h('iframe', {
      ref,
      src: SRC,
      title: LABEL,
      allow: 'fullscreen; clipboard-write',
      onLoad: (e) => { pushScheme(); post(e.currentTarget, { type: 'ecom-video-seedance:scheme', scheme }) },
      style: { width: '100%', height: '100%', border: 0, display: 'block', background: 'transparent' }
    })
  }

  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 21, label: () => LABEL }, PanelIcon))
  ctx.slots.inject('main', () =>
    ctx.slots.register({ name: 'main', key: PANEL_ID }, Panel))
}

exports.isPlugin = true
exports.inject = ['slots', 'uiWorkspace']
exports.apply = apply
