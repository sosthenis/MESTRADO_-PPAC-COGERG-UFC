import React, { useEffect, useRef } from 'react';

interface WaveformProps {
  isActive: boolean;
  volume: number; // 0 to 1
  color: string;
}

const Waveform: React.FC<WaveformProps> = ({ isActive, volume, color }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let phase = 0;

    const draw = () => {
      if (!canvas) return;
      // Responsive resize
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = width;
      canvas.height = height;

      ctx.clearRect(0, 0, width, height);

      if (!isActive) {
        // Draw a flat line or subtle pulse
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 2;
        ctx.stroke();
        return;
      }

      const centerY = height / 2;
      const amplitude = Math.max(10, volume * (height / 2));
      const frequency = 0.05;
      
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;

      for (let x = 0; x < width; x++) {
        const y = centerY + Math.sin(x * frequency + phase) * amplitude * Math.sin(x / width * Math.PI);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      
      ctx.stroke();

      // Second line for effect
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x++) {
         const y = centerY + Math.sin(x * frequency + phase + 1.5) * (amplitude * 0.7) * Math.sin(x / width * Math.PI);
         if (x === 0) ctx.moveTo(x, y);
         else ctx.lineTo(x, y);
      }
      ctx.stroke();

      phase += 0.2;
      animationId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [isActive, volume, color]);

  return <canvas ref={canvasRef} className="w-full h-full" />;
};

export default Waveform;