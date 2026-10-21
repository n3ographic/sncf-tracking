export type Lngl = [number, number]
export type Troncon = Lngl[]
export type Graph = { pts: Lngl[]; adj: Array<Array<[number, number]>>; cells: Map<string, number[]>; cell: number }
export type TraceFailure = { reason: 'unsnapped' | 'same_node' | 'unreachable' | 'detour' }

const R = 6371008.8
const rad = (d: number) => (d * Math.PI) / 180

export function haversineM(a: Lngl, b: Lngl): number {
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

// Projection locale en mètres (suffisante à l'échelle d'une cellule ou d'un tracé).
const xy = (p: Lngl): [number, number] => [rad(p[0]) * R * Math.cos(rad(p[1])), rad(p[1]) * R]
const cellOf = (p: Lngl, size: number): [number, number] => {
  const [x, y] = xy(p)
  return [Math.floor(x / size), Math.floor(y / size)]
}

// Cellules voisines (3×3) pour tolérer les points proches d'une frontière de cellule.
function neighbours(g: Graph, p: Lngl, ring = 1): number[] {
  const [cx, cy] = cellOf(p, g.cell)
  const out: number[] = []
  for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) out.push(...(g.cells.get(`${cx + dx},${cy + dy}`) ?? []))
  return out
}

export function buildGraph(troncons: Troncon[], mergeM = 25): Graph {
  const g: Graph = { pts: [], adj: [], cells: new Map(), cell: mergeM }
  const node = (p: Lngl): number => {
    for (const i of neighbours(g, p)) if (haversineM(g.pts[i], p) <= mergeM) return i
    const i = g.pts.length
    g.pts.push(p)
    g.adj.push([])
    const [cx, cy] = cellOf(p, g.cell)
    const key = `${cx},${cy}`
    g.cells.set(key, [...(g.cells.get(key) ?? []), i])
    return i
  }
  for (const t of troncons) {
    let prev = -1
    for (const p of t) {
      const i = node(p)
      if (prev >= 0 && prev !== i) {
        const d = haversineM(g.pts[prev], g.pts[i])
        g.adj[prev].push([i, d])
        g.adj[i].push([prev, d])
      }
      prev = i
    }
  }
  return g
}

export function nearestNode(g: Graph, p: Lngl, maxM = 1000): number | null {
  // Toutes les cellules à portée de maxM : quelques milliers de recherches par appel, sans conséquence ici.
  let best: number | null = null, bestD = Infinity
  for (const i of neighbours(g, p, Math.ceil(maxM / g.cell))) {
    const d = haversineM(g.pts[i], p)
    if (d < bestD) { bestD = d; best = i }
  }
  return best !== null && bestD <= maxM ? best : null
}

export function shortestPath(g: Graph, from: number, to: number): Lngl[] | null {
  const dist = new Map<number, number>([[from, 0]])
  const prev = new Map<number, number>()
  const heap: Array<[number, number]> = [[0, from]] // tas binaire minimal sur (distance, nœud)
  const push = (e: [number, number]) => {
    heap.push(e)
    for (let i = heap.length - 1; i > 0;) {
      const p = (i - 1) >> 1
      if (heap[p][0] <= heap[i][0]) break
      ;[heap[p], heap[i]] = [heap[i], heap[p]]
      i = p
    }
  }
  const pop = (): [number, number] => {
    const top = heap[0], last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      for (let i = 0; ;) {
        let m = i
        const l = 2 * i + 1, r = l + 1
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }
  while (heap.length) {
    const [d, u] = pop()
    if (d > (dist.get(u) ?? Infinity)) continue
    if (u === to) break
    for (const [v, w] of g.adj[u]) {
      const nd = d + w
      if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); push([nd, v]) }
    }
  }
  if (!dist.has(to)) return null
  const path: Lngl[] = []
  for (let u: number | undefined = to; u !== undefined; u = prev.get(u)) path.push(g.pts[u])
  return path.reverse()
}

// Douglas-Peucker ; les extrémités sont toujours conservées.
export function simplify(line: Lngl[], toleranceM: number): Lngl[] {
  if (line.length < 3) return line
  const P = line.map(xy)
  const keep = new Array<boolean>(line.length).fill(false)
  keep[0] = keep[line.length - 1] = true
  const stack: Array<[number, number]> = [[0, line.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [ax, ay] = P[a], [bx, by] = P[b]
    const dx = bx - ax, dy = by - ay, norm = Math.hypot(dx, dy)
    let far = -1, farD = toleranceM
    for (let i = a + 1; i < b; i++) {
      const d = norm === 0 ? Math.hypot(P[i][0] - ax, P[i][1] - ay) : Math.abs(dy * (P[i][0] - ax) - dx * (P[i][1] - ay)) / norm
      if (d > farD) { farD = d; far = i }
    }
    if (far >= 0) { keep[far] = true; stack.push([a, far], [far, b]) }
  }
  return line.filter((_, i) => keep[i])
}

export function traceBetween(g: Graph, a: Lngl, b: Lngl, maxDetour = 1.5): Lngl[] | TraceFailure {
  const ia = nearestNode(g, a), ib = nearestNode(g, b)
  if (ia === null || ib === null) return { reason: 'unsnapped' }
  if (ia === ib) return { reason: 'same_node' }
  const path = shortestPath(g, ia, ib)
  if (!path) return { reason: 'unreachable' }
  const length = path.slice(1).reduce((s, p, i) => s + haversineM(path[i], p), 0)
  if (length > maxDetour * haversineM(a, b)) return { reason: 'detour' }
  return path
}
