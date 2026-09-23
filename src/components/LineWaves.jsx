import { useEffect, useRef } from 'react';

export default function LineWaves({
  color = '#EE4D8E',
  lines = 28,
  amplitude = 42,
  speed = 0.35,
}) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return undefined;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let pointer = { x: 0.35, y: 0.45, tx: 0.35, ty: 0.45 };
    const lineCount = Math.max(12, Math.min(lines, window.innerWidth < 800 ? 18 : lines));

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const onMove = (event) => {
      const rect = canvas.getBoundingClientRect();
      pointer.tx = (event.clientX - rect.left) / rect.width;
      pointer.ty = (event.clientY - rect.top) / rect.height;
    };

    const draw = (t) => {
      pointer.x += (pointer.tx - pointer.x) * 0.05;
      pointer.y += (pointer.ty - pointer.y) * 0.05;
      ctx.clearRect(0, 0, w, h);

      const time = reduce ? 0 : t * 0.001 * speed;
      const gap = h / (lineCount + 1);

      for (let i = 0; i < lineCount; i += 1) {
        const baseY = gap * (i + 1);
        const depth = i / lineCount;
        const amp = amplitude * (0.35 + depth * 0.9);
        const sway = Math.sin(time * 1.4 + i * 0.22) * amp;
        const pull = (pointer.y * h - baseY) * 0.08;
        ctx.beginPath();
        ctx.lineWidth = 1 + depth * 0.8;
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.14 + depth * 0.55;
        ctx.shadowColor = color;
        ctx.shadowBlur = depth > 0.55 ? 8 : 0;

        for (let x = 0; x <= w; x += 8) {
          const nx = x / w;
          const wave =
            Math.sin(nx * Math.PI * 2.4 + time * 2.2 + i * 0.35) * amp * 0.55
            + Math.sin(nx * Math.PI * 5.2 - time * 1.6 + i) * amp * 0.2
            + sway * (1 - Math.abs(nx - pointer.x))
            + pull * Math.sin(nx * Math.PI);
          const y = baseY + wave;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      ctx.globalAlpha = 1;
      const glow = ctx.createRadialGradient(pointer.x * w, pointer.y * h, 0, pointer.x * w, pointer.y * h, Math.max(w, h) * 0.45);
      glow.addColorStop(0, `${color}33`);
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      if (!reduce) raf = requestAnimationFrame(draw);
    };

    resize();
    draw(0);
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
    };
  }, [amplitude, color, lines, speed]);

  return <canvas ref={ref} className="line-waves" aria-hidden="true" />;
}
