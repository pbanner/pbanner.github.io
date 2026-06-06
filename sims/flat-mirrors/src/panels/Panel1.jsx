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

function traceRay(startPoint, startAngle, mirrors, maxBounces = 5, maxDistance = 500) {
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
        bounced: bounce > 0
      });
      break;
    }
    
    //console.log(`  Hit mirror, adding segment; bounce=${bounce}`);
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

function reflectPointAcrossLine(point, lineStart, lineEnd) {
  // Vector along the line
  const lineDx = lineEnd.x - lineStart.x;
  const lineDy = lineEnd.y - lineStart.y;
  const lineLen = Math.sqrt(lineDx * lineDx + lineDy * lineDy);
  
  // Unit normal to the line (perpendicular)
  const normalX = -lineDy / lineLen;
  const normalY = lineDx / lineLen;
  
  // Vector from line start to point
  const toPointX = point.x - lineStart.x;
  const toPointY = point.y - lineStart.y;
  
  // Signed distance from point to line
  const distToLine = toPointX * normalX + toPointY * normalY;
  
  // Reflected point
  return {
    x: point.x - 2 * distToLine * normalX,
    y: point.y - 2 * distToLine * normalY
  };
}

function pointsOnSameSideOfLine(point1, point2, lineStart, lineEnd) {
  // Vector along the line
  const lineDx = lineEnd.x - lineStart.x;
  const lineDy = lineEnd.y - lineStart.y;
  
  // Normal to the line
  const normalX = -lineDy;
  const normalY = lineDx;
  
  // Signed distances
  const dist1 = (point1.x - lineStart.x) * normalX + (point1.y - lineStart.y) * normalY;
  const dist2 = (point2.x - lineStart.x) * normalX + (point2.y - lineStart.y) * normalY;
  
  return dist1 * dist2 >= 0; // Same sign means same side
}

function raysHitMirror(startPoint, angleSpread, rayCount, mirrors) {
  // Check if any ray in the bundle hits a mirror
  for (let i = 0; i < rayCount; i++) {
    const angle = startPoint.angle + (i / (rayCount - 1) - 0.5) * angleSpread;
    for (let m = 0; m < mirrors.length; m++) {
      const hit = rayHitsMirror(startPoint.point, angle, mirrors[m].start, mirrors[m].end, 2000);
      if (hit) return true;
    }
  }
  return false;
}

function closestPointOnSegment(point, segStart, segEnd) {
  const dx = segEnd.x - segStart.x;
  const dy = segEnd.y - segStart.y;
  const lenSq = dx * dx + dy * dy;
  
  if (lenSq === 0) return segStart;
  
  const t = Math.max(0, Math.min(1, ((point.x - segStart.x) * dx + (point.y - segStart.y) * dy) / lenSq));
  
  return {
    point: { x: segStart.x + t * dx, y: segStart.y + t * dy },
    distance: Math.sqrt((point.x - (segStart.x + t * dx)) ** 2 + (point.y - (segStart.y + t * dy)) ** 2),
    t: t
  };
}

function extendRayThroughMirror(raySegment, mirror, objectPoint) {
  // Extend the ray backward to where it appears to come from (the virtual image)
  
  // Direction of the ray
  const dx = raySegment.end.x - raySegment.start.x;
  const dy = raySegment.end.y - raySegment.start.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  
  if (len === 0) return null;
  
  // Reverse direction (going backward)
  const backDx = -dx / len;
  const backDy = -dy / len;
  
  // Calculate the virtual image point
  const virtualImage = reflectPointAcrossLine(objectPoint, mirror.start, mirror.end);
  
  // Extend from bounce point toward virtual image
  const toImageX = virtualImage.x - raySegment.start.x;
  const toImageY = virtualImage.y - raySegment.start.y;
  const distToImage = Math.sqrt(toImageX * toImageX + toImageY * toImageY);
  
  return {
    start: raySegment.end,
    end: virtualImage
  };
}

function distancePointToLine(point, lineStart, lineEnd) {
  // Vector along the line
  const lineDx = lineEnd.x - lineStart.x;
  const lineDy = lineEnd.y - lineStart.y;
  const lineLen = Math.sqrt(lineDx * lineDx + lineDy * lineDy);
  
  // Unit normal to the line
  const normalX = -lineDy / lineLen;
  const normalY = lineDx / lineLen;
  
  // Vector from line start to point
  const toPointX = point.x - lineStart.x;
  const toPointY = point.y - lineStart.y;
  
  // Perpendicular distance
  return Math.abs(toPointX * normalX + toPointY * normalY);
}

