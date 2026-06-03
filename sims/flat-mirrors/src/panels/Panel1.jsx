import React, { useRef, useEffect, useState } from 'react';
import eyeImage from '../assets/eye-small.png';

/************************************************
 * 
 *   Ray-Mirror Collision Handling
 * 
************************************************/

function rayHitsMirror(rayOrigin, rayDirection, mirrorStart, mirrorEnd, maxDist = Infinity) {
  // rayOrigin: {x, y}
  // rayDirection: angle in radians
  // mirrorStart, mirrorEnd: {x, y}
  
  // Strategy here is to parametrize both the ray and the mirror and solve:
  // Parametric ray: P = rayOrigin + t * (cos(rayDirection), sin(rayDirection))
  // Parametric line: P = mirrorStart + s * (mirrorEnd - mirrorStart)
  
  const rayDx = Math.cos(rayDirection);
  const rayDy = Math.sin(rayDirection);
  
  const mirrorDx = mirrorEnd.x - mirrorStart.x;
  const mirrorDy = mirrorEnd.y - mirrorStart.y;
  
  // Solve: rayOrigin + t*(rayDx, rayDy) = mirrorStart + s*(mirrorDx, mirrorDy)
  const denom = rayDx * mirrorDy - rayDy * mirrorDx;
  if (Math.abs(denom) < 1e-10) return null; // Ray parallel to mirror
  const dx = mirrorStart.x - rayOrigin.x;
  const dy = mirrorStart.y - rayOrigin.y;
  const t = (dx * mirrorDy - dy * mirrorDx) / denom;
  const s = (dx * rayDy - dy * rayDx) / denom;
  
  // Check if intersection is:
  // - In front of ray (t > 0)
  // - Within mirror segment (0 <= s <= 1)
  // - Not too far away
  if (t > 0.001 && s >= 0 && s <= 1 && t < maxDist) {
    return {
      t: t,
      hitPoint: { x: rayOrigin.x + t * rayDx, y: rayOrigin.y + t * rayDy },
      mirrorIndex: null, // Will be set by caller
      s: s
    };
  }
  
  return null;
}

function getMirrorNormal(mirrorStart, mirrorEnd) {
  // Vector along mirror
  const dx = mirrorEnd.x - mirrorStart.x;
  const dy = mirrorEnd.y - mirrorStart.y;
  
  // Normal (perpendicular, pointing "outward")
  // Rotate 90 degrees counterclockwise
  const length = Math.sqrt(dx*dx + dy*dy);
  return { x: -dy / length, y: dx / length };
}

function reflectRay(incidentAngle, mirrorNormal) {
  // Convert angle to direction vector
  const incidentDx = Math.cos(incidentAngle);
  const incidentDy = Math.sin(incidentAngle);
  
  // Reflection formula: r = i - 2(i·n)n
  // (i·n)n is the component of the ray perpendicular to the mirror.
  // By subtracting it twice, we remove it (subtract once) then reverse it
  //    (subtract twice); since n is perpendicular to the mirror, the parallel
  //    part of i in unchanged.
  const dotProduct = incidentDx * mirrorNormal.x + incidentDy * mirrorNormal.y;
  
  const reflectedDx = incidentDx - 2 * dotProduct * mirrorNormal.x;
  const reflectedDy = incidentDy - 2 * dotProduct * mirrorNormal.y;
  
  // Convert back to angle
  return Math.atan2(reflectedDy, reflectedDx);
}

function traceRay(startPoint, startAngle, mirrors, maxBounces = 2, maxDistance = 2000) {
  //console.log('traceRay called with:', { startPoint, startAngle, mirrorsCount: mirrors.length, maxBounces, maxDistance });
  const segments = [];
  let currentPoint = startPoint;
  let currentAngle = startAngle;
  
  for (let bounce = 0; bounce < maxBounces; bounce++) {
    //console.log(`Bounce ${bounce}: currentPoint=`, currentPoint, 'currentAngle=', currentAngle);
    // Find which mirror (if any) is hit first by looping through
    // mirrors and checking their hit points and comparing
    let closest = null;
    for (let i = 0; i < mirrors.length; i++) {
      const hit = rayHitsMirror(currentPoint, currentAngle, mirrors[i].start, mirrors[i].end, maxDistance);
      //console.log(`  Mirror ${i}: hit=`, hit);
      if (hit && (!closest || hit.t < closest.t)) {
        hit.mirrorIndex = i;
        closest = hit;
      }
    }
    
    //console.log(`  Closest hit:`, closest);
    // If the ray doesn't hit anything, then just draw out to the max distance
    // And end the loop of bounces for this ray
    if (!closest) {
      const endX = currentPoint.x + maxDistance * Math.cos(currentAngle);
      const endY = currentPoint.y + maxDistance * Math.sin(currentAngle);
      segments.push({
        start: currentPoint,
        end: { x: endX, y: endY },
        bounced: false
      });
      break;
    }
    
    //console.log(`  Hit mirror, adding segment`);
    // If the ray does hit a mirror, push that segment...
    segments.push({
      start: currentPoint,
      end: closest.hitPoint,
      bounced: bounce > 0
    });
    
    // ... and set up to reflect the next bounce
    const mirrorNormal = getMirrorNormal(
      mirrors[closest.mirrorIndex].start,
      mirrors[closest.mirrorIndex].end
    );
    currentPoint = closest.hitPoint;
    currentAngle = reflectRay(currentAngle, mirrorNormal);
  }
  
  //console.log('traceRay returning segments:', segments);
  return segments;
}

/************************************************
 * 
 *   Main App
 * 
************************************************/

