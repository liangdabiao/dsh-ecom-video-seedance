// 离线自检：快照 + provider + 面板 API。零网络。
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { createSkillProvider } = await import('../lib/skills.js')

let failed = 0
const step = async (name, fn) => {
  process.stdout.write(`- ${name} … `)
  try { await fn(); console.log('ok') } catch (err) { failed++; console.log('失败'); console.error(`  ${err.message}`) }
}

await step('快照完整 + provider 正文完整', async () => {
  if (!existsSync(join(ROOT, 'skills', 'ecom-video-seedance', 'SKILL.md'))) throw new Error('缺 SKILL.md')
  const provider = createSkillProvider([join(ROOT, 'skills')])
  const skill = await provider.get((await provider.list())[0])
  if (skill.content.length < 2000) throw new Error('正文过短')
  if (!skill.content.includes('S-A-C-S-C')) throw new Error('缺 S-A-C-S-C')
  if (!skill.content.includes('read_image')) throw new Error('缺 agent 读帧约定（read_image）')
})

await step('脚本零 API 依赖', async () => {
  const dir = join(ROOT, 'skills', 'ecom-video-seedance', 'scripts')
  if (existsSync(join(dir, 'ds_client.py'))) throw new Error('ds_client.py 应已删除')
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.py'))) {
    const src = readFileSync(join(dir, f), 'utf8')
    if (/import\s+openai/.test(src)) throw new Error(`${f} 仍在 import openai`)
    if (/DEEPSEEK_API_KEY/.test(src)) throw new Error(`${f} 仍在读 API key`)
  }
})

await step('面板 API 健康（内存 ctx 模拟）', async () => {
  const { registerApi } = await import('../lib/api.js')
  const captured = []
  const fakeRes = { writeHead() { return this }, end(chunk) { captured.push(String(chunk)) } }
  const fakeCtx = { get: () => ({ requestRejection: () => false }), webServer: { register: async ({ handler }) => { globalThis.__evsHandler = handler } } }
  await registerApi(fakeCtx, { skillDirs: [join(ROOT, 'skills')] })
  await globalThis.__evsHandler({ method: 'GET', url: '/ecom-video-seedance/api/health', headers: {} }, fakeRes)
  if (!JSON.parse(captured.at(-1)).ok) throw new Error('health 错误')
})

if (failed > 0) { console.error(`\n自检失败 ${failed} 项`); process.exit(1) }
console.log('\n全部通过。')
