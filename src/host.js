// 带货视频拆解 · Host 半边（技能 + seedance_storyboard 原生工具 + 面板数据面）。
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSkillProvider } from '../lib/skills.js'
import { registerApi } from '../lib/api.js'
import { listBoards, getBoard, saveBoard, deleteBoard, renderBoard } from '../lib/data.js'

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
    '管理带货视频的分镜表（持久化）：save 保存分镜表（产品+风格+分镜数组，每镜含 shot 镜头/narration 口播/visual 画面/duration 秒数）、' +
    'list 列全部、get 取详情并渲染成 Seedance 分段提示文本、delete 删除。' +
    '拆解或创作带货视频时用 save 存分镜表，用户可在侧栏「带货视频」面板回看。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: str('save 保存；list 列表；get 详情+渲染；delete 删除', { enum: ['save', 'list', 'get', 'delete'] }),
      id: str('get/delete/update：分镜表 id（list 里能看到）；save 传 id 表示覆盖更新'),
      product: str('save：产品名/主题'),
      style: str('save：可选，视频风格（如 痛点开头/剧情种草/口测评测）'),
      scenes: str('save：分镜数组 JSON，如 [{"shot":"痛点开场","narration":"夏天还不敢穿浅色？","visual":"特写腋下汗渍","duration":3}]'),
      confirm: str('delete 必须传 "yes"', { enum: ['yes'] }),
    },
  },
  output: OUTPUT,
  async execute(args) {
    check(args, this.parameters)
    if (args.action === 'save') {
      let scenes
      try { scenes = typeof args.scenes === 'string' ? JSON.parse(args.scenes) : args.scenes } catch { throw new Error('scenes 不是合法 JSON，如 [{"shot":"...","narration":"...","visual":"...","duration":3}]。') }
      const board = saveBoard({ id: args.id, product: args.product, style: args.style, scenes })
      return result(true, `分镜表「${board.product || board.id}」已保存（${board.scenes.length} 个分镜，id=${board.id}）。用户可在侧栏「带货视频」面板回看；get 可渲染成 Seedance 分段提示。`)
    }
    if (args.action === 'list') {
      const boards = listBoards()
      if (!boards.length) return result(true, '还没有分镜表。save 一份即可（如拆解一条带货视频或创作新品脚本）。')
      return result(true, `共 ${boards.length} 张分镜表：`,
        boards.map((b) => `- ${b.product || b.id}（${b.scenes.length} 镜${b.style ? `，${b.style}` : ''}，id=${b.id}）`).join('\n'))
    }
    if (!args.id) throw new Error(`${args.action} 需要 id（先 list 找到）。`)
    if (args.action === 'get') {
      const board = getBoard(args.id)
      if (!board) return result(false, `没有分镜表 ${args.id}。`)
      return result(true, `分镜表「${board.product || board.id}」（${board.scenes.length} 镜${board.style ? `，${board.style}` : ''}）— Seedance 分段提示：`, renderBoard(board))
    }
    // delete
    if (args.confirm !== 'yes') return result(false, '删除分镜表请用 confirm:"yes"。')
    return deleteBoard(args.id)
      ? result(true, `分镜表 ${args.id} 已删除。`)
      : result(false, `没有分镜表 ${args.id}。`)
  },
}

export function apply(ctx) {
  const skillDirs = [join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')]

  ctx.effect(() => ctx.tools.register(seedanceStoryboardTool), `${name}: tool storyboard`)
  ctx.effect(() => ctx.skills.registerProvider(() => createSkillProvider(skillDirs)), `${name}: skills`)
  ctx.effect(() => registerApi(ctx, { skillDirs }), `${name}: routes`)
}
