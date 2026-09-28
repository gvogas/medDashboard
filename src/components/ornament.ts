// The background layer. Med: two helices, a steroid, benzenes, a lipid. CS: circuit
// traces, a binary tree, a gate, a graph and code. Drawn in the theme's accent;
// redrawn on resize and on theme or background change.

type Pt = [number, number]

function drawOn(ctx: CanvasRenderingContext2D, w: number, h: number, cs: boolean) {
    function hex(cx: number, cy: number, r: number, rot: number): Pt[] { const p: Pt[] = []; for (let i = 0; i < 6; i++) { const a = rot + i * Math.PI / 3; p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]) } return p }
    function poly(pts: Pt[], close: boolean) { ctx.beginPath(); pts.forEach((p, i) => { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]) }); if (close) ctx.closePath(); ctx.stroke() }
    function helix(x: number, y: number, len: number, amp: number, turns: number, angle: number) {
        const steps = 200, ca = Math.cos(angle), sa = Math.sin(angle)
        const pt = (t: number, ph: number): Pt => { const al = t * len, off = amp * Math.sin(t * turns * Math.PI * 2 + ph); return [x + al * ca - off * sa, y + al * sa + off * ca] }
        for (const ph of [0, Math.PI]) {
            ctx.beginPath()
            for (let i = 0; i <= steps; i++) { const s = pt(i / steps, ph); if (i) ctx.lineTo(s[0], s[1]); else ctx.moveTo(s[0], s[1]) }
            ctx.stroke()
        }
        for (let i = 0; i <= 40; i++) { const a = pt(i / 40, 0), b = pt(i / 40, Math.PI); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke() }
    }
    function steroid(x: number, y: number, r: number) {
        const d = r * Math.sqrt(3), p: Pt[] = []
        poly(hex(x, y, r, Math.PI / 6), true); poly(hex(x + d, y - r * 0.5, r, Math.PI / 6), true); poly(hex(x + 2 * d, y - r, r, Math.PI / 6), true)
        for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / 5; p.push([x + 2 * d + d * 0.92 + r * 0.86 * Math.cos(a), y - r * 1.4 + r * 0.86 * Math.sin(a)]) }
        poly(p, true)
    }
    function benzene(x: number, y: number, r: number) { poly(hex(x, y, r, Math.PI / 6), true); ctx.beginPath(); ctx.arc(x, y, r * 0.58, 0, Math.PI * 2); ctx.stroke() }
    function lipid(x: number, y: number, n: number, step: number) {
        const pts: Pt[] = []; for (let i = 0; i <= n; i++) pts.push([x + i * step, y + (i % 2 ? -step * 0.55 : step * 0.55)])
        poly(pts, false); ctx.beginPath(); ctx.arc(x - step * 0.5, y + step * 0.2, step * 0.42, 0, Math.PI * 2); ctx.stroke()
    }
    /* ── the CS layer: circuit traces, a binary tree, an AND gate, a graph, code ── */
    function via(x: number, y: number, r: number) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke() }
    function trace(pts: Pt[], r: number) { poly(pts, false); const e = pts[pts.length - 1]; via(e[0], e[1], r) }
    function tree(x: number, y: number, dx: number, dy: number, depth: number, r: number) {
        via(x, y, r)
        if (!depth) return
        for (const s of [-1, 1]) {
            const nx = x + s * dx, ny = y + dy, a = Math.atan2(dy, s * dx)
            ctx.beginPath(); ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a)); ctx.lineTo(nx - r * Math.cos(a), ny - r * Math.sin(a)); ctx.stroke()
            tree(nx, ny, dx * 0.52, dy, depth - 1, r)
        }
    }
    function andGate(x: number, y: number, s: number) {
        ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s, y - s); ctx.arc(x + s, y, s, -Math.PI / 2, Math.PI / 2); ctx.lineTo(x, y + s); ctx.closePath(); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(x - s * 0.9, y - s * 0.5); ctx.lineTo(x, y - s * 0.5); ctx.moveTo(x - s * 0.9, y + s * 0.5); ctx.lineTo(x, y + s * 0.5)
        ctx.moveTo(x + 2 * s, y); ctx.lineTo(x + 2.9 * s, y); ctx.stroke()
    }
    function graph(x: number, y: number, s: number, r: number) {
        const nodes: Pt[] = [[0, 0], [1.2, -0.6], [2.3, 0.1], [1.1, 0.8], [2.9, -0.9], [3.2, 0.9]]
        const n = nodes.map((p): Pt => [x + p[0] * s, y + p[1] * s])
        const edges: Pt[] = [[0, 1], [1, 2], [0, 3], [3, 2], [2, 4], [2, 5], [1, 4]]
        for (const [a, b] of edges) {
            const A = n[a], B = n[b], t = Math.atan2(B[1] - A[1], B[0] - A[0])
            ctx.beginPath(); ctx.moveTo(A[0] + r * Math.cos(t), A[1] + r * Math.sin(t)); ctx.lineTo(B[0] - r * Math.cos(t), B[1] - r * Math.sin(t)); ctx.stroke()
        }
        for (const p of n) via(p[0], p[1], r)
    }
    function glyph(txt: string, x: number, y: number, size: number) { ctx.font = "500 " + size + 'px "IBM Plex Mono", ui-monospace, monospace'; ctx.strokeText(txt, x, y) }

    if (!cs) {
        helix(-40, h * 0.14, Math.hypot(w + 120, h * 0.72), 26, 7, Math.atan2(h * 0.68, w + 120))
        helix(w * 0.30, h + 30, Math.hypot(w * 0.82, h * 0.95), 18, 6, Math.atan2(-h * 0.95, w * 0.82))
        steroid(w * 0.60, h * 0.16, 20)
        benzene(w * 0.14, h * 0.70, 22); benzene(w * 0.20, h * 0.77, 15)
        lipid(w * 0.72, h * 0.78, 9, 15)
        steroid(w * 0.05, h * 0.38, 13)
        return
    }
    const k = Math.max(0.6, Math.min(1, w / 900)), g = 18 * k, r = 3.2 * k
    /* a bus of traces sweeping in from the top left, on the Med helix's diagonal */
    for (let i = 0; i < 5; i++) {
        const o = i * g * 0.55
        trace([[-10, h * 0.10 + o], [w * 0.18 + o, h * 0.10 + o], [w * 0.30 + o, h * 0.10 + o + w * 0.12], [w * 0.52 + o, h * 0.10 + o + w * 0.12]], r)
    }
    for (let i = 0; i < 4; i++) {
        const o = i * g * 0.55
        trace([[w + 10, h * 0.62 + o], [w * 0.86 - o, h * 0.62 + o], [w * 0.78 - o, h * 0.62 + o - w * 0.08], [w * 0.66 - o, h * 0.62 + o - w * 0.08]], r)
    }
    trace([[w * 0.40, h + 10], [w * 0.40, h * 0.86], [w * 0.46, h * 0.80], [w * 0.58, h * 0.80]], r)
    trace([[w * 0.43, h + 10], [w * 0.43, h * 0.88], [w * 0.47, h * 0.84], [w * 0.60, h * 0.84]], r)
    tree(w * 0.80, h * 0.10, w * 0.085, h * 0.10, 3, 5 * k)
    andGate(w * 0.10, h * 0.70, 16 * k)
    graph(w * 0.18, h * 0.44, 26 * k, 4.5 * k)
    glyph("{ }", w * 0.62, h * 0.36, 34 * k)
    glyph("</>", w * 0.06, h * 0.94, 26 * k)
    glyph("0110 1001", w * 0.66, h * 0.97, 15 * k)
    glyph("O(n log n)", w * 0.44, h * 0.52, 14 * k)
}