export default function Panel1({ gridOn }) {
  const GRID_SPACING = 50;
  const EYE_HEIGHT = 50; // pixels
  const EYE_WIDTH = 40; // pixels

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const mirrorInitializedRef = useRef(false);  // ← Track if we've set mirrors once
  const eyeImageRef = useRef(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  
  const [circle, setCircle] = useState({ x: 300, y: 200, radius: 8 });
  const [draggingCircle, setDraggingCircle] = useState(false);
  const [eye, setEye] = useState({ x: 300, y: 400 });
  const [draggingEye, setDraggingEye] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [canvasDims, setCanvasDims] = useState({ width: 800, height: 600 });
  const [mirrors, setMirrors] = useState([
    { start: { x: 600, y: 100 }, end: { x: 600, y: 500 } },
  ]);
  const [rayAngle, setRayAngle] = useState(8*Math.PI/180);

  const getMirrorPosition = () => {
    const mirrorWidth = 20;
    const mirrorHeightRatio = 0.6;
    
    return {
      x: Math.round(canvasDims.width / 2 / GRID_SPACING) * GRID_SPACING,
      y: (canvasDims.height - canvasDims.height * mirrorHeightRatio) / 2,
      width: mirrorWidth,
      height: canvasDims.height * mirrorHeightRatio,
    };
  };

  // Resize canvas to fill container
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resizeCanvas = () => {
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      canvas.width = newWidth;
      canvas.height = newHeight;
      setCanvasDims({ width: newWidth, height: newHeight });
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, []);

  // EFFECT 1a: Initialize mirrors only once, after canvas dims are set
  useEffect(() => {
    if (mirrorInitializedRef.current) return; // Only run once
    if (canvasDims.width === 800) return; // Wait for actual resize to complete
    
    const mirror = getMirrorPosition();
    setMirrors([{ 
      start: { x: mirror.x, y: mirror.y }, 
      end: { x: mirror.x, y: mirror.y + mirror.height } 
    }]);
    mirrorInitializedRef.current = true;
  }, [canvasDims]);

  // EFFECT 1b: Wait for the eye image to be loaded, so it gets drawn
  useEffect(() => {
    const img = new Image();
    img.src = eyeImage;
    img.onload = () => {
      eyeImageRef.current = img;
      setImageLoaded(true);  // Trigger redraw
    };
  }, []);

  // EFFECT 2: Draw everything
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // Clear canvas
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid
    ctx.strokeStyle = gridOn ? '#e0e0e0' : '#ffffff';
    ctx.lineWidth = 1;
    for (let i = 0; i <= canvas.width; i += GRID_SPACING) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, canvas.height);
      ctx.stroke();
    }
    for (let i = 0; i <= canvas.height; i += GRID_SPACING) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(canvas.width, i);
      ctx.stroke();
    }

    // Draw mirror (use stored state, not recalculated position)
    const mirror = mirrors[0];
    if (mirror) {
      const mirrorHeight = mirror.end.y - mirror.start.y;
      ctx.fillStyle = '#3498db';
      ctx.fillRect(mirror.start.x, mirror.start.y, 20, mirrorHeight);
    }

    // Draw ray segments
    const rayCount = 5;
    const angleSpread = 2 * Math.PI / 180.0;
    const allRaySegments = [];

    for (let i = 0; i < rayCount; i++) {
      const angle = rayAngle + (i / (rayCount - 1) - 0.5) * angleSpread;
      const raySegments = traceRay(
        { x: circle.x, y: circle.y },
        angle,
        mirrors,
        5,
        2000
      );
      allRaySegments.push(...raySegments);
    }

    // Draw the ray segments
    ctx.strokeStyle = '#202020';
    ctx.lineWidth = 1;
    allRaySegments.forEach(seg => {
      ctx.beginPath();
      ctx.moveTo(seg.start.x, seg.start.y);
      ctx.lineTo(seg.end.x, seg.end.y);
      ctx.stroke();
    });

    // Draw circle
    ctx.fillStyle = '#3498db';
    ctx.beginPath();
    ctx.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2980b9';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw eye
    if (eyeImageRef.current && eyeImageRef.current.complete) {
      ctx.drawImage(eyeImageRef.current, eye.x - EYE_WIDTH / 2, eye.y - EYE_HEIGHT / 2, EYE_WIDTH, EYE_HEIGHT);
    }

  }, [circle, eye, gridOn, mirrors, rayAngle, canvasDims, imageLoaded]);

  // Mouse handlers
  const handleMouseDown = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const distToCircle = Math.sqrt((mouseX - circle.x) ** 2 + (mouseY - circle.y) ** 2);
    const distToEye = Math.sqrt((mouseX - eye.x) ** 2 + (mouseY - eye.y) ** 2);

    if (distToEye < 25) { // Eye hitbox
      setDraggingEye(true);
      setOffset({ x: mouseX - eye.x, y: mouseY - eye.y });
    } else if (distToCircle < circle.radius + 5) {
      setDraggingCircle(true);
      setOffset({ x: mouseX - circle.x, y: mouseY - circle.y });
    }
  };

  const handleMouseMove = (e) => {
    if (!draggingCircle && !draggingEye) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (draggingEye) {
      setEye({
        x: Math.max(20, Math.min(canvas.width - 20, mouseX - offset.x)),
        y: Math.max(20, Math.min(canvas.height - 20, mouseY - offset.y)),
      });
    } else if (draggingCircle) {
      setCircle({
        ...circle,
        x: Math.max(circle.radius, Math.min(canvas.width - circle.radius, mouseX - offset.x)),
        y: Math.max(circle.radius, Math.min(canvas.height - circle.radius, mouseY - offset.y)),
      });
    }
  };

  const handleMouseUp = () => {
    setDraggingCircle(false);
    setDraggingEye(false);
  };

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          cursor: draggingCircle ? 'grabbing' : 'grab',
          display: 'block',
        }}
      />
    </div>
  );
}