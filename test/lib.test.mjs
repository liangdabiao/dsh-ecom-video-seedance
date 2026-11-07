// 快照合规 + provider 单测。零 dsh 依赖零网络。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
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
  assert.ok(skill.content.length > 2000, '正文过短')
  for (const keyword of ['S-A-C-S-C', 'Seedance', '复刻']) {
    assert.ok(skill.content.includes(keyword), `缺「${keyword}」`)
  }
  assert.match(skill.content, /cp -r/, '应有复制到工作区命令')
  assert.match(skill.content, /读不到插件安装目录|工作区/, '应有工作区约定')
})

test('面板 API 鉴权 fail closed', () => {
  const noService = { get: () => undefined }
  assert.equal(requestRejection(noService, { headers: {} }), 403)
})
