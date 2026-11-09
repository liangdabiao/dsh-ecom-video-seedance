// 带货视频拆解 · 技能快照提供方。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const RANK = 600
const INVOCATION = { modelInvocable: true, userInvocable: true }

function parse(file) {
  const text = readFileSync(file, 'utf8')
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return null
  const block = m[1]
  const name = block.match(/^name:\s*(.+)$/m)?.[1]?.trim()
  let description = block.match(/^description:\s*(.+)$/m)?.[1]?.trim().replace(/^(["'])(.*)\1$/, '$2') || null
  if (!description) {
    const lines = block.split(/\r?\n/)
    const start = lines.findIndex((l) => /^description:\s*>/.test(l))
    if (start !== -1) {
      const collected = []
      for (let i = start + 1; i < lines.length; i++) {
        if (/^\S/.test(lines[i])) break
        collected.push(lines[i].replace(/^\s+/, ''))
      }
      description = collected.join(' ').trim()
    }
  }
  if (!name || !description) return null
  return { name, description, body: text.slice(m[0].length) }
}

function readDir(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const sDir = join(dir, entry.name)
    const skillFile = join(sDir, 'SKILL.md')
    if (!existsSync(skillFile)) continue
    const parsed = parse(skillFile)
    if (parsed) out.push({ dir: sDir, file: skillFile, ...parsed, dirName: entry.name })
  }
  return out
}

function addendum(skill) {
  return [
    '',
    '---',
    '',
    '## 在 DSH 插件里使用',
    '',
    `- 本技能目录：\`${skill.dir}\`。**你的 bash 沙箱读不到插件安装目录**——需要读取 references/ 附属文档或运行脚本时，先把整个技能目录复制到当前工作区：`,
    '  ```bash',
    `  cp -r "${skill.dir}" ./seedance-skill`,
    '  ```',
    '- 之后在工作区副本 `./seedance-skill/` 里读取 references/ 或执行脚本。',
    '- **零密钥**：`analyze.py` 只做 ffprobe/抽帧/切镜，`replicate.py` 只做校验/渲染，两个脚本都不联网、不调模型。',
    '  看帧拆解与提示词编导由你自己用 `read_image` 做——不要去要 DEEPSEEK_API_KEY，也不要把帧发给外部视觉 API。',
    '- 正文提到的 WebSearch / mcp__* 等工具：有则用，没有时降级——请用户粘贴内容或用已有知识，数据缺口如实标注。',
    '- **产出文件写到当前工作区**，不要往插件安装目录写文件。',
    '',
  ].join('\n')
}

export function createSkillProvider(dirs) {
  const list = [].concat(dirs)
  const candidate = (s) => ({
    name: s.name, description: s.description, path: s.file,
    invocation: INVOCATION, source: 'bundled', provider: 'ecom-video-seedance', rank: RANK,
    locator: s.dir, resourceBase: { kind: 'directory', path: s.dir },
  })

  return {
    name: 'ecom-video-seedance',
    async list() { return list.flatMap(readDir).map(candidate) },
    async get(c) {
      const s = list.flatMap(readDir).find((x) => x.dir === c.locator && x.name === c.name)
      if (!s) return undefined
      const content = s.body + addendum(s)
      const { rank, locator, ...summary } = candidate(s)
      return { ...summary, content }
    },
  }
}

export { readDir, addendum }
