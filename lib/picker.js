// 选视频文件：在宿主桌面弹出系统原生的「打开文件」对话框，返回绝对路径。
// 浏览器里 <input type="file"> 拿不到绝对路径（安全限制），所以这件事必须由宿主进程做。
//
// Windows：跑一段 PowerShell（System.Windows.Forms.OpenFileDialog），把选中的路径打到 stdout。
//         用 -EncodedCommand 传基地址编码，避免滤镜里的分号/中文被 shell 拆坏。
// 其他平台：先返回「不支持」，页面把按钮置灰（macOS/Linux 以后可以接 zenity/kdialog）。
import { spawn } from 'node:child_process'

export const VIDEO_FILTER = '视频文件|*.mp4;*.mov;*.m4v;*.webm;*.mkv;*.avi;*.flv;*.wmv|所有文件|*.*'

export function pickerSupported() {
  return process.platform === 'win32'
}

// 把对话框脚本编成 -EncodedCommand 需要的 base64（UTF-16LE）
export function buildPickScript({ title = '选择视频文件', filter = VIDEO_FILTER } = {}) {
  const safe = (s) => String(s).replace(/'/g, "''")
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
    `$dialog.Title = '${safe(title)}'`,
    `$dialog.Filter = '${safe(filter)}'`,
    '$dialog.CheckFileExists = $true',
    '$dialog.Multiselect = $false',
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.FileName) }'
  ].join('\r\n')
  return Buffer.from(script, 'utf16le').toString('base64')
}

// 打开对话框并等待选择。返回 { ok, path } / { ok:false, cancelled:true } / { ok:false, error }
// options.run 可注入（测试用）：(command, args) => Promise<{ code, stdout, stderr }>
export function pickFile({ title, filter, timeoutMs = 10 * 60_000, run } = {}) {
  if (!pickerSupported()) {
    return Promise.resolve({ ok: false, unsupported: true, error: '当前系统暂不支持以弹窗选文件，请手动填写路径' })
  }
  const args = ['-NoProfile', '-STA', '-EncodedCommand', buildPickScript({ title, filter })]
  const exec = run || defaultRun
  return exec('powershell.exe', args, { timeoutMs }).then(({ code, stdout, stderr }) => {
    const picked = String(stdout || '').trim().replace(/^\uFEFF/, '')
    if (code === 0 && picked) return { ok: true, path: picked }
    if (code === 0) return { ok: false, cancelled: true }
    return { ok: false, error: String(stderr || '').trim().slice(0, 400) || `对话框退出码 ${code}` }
  }).catch((err) => ({ ok: false, error: String((err && err.message) || err) }))
}

function defaultRun(command, args, { timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* ignore */ }
      reject(new Error('等待选择超时（对话框可能未关闭）'))
    }, timeoutMs)
    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }) })
  })
}
