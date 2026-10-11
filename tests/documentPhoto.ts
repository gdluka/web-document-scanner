import type { Page } from '@playwright/test'
/** Perspective sheet with a shadow, generated locally; no personal document fixture. */
export async function documentPhoto(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 800
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#333'; ctx.fillRect(0, 0, 640, 800)
    ctx.fillStyle = '#faf8f0'; ctx.shadowColor = '#111'; ctx.shadowBlur = 15
    ctx.beginPath()
    for (const [x, y] of [[120, 100], [530, 70], [570, 700], [80, 730]]) ctx.lineTo(x!, y!)
    ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0
    ctx.fillStyle = '#111'; ctx.font = '15px sans-serif'
    for (let i = 0; i < 12; i++) ctx.fillText(`Art. ${i + 1} Producto de prueba $ 12.500`, 150, 230 + i * 25)
    return canvas.toDataURL('image/png').split(',')[1]!
  })
}
