import React, { useRef, useEffect, useState } from 'react';
import './App.css';

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

function traceRay(startPoint, startAngle, mirrors, maxBounces = 5, maxDistance = 2000) {
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

export default function App() {
  const canvasRef = useRef(null);
  const [circle, setCircle] = useState({ x: 200, y: 200, radius: 5 });
  const [draggingCircle, setDraggingCircle] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0, angle: 0 });
  const [rayAngle, setRayAngle] = useState(0);  // Angle measured ccw from rightward horizontal
  const [draggingRays, setDraggingRays] = useState(false);
  const [isRed, setIsRed] = useState(false);
  const [gridOn, setGridOn] = useState(true);
  const [mirrors, setMirrors] = useState([
    { start: { x: 600, y: 100 }, end: { x: 600, y: 500 } },    // Vertical mirror 
    { start: { x: 100, y: 400 }, end: { x: 600, y: 400 } },    // Horizontal mirror
  ]);

  // Draw the circle
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    
    // Clear canvas
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw grid (optional, just for reference)
    ctx.strokeStyle = gridOn ? '#e0e0e0' : '#f0f0f0';
    ctx.lineWidth = 1;
    for (let i = 0; i < canvas.width; i += 50) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, canvas.height);
      ctx.stroke();
    }
    for (let i = 0; i < canvas.height; i += 50) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(canvas.width, i);
      ctx.stroke();
    }
    
    // Draw circle
    ctx.fillStyle = isRed ? '#e74c3c' : '#3498db';  // ← Changes based on isRed state
    ctx.beginPath();
    ctx.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw circle outline
    ctx.strokeStyle = '#2980b9';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw ray segments
    // Define the set of rays
    // Define the set of rays
    const rayCount = 5;  // Number of rays
    const angleSpread = 2 * Math.PI / 180.0;  // Total spread (4 degrees, so ±2 degrees from center)

    const allRaySegments = [];

    for (let i = 0; i < rayCount; i++) {
      // Spread rays evenly from (rayAngle - angleSpread/2) to (rayAngle + angleSpread/2)
      const angle = rayAngle + (i / (rayCount - 1) - 0.5) * angleSpread;
      
      const raySegments = traceRay(
        { x: circle.x, y: circle.y },
        angle,
        mirrors,
        5,      // maxBounces
        2000    // maxDistance for final segment
      );
      
      allRaySegments.push(...raySegments);
    }
    //console.log('Ray segments:', raySegments);
    //console.log('Circle:', circle, 'Angle:', rayAngle, 'Mirrors:', mirrors);

    // Draw the ray segments
    ctx.strokeStyle = '#202020';
    ctx.lineWidth = 1;
    allRaySegments.forEach(seg => {
      ctx.beginPath();
      ctx.moveTo(seg.start.x, seg.start.y);
      ctx.lineTo(seg.end.x, seg.end.y);
      ctx.stroke();
    });

    // Draw mirrors
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 3;
    mirrors.forEach(mirror => {
      ctx.beginPath();
      ctx.moveTo(mirror.start.x, mirror.start.y);
      ctx.lineTo(mirror.end.x, mirror.end.y);
      ctx.stroke();
    });

  }, [circle, isRed, gridOn, rayAngle, mirrors]);

  // Handle mouse down
  const handlePointerDown = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const dist = Math.sqrt((mouseX - circle.x) ** 2 + (mouseY - circle.y) ** 2);
    const angleClick = Math.atan2(mouseY - circle.y, mouseX - circle.x);

    // Check if clicked inside circle
    if (dist < circle.radius) {
      setDraggingCircle(true);
      setOffset({
        x: mouseX - circle.x,
        y: mouseY - circle.y,
        angle: Math.atan2(mouseY - circle.y, mouseX - circle.x) - rayAngle
      });
    // Check if clicked in the rays' path
    } else if ((dist < 250) && (Math.abs(angleClick - rayAngle) <= 3.0*Math.PI/180.0)) {
      setDraggingRays(true);
      setOffset({
        x: mouseX - circle.x,
        y: mouseY - circle.y,
        angle: Math.atan2(mouseY - circle.y, mouseX - circle.x) - rayAngle
      });
    }
  };

  // Handle mouse move
  const handlePointerMove = (e) => {
    if (!(draggingCircle || draggingRays)) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (draggingCircle) {
      setCircle({
        ...circle,
        x: mouseX - offset.x,
        y: mouseY - offset.y,
      });
    } else if (draggingRays) {
      setRayAngle(Math.atan2(mouseY - circle.y, mouseX - circle.x) - offset.angle);
    }
  };

  // Handle mouse up
  const handlePointerUp = () => {
    setDraggingCircle(false);
    setDraggingRays(false);
  };

  return (
    <div className="container">
      <h1>Draggable Circle Simulator</h1>
      <p>Click and drag the blue circle around the canvas</p>
      <div style={{ marginBottom: '20px' }}>
        <label>
          <input
            type="checkbox"
            checked={isRed}
            onChange={(e) => setIsRed(e.target.checked)}
          />
          Make circle red
        </label>

        <label>
          <input
            type="checkbox"
            checked={gridOn}
            onChange={(e) => setGridOn(e.target.checked)}
          />
          Grid visible
        </label>
      </div>
      <canvas
        ref={canvasRef}
        width={800}
        height={600}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        style={{
          border: '2px solid #333',
          cursor: (draggingCircle || draggingRays) ? 'grabbing' : 'grab',
          touchAction: 'none'
        }}
      />
      <div className="info">
        Position: ({circle.x.toFixed(0)}, {circle.y.toFixed(0)})
      </div>
    </div>
  );
}