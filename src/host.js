// 带货视频拆解 · Host 半边（技能 + seedance_storyboard 原生工具 + 工作台数据面）。
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSkillProvider } from '../lib/skills.js'
import { registerApi } from '../lib/api.js'
import {
  listBoards, getBoard, saveBoard, deleteBoard, renderBoard,
  listHistory, getHistory, restoreFromHistory, stats, KIND_LABEL
} from '../lib/data.js'

export const name = 'ecom-video-seedance'

export const inject = ['tools', 'skills', 'webServer', 'connection']

function check(args, spec) {
  const problems = []
  for (const key of spec.required || []) {
    if (args?.[key] === undefined) problems.push(`缺少必填参数 ${key}`)
  }
  for (const [key, rule] of Object.entries(spec.properties || {})) {
    const value = args?.[key]
    if (value === undefined) continue
    if (rule.enum && !rule.enum.includes(value)) problems.push(`${key} 只能是 ${rule.enum.join(' / ')} 之一`)
  }
  for (const key of Object.keys(args || {})) {
    if (!spec.properties || !(key in spec.properties)) problems.push(`未知参数 ${key}`)
  }
  if (problems.length) throw new Error(`seedance_storyboard 参数有误：${problems.join('；')}。`)
}

const str = (description, extra = {}) => ({ type: 'string', description, ...extra })
const num = (description, extra = {}) => ({ type: 'number', description, ...extra })
const text = (value) => [{ type: 'text', text: value }]

const OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['ok', 'summary'],
    properties: {
      ok: { type: 'boolean' },
      summary: { type: 'string', description: '给模型看的回执' },
      data: { type: 'string', description: '可选：分镜表正文' },
    },
  },
  render: (_args, value) => text(value.data ? `${value.summary}\n\n${value.data}` : value.summary),
}

const result = (ok, summary, data = '') => ({ ok, summary, data })