/************************************************
 * 
 *   Main App
 * 
************************************************/

export default function Panel1({ gridOn, mirrorAngle, setMirrorAngle }) {
  const GRID_SPACING = 50;
  const MIRROR_WIDTH = 10;
  const MAX_RAY_DISTANCE = 1000;
  const RAY_COUNT = 5;
  const RAY_ANGLE_SPREAD = 2 * Math.PI / 180.0;
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
  const [canSeeImage, setCanSeeImage] = useState(true);

  // This function returns the position and size of the mirror at 0° angle
  // (i.e. before rotation). 'x' and 'y' are the "top" center of the mirror
  // and 'width' and 'height' are, well, that.
  const getMirrorPosition = () => {
    const mirrorHeightRatio = 0.6;
    
    return {
      x: Math.round(canvasDims.width / 2 / GRID_SPACING) * GRID_SPACING,
      y: (canvasDims.height - canvasDims.height * mirrorHeightRatio) / 2,
      width: MIRROR_WIDTH,
      height: canvasDims.height * mirrorHeightRatio,
    };
  };

  // On initialization: resize canvas to fill container
  // Dependency array = [] means it runs once on initialization
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

    const mirror = getMirrorPosition();
    setMirrors([{ 
      start: { x: mirror.x, y: mirror.y }, 
      end: { x: mirror.x, y: mirror.y + mirror.height } 
    }]);
    mirrorInitializedRef.current = true;

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, []);

  // EFFECT 1b: Wait for the eye image to be loaded, so it gets drawn
  useEffect(() => {
    const img = new Image();
    img.src = eyeImage;
    img.onload = () => {
      eyeImageRef.current = img;
      setImageLoaded(true);  // Trigger redraw
    };
  }, []);

  useEffect(() => {
    if (mirrors.length === 0) return;
    
    const mirror = mirrors[0];
    
    // Check if eye and object are on same side of mirror
    if (!pointsOnSameSideOfLine(eye, circle, mirror.start, mirror.end)) {
      setCanSeeImage(false);
      return;
    }
    
    // Calculate reflected eye and angle
    const reflectedEye = reflectPointAcrossLine(eye, mirror.start, mirror.end);
    const angleToReflectedEye = Math.atan2(
      reflectedEye.y - circle.y,
      reflectedEye.x - circle.x
    );
    
    // Check if a ray in that direction actually hits the mirror
    //const hit = rayHitsMirror(circle, angleToReflectedEye, mirror.start, mirror.end, 2000);
    const hitsBundle = raysHitMirror({ point: circle, angle: angleToReflectedEye }, RAY_ANGLE_SPREAD*1.20, RAY_COUNT, mirrors);
    
    if (!hitsBundle) {
      setCanSeeImage(false);
      return;
    }
    
    // Both conditions met: update ray angle
    setCanSeeImage(true);
    setRayAngle(angleToReflectedEye);
  }, [circle, eye, mirrors]);

  useEffect(() => {
    const mirror = getMirrorPosition();
    const mirrorHeight = mirror.height;
    const centerX = mirror.x;
    const centerY = mirror.y + mirrorHeight / 2;
    
    // Original start and end (before rotation)
    const halfHeight = mirrorHeight / 2;
    const originalStart = { x: centerX, y: centerY - halfHeight };
    const originalEnd = { x: centerX, y: centerY + halfHeight };
    
    // Rotate points around center using 2D rotation matrix
    const rotatePoint = (point, center, angle) => {
      const x = point.x - center.x;
      const y = point.y - center.y;
      return {
        x: center.x + x * Math.cos(angle) - y * Math.sin(angle),
        y: center.y + x * Math.sin(angle) + y * Math.cos(angle)
      };
    };
    
    const start = rotatePoint(originalStart, { x: centerX, y: centerY }, mirrorAngle);
    const end = rotatePoint(originalEnd, { x: centerX, y: centerY }, mirrorAngle);
    
    setMirrors([{ start, end }]);
  }, [mirrorAngle, canvasDims]);

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

    // Draw mirror (rotated around its center)
    // const mirror = mirrors[0];
    // if (mirror) {
    //   const mirrorHeight = mirror.end.y - mirror.start.y;
    //   const mirrorCenterX = mirror.start.x;
    //   const mirrorCenterY = mirror.start.y + mirrorHeight / 2;
      
    //   ctx.save();
    //   ctx.translate(mirrorCenterX, mirrorCenterY);
    //   ctx.rotate(mirrorAngle);
    //   ctx.fillStyle = '#3498db';
    //   ctx.fillRect(-10, -mirrorHeight / 2, 20, mirrorHeight);
    //   ctx.restore();
    // }
    // Draw mirror using rotated endpoints
    const mirror = mirrors[0];
    if (mirror) {
      ctx.strokeStyle = '#3498db';
      ctx.lineWidth = MIRROR_WIDTH;
      //ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(mirror.start.x, mirror.start.y);
      ctx.lineTo(mirror.end.x, mirror.end.y);
      ctx.stroke();
    }

    // Draw ray segments
    var allRaySegments = [];

    for (let i = 0; i < RAY_COUNT; i++) {
      const angle = rayAngle + (i / (RAY_COUNT - 1) - 0.5) * RAY_ANGLE_SPREAD;
      const raySegments = traceRay(
        { x: circle.x, y: circle.y },
        angle,
        mirrors,
        5,
        MAX_RAY_DISTANCE
      );
      allRaySegments.push(...raySegments);
    }

    if (canSeeImage) {
      const eyeHitbox = 25;
      allRaySegments = allRaySegments.map(seg => {
        const closest = closestPointOnSegment(eye, seg.start, seg.end);
        // If eye is close to this segment, truncate at closest point
        if (closest.distance < eyeHitbox && closest.t < 1) {
          return { ...seg, end: closest.point };
        }
        return seg;
      });
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

    // Draw virtual rays (if canSeeImage)
    if (canSeeImage && mirrors.length > 0) {
      const virtualImageDistance = distancePointToLine(circle, mirrors[0].start, mirrors[0].end);

      ctx.strokeStyle = '#999999';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]); // Dashed line pattern
      
      allRaySegments.forEach(seg => {
        if (seg.bounced) {
          const virtualRay = extendRayThroughMirror(seg, mirrors[0], circle);
          if (virtualRay) {
            ctx.beginPath();
            ctx.moveTo(virtualRay.start.x, virtualRay.start.y);
            ctx.lineTo(virtualRay.end.x, virtualRay.end.y);
            ctx.stroke();
          }
        }
      });
      
      ctx.setLineDash([]); // Reset to solid lines
    }

    // Draw circle
    ctx.fillStyle = '#3498db';
    ctx.beginPath();
    ctx.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2980b9';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Draw virtual image
    if (canSeeImage && mirrors.length > 0) {
      const virtualImage = reflectPointAcrossLine(circle, mirrors[0].start, mirrors[0].end);
      ctx.fillStyle = '#3498db80';
      ctx.beginPath();
      ctx.arc(virtualImage.x, virtualImage.y, circle.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#2980b980';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Draw eye
    if (eyeImageRef.current && eyeImageRef.current.complete) {
      ctx.drawImage(eyeImageRef.current, eye.x - EYE_WIDTH / 2, eye.y - EYE_HEIGHT / 2, EYE_WIDTH, EYE_HEIGHT);
    }

  }, [circle, eye, gridOn, mirrors, rayAngle, canvasDims, imageLoaded]);

  // Pointer handlers
  const handlePointerDown = (e) => {
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

  const handlePointerMove = (e) => {
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
      //setRayAngle(Math.atan2(mouseY - circle.y, mouseX - circle.x) - offset.angle)
    } else if (draggingCircle) {
      setCircle({
        ...circle,
        x: Math.max(circle.radius, Math.min(canvas.width - circle.radius, mouseX - offset.x)),
        y: Math.max(circle.radius, Math.min(canvas.height - circle.radius, mouseY - offset.y)),
      });
    }
  };

  const handlePointerUp = () => {
    setDraggingCircle(false);
    setDraggingEye(false);
  };

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        style={{
          cursor: draggingCircle ? 'grabbing' : 'grab',
          display: 'block',
        }}
      />
    </div>
  );
}