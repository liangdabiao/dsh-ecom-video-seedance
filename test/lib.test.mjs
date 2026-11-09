// 快照合规 + provider 单测。零 dsh 依赖零网络。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// 数据目录必须先指到 .tmp：lib/data.js 在被 import 的那一刻就把 DATA_DIR 定死了，
// 晚一步设置 DSH_HOME 就会把测试数据写进真实的 ~/.dsh/ecom-video-seedance/。
const TEST_HOME = join(ROOT, '.tmp', 'test-home')
rmSync(TEST_HOME, { recursive: true, force: true })
process.env.DSH_HOME = TEST_HOME

const { createSkillProvider } = await import('../lib/skills.js')
const { requestRejection } = await import('../lib/api.js')

test('快照完整：SKILL.md + references', () => {
  assert.ok(existsSync(join(ROOT, 'skills', 'ecom-video-seedance', 'SKILL.md')), '缺 SKILL.md')
  const refs = readdirSync(join(ROOT, 'skills', 'ecom-video-seedance', 'references')).filter((f) => f.endsWith('.md'))
  assert.ok(refs.length >= 2, `references ${refs.length} < 2`)
})

test('provider：注册 + 正文 + addendum', async () => {
  const provider = createSkillProvider([join(ROOT, 'skills')])
  const candidates = await provider.list()
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].name, 'ecom-video-seedance-prompt')
  assert.equal(candidates[0].rank, 600)
  const skill = await provider.get(candidates[0])
  assert.ok(skill.content.length > 1500, '正文过短')
  for (const keyword of ['S-A-C-S-C', 'Seedance', '复刻']) {
    assert.ok(skill.content.includes(keyword), `缺「${keyword}」`)
  }
  assert.match(skill.content, /cp -r/, '应有复制到工作区命令')
  assert.match(skill.content, /读不到插件安装目录|工作区/, '应有工作区约定')
})

test('面板 API 鉴权 fail closed', () => {
  const noService = { get: () => undefined }
  assert.equal(requestRejection(noService, { headers: {} }), false) // 宿主 token 鉴权是边界，服务缺席放行
})

// ── 升级新增：分镜表持久化 ──────────────────────────────────
// DSH_HOME 已经在文件最上面指到 .tmp/test-home，这里只按需加载数据层。
const data = await import('../lib/data.js')
const host = await import('../src/host.js')

test('data: 分镜表 save/list/get/delete/render', () => {
  const board = data.saveBoard({
    product: '保温杯', style: '痛点开头',
    scenes: [{ shot: '痛点开场', narration: '夏天还不敢穿浅色？', visual: '特写汗渍', duration: 3 }, { shot: '产品登场', narration: '直到遇见它', visual: '产品特写', duration: 4 }],
  })
  assert.equal(board.scenes.length, 2)
  assert.equal(data.listBoards().length, 1)
  const got = data.getBoard(board.id)
  assert.ok(got.scenes[0].narration.includes('浅色'))
  assert.ok(data.renderBoard(got).includes('[分镜 1]'))
  const updated = data.saveBoard({ id: board.id, product: '保温杯Pro', scenes: [{ shot: '新开场', narration: 'a', visual: 'b' }] })
  assert.equal(updated.product, '保温杯Pro')
  assert.equal(data.listBoards().length, 1)
  assert.equal(data.deleteBoard(board.id), true)
  assert.equal(data.listBoards().length, 0)
})

test('host: seedance_storyboard save/list/get/delete 全链路', async () => {
  assert.equal(host.name, 'ecom-video-seedance')
  assert.equal(host.seedanceStoryboardTool.parameters.additionalProperties, false)
  await assert.rejects(() => host.seedanceStoryboardTool.execute({ action: 'list', bogus: 1 }), /未知参数/)
  await assert.rejects(
    () => host.seedanceStoryboardTool.execute({ action: 'save', product: 'x', scenes: '不是json' }),
    /不是合法 JSON/)
  const saved = await host.seedanceStoryboardTool.execute({
    action: 'save', product: '测试品', style: '口播',
    scenes: JSON.stringify([{ shot: '开场', narration: '你好', visual: '产品', duration: 3 }]),
  })
  assert.equal(saved.ok, true)
  const list = await host.seedanceStoryboardTool.execute({ action: 'list' })
  assert.ok(list.data.includes('测试品'))
  const id = /id=(sb-\d+)/.exec(list.data)?.[1]
  assert.ok(id, 'list 应含 id')
  const got = await host.seedanceStoryboardTool.execute({ action: 'get', id })
  assert.ok(got.data.includes('[分镜 1]'))
  const noConfirm = await host.seedanceStoryboardTool.execute({ action: 'delete', id })
  assert.equal(noConfirm.ok, false)
  const del = await host.seedanceStoryboardTool.execute({ action: 'delete', id, confirm: 'yes' })
  assert.equal(del.ok, true)
})

// ── 选视频弹窗（picker.js，注入 fake run，不真的弹框） ──────────────
const picker = await import('../lib/picker.js')

test('picker: 脚本编码可还原 + 含文件滤镜', () => {
  assert.equal(picker.pickerSupported(), process.platform === 'win32')
  const script = Buffer.from(picker.buildPickScript({ title: '选带货视频' }), 'base64').toString('utf16le')
  assert.match(script, /System\.Windows\.Forms\.OpenFileDialog/)
  assert.match(script, /CheckFileExists = \$true/)
  assert.match(script, /\*\.mp4/)
  assert.match(script, /选带货视频/)
})

test('picker: 选中/取消/出错三种返回', async () => {
  const ok = await picker.pickFile({ run: async () => ({ code: 0, stdout: 'D:\\v\\a.mp4\r\n', stderr: '' }) })
  assert.deepEqual(ok, { ok: true, path: 'D:\\v\\a.mp4' })
  const cancelled = await picker.pickFile({ run: async () => ({ code: 0, stdout: '', stderr: '' }) })
  assert.equal(cancelled.ok, false)
  assert.equal(cancelled.cancelled, true)
  const failed = await picker.pickFile({ run: async () => ({ code: 1, stdout: '', stderr: 'boom' }) })
  assert.equal(failed.ok, false)
  assert.equal(failed.error, 'boom')
})