// ---------------------------------------------------------------------------
// 工具：seedance_storyboard —— 分镜表持久化（save/list/get/delete/render）
// ---------------------------------------------------------------------------
export const seedanceStoryboardTool = {
  name: 'seedance_storyboard',
  description:
    '管理带货视频的分镜表（持久化，每保存一次多一版）：save 保存分镜表（产品+风格+分镜数组，每镜含 shot 镜头/narration 口播/visual 画面/duration 秒数）、' +
    'list 列全部、get 取详情并渲染成 Seedance 分段提示文本、delete 删除、history 看生成历史（新建/更新/删除/恢复）、' +
    'stats 汇总、restore 从删除快照恢复。拆解或创作带货视频时用 save 存分镜表，用户可在侧栏「带货视频」工作台回看。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: str('save 保存；list 列表；get 详情+渲染；delete 删除；history 生成历史；stats 汇总；restore 恢复删除的分镜表', { enum: ['save', 'list', 'get', 'delete', 'history', 'stats', 'restore'] }),
      id: str('get/delete：分镜表 id（list 里能看到）；save 传 id 表示覆盖更新'),
      product: str('save：产品名/主题'),
      style: str('save：可选，视频风格（如 痛点开头/剧情种草/口测评测）'),
      scenes: str('save：分镜数组 JSON，如 [{"shot":"痛点开场","narration":"夏天还不敢穿浅色？","visual":"特写腋下汗渍","duration":3}]'),
      note: str('save：可选，这一版改了什么（写进历史，方便回看）'),
      confirm: str('delete 必须传 "yes"', { enum: ['yes'] }),
      kind: str('history：只看某一类事件', { enum: ['all', 'create', 'update', 'delete', 'restore'] }),
      q: str('history：关键词（产品名/摘要）'),
      limit: num('history：最多几条，默认 20'),
      eventId: str('restore：历史事件 id（history 里能看到）'),
    },
  },
  output: OUTPUT,
  async execute(args) {
    check(args, this.parameters)

    if (args.action === 'save') {
      let scenes
      try { scenes = typeof args.scenes === 'string' ? JSON.parse(args.scenes) : args.scenes } catch { throw new Error('scenes 不是合法 JSON，如 [{"shot":"...","narration":"...","visual":"...","duration":3}]。') }
      const board = saveBoard({ id: args.id, product: args.product, style: args.style, scenes, note: args.note })
      const rev = (board.revisions || []).length
      return result(true, `分镜表「${board.product || board.id}」已保存（${board.scenes.length} 个分镜，第 ${rev} 版，id=${board.id}）。用户可在侧栏「带货视频」工作台回看；get 可渲染成 Seedance 分段提示。`)
    }

    if (args.action === 'list') {
      const boards = listBoards()
      if (!boards.length) return result(true, '还没有分镜表。save 一份即可（如拆解一条带货视频或创作新品脚本）。')
      return result(true, `共 ${boards.length} 张分镜表：`,
        boards.map((b) => `- ${b.product || b.id}（${b.scenes.length} 镜${b.style ? `，${b.style}` : ''}${(b.revisions || []).length ? `，第 ${b.revisions.length} 版` : ''}，id=${b.id}）`).join('\n'))
    }

    if (args.action === 'history') {
      const events = listHistory({ kind: args.kind || 'all', q: args.q, limit: Math.min(100, Number(args.limit) || 20) })
      if (!events.length) return result(true, '还没有历史记录', 'save / delete 之后这里会留记录。')
      return result(true, `最近 ${events.length} 条分镜表历史：`,
        events.map((e) => `- ${String(e.at).slice(0, 16).replace('T', ' ')} ${KIND_LABEL[e.kind] || e.kind}｜${e.product || e.boardId}｜${e.summary}｜event=${e.id}`).join('\n'))
    }

    if (args.action === 'stats') {
      const s = stats()
      const styles = Object.entries(s.styles).map(([k, v]) => `${k} ${v}`).join('、') || '无'
      return result(true, `共 ${s.boards} 张分镜表（${s.revisions} 版历史）`, [
        `镜头合计 ${s.scenes} 个，时长合计 ${s.duration}s（平均每张 ${s.avgDuration}s、每镜 ${s.avgShot}s）`,
        `风格分布：${styles}`,
        `历史事件 ${s.events} 条${s.lastEventAt ? `，最近 ${String(s.lastEventAt).replace('T', ' ').slice(0, 16)}` : ''}`
      ].join('\n'))
    }

    if (args.action === 'restore') {
      const event = args.eventId ? getHistory(args.eventId) : null
      const target = event && event.kind === 'delete' ? restoreFromHistory(args.eventId) : null
      if (!target) {
        const hint = event ? '这条历史不是删除记录（只有删除才有快照可恢复）。' : '要传 eventId（history 里能看到，形如 ev-xxx）。'
        return result(false, '没有可恢复的快照', hint)
      }
      return result(true, `已恢复成新分镜表「${target.product || target.id}」（${target.scenes.length} 镜，id=${target.id}）`, renderBoard(target))
    }

    if (!args.id) throw new Error(`${args.action} 需要 id（先 list 找到）。`)
    if (args.action === 'get') {
      const board = getBoard(args.id)
      if (!board) return result(false, `没有分镜表 ${args.id}。`)
      const rev = (board.revisions || []).length
      return result(true, `分镜表「${board.product || board.id}」（${board.scenes.length} 镜${board.style ? `，${board.style}` : ''}${rev ? `，第 ${rev} 版` : ''}）— Seedance 分段提示：`, renderBoard(board))
    }
    // delete
    if (args.confirm !== 'yes') return result(false, '删除分镜表请用 confirm:"yes"。')
    return deleteBoard(args.id)
      ? result(true, `分镜表 ${args.id} 已删除（生成历史里留了快照，可用 restore 恢复）。`)
      : result(false, `没有分镜表 ${args.id}。`)
  },
}

export function apply(ctx) {
  const skillDirs = [join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')]

  ctx.effect(() => ctx.tools.register(seedanceStoryboardTool), `${name}: tool storyboard`)
  ctx.effect(() => ctx.skills.registerProvider(() => createSkillProvider(skillDirs)), `${name}: skills`)
  ctx.effect(() => registerApi(ctx, { skillDirs }), `${name}: routes`)
}