/** Draw the layer on `canvas`, the size of its parent, in the theme's stroke colour. */
export function drawOrnament(canvas: HTMLCanvasElement) {
    const host = canvas.parentElement
    if (!host) return
    const w = host.clientWidth, h = host.clientHeight
    if (!w || !h) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h)
    const stroke = getComputedStyle(document.documentElement).getPropertyValue("--orn-stroke").trim()
    const cs = document.documentElement.getAttribute("data-bg") === "cs"
    ctx.strokeStyle = stroke || "#0E7C74"; ctx.lineWidth = 1.15; ctx.lineJoin = "round"; ctx.lineCap = cs ? "round" : "butt"
    drawOn(ctx, w, h, cs)
}

/* index.html's #orn, taken at boot (watchOrnament) rather than when this module loads. */
let canvas: HTMLCanvasElement | null = null
let raf: number | null = null

/** Redraw on the next frame; several calls in one frame draw once. */
export function schedule() {
    if (!canvas) return
    if (raf) cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => { if (canvas) drawOrnament(canvas) })
}

/** At boot: take #orn and redraw it whenever its parent or the window changes size. */
export function watchOrnament() {
    canvas = document.getElementById("orn") as HTMLCanvasElement | null
    const host = canvas?.parentElement
    if (!host) return
    if (window.ResizeObserver) new ResizeObserver(schedule).observe(host)
    window.addEventListener("resize", schedule)
}
