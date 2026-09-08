self.onmessage = (event: MessageEvent) => {
  const { nodes, edges } = event.data;
  const positions = nodes.map((n: any, i: number) => ({
    id: n.id,
    x: Math.cos(i * 2.39996) * Math.sqrt(i + 1) * 32,
    y: Math.sin(i * 2.39996) * Math.sqrt(i + 1) * 32,
  }));
  const map = new Map(positions.map((n: any) => [n.id, n]));
  for (let t = 0; t < 100; t++) {
    for (let i = 0; i < positions.length; i++) {
      const a = positions[i];
      for (let j = i + 1; j < positions.length; j++) {
        const b = positions[j],
          dx = a.x - b.x,
          dy = a.y - b.y,
          d = Math.max(20, dx * dx + dy * dy),
          force = 100 / d;
        a.x += dx * force;
        a.y += dy * force;
        b.x -= dx * force;
        b.y -= dy * force;
      }
    }
    for (const e of edges) {
      const a: any = map.get(e.source),
        b: any = map.get(e.target);
      if (a && b) {
        const dx = b.x - a.x,
          dy = b.y - a.y,
          d = Math.sqrt(dx * dx + dy * dy) || 1,
          f = (d - 95) * 0.009;
        a.x += (dx / d) * f;
        a.y += (dy / d) * f;
        b.x -= (dx / d) * f;
        b.y -= (dy / d) * f;
      }
    }
    for (const a of positions) {
      a.x *= 0.997;
      a.y *= 0.997;
    }
  }
  self.postMessage(positions);
};
