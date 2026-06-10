import React, { useRef, useEffect, useState } from 'react';
import eyeImage from '../assets/eye-small.png';

/************************************************
 * 
 *   Ray-Mirror Collision Handling
 * 
************************************************/

const RAY_COUNT = 5;
const RAY_ANGLE_SPREAD = 2 * Math.PI / 180.0;

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

function traceRay(startPoint, startAngle, mirrors, mirrorAngle, mirrorHeight, maxBounces = 5, maxDistance = 500) {
  const segments = [];
  let currentPoint = startPoint;
  let currentAngle = startAngle;
  
  for (let bounce = 0; bounce < maxBounces; bounce++) {
    let closest = null;
    for (let i = 0; i < mirrors.length; i++) {
      const endpoints = getMirrorEndpoints(mirrors[i], mirrorAngle, mirrorHeight);
      const hit = rayHitsMirror(currentPoint, currentAngle, endpoints.start, endpoints.end, maxDistance);
      if (hit && (!closest || hit.t < closest.t)) {
        hit.mirrorIndex = i;
        closest = hit;
      }
    }
    
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
    
    segments.push({
      start: currentPoint,
      end: closest.hitPoint,
      bounced: bounce > 0
    });
    
    const endpoints = getMirrorEndpoints(mirrors[closest.mirrorIndex], mirrorAngle, mirrorHeight);
    const mirrorNormal = getMirrorNormal(endpoints.start, endpoints.end);
    currentPoint = closest.hitPoint;
    currentAngle = reflectRay(currentAngle, mirrorNormal);
  }
  
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

function raysHitMirror(startPoint, angleSpread, rayCount, mirrors, mirrorAngle, mirrorHeight) {
  // Check if any ray in the bundle hits a mirror
  for (let i = 0; i < rayCount; i++) {
    const angle = startPoint.angle + (i / (rayCount - 1) - 0.5) * angleSpread;
    for (let m = 0; m < mirrors.length; m++) {
      const endpoints = getMirrorEndpoints(mirrors[m], mirrorAngle, mirrorHeight);
      const hit = rayHitsMirror(startPoint.point, angle, endpoints.start, endpoints.end, 2000);
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

function canSeeVirtualImage(circle, eye, mirrors, mirrorAngle, rayCount, angleSpread, mirrorHeight) {
  if (mirrors.length === 0) return false;
  
  const mirrorCenter = mirrors[0];
  const mirrorEndpoints = getMirrorEndpoints(mirrorCenter, mirrorAngle, mirrorHeight);
  
  // Check if eye and object are on same side of mirror
  if (!pointsOnSameSideOfLine(eye, circle, mirrorEndpoints.start, mirrorEndpoints.end)) {
    return false;
  }
  
  // Calculate reflected eye and angle
  const reflectedEye = reflectPointAcrossLine(eye, mirrorEndpoints.start, mirrorEndpoints.end);
  const angleToReflectedEye = Math.atan2(
    reflectedEye.y - circle.y,
    reflectedEye.x - circle.x
  );
  
  // Check if a ray in that direction actually hits the mirror
  return raysHitMirror(
    { point: circle, angle: angleToReflectedEye }, 
    angleSpread * 1.20, 
    rayCount, 
    mirrors,
    mirrorAngle,
    mirrorHeight
  );
}

function getMirrorEndpoints(mirrorCenter, mirrorAngle, mirrorHeight) {
  // Given a mirror center, rotation angle, and height,
  // return the start and end points of the mirror
  const halfHeight = mirrorHeight / 2;
  
  const originalStart = { x: mirrorCenter.x, y: mirrorCenter.y - halfHeight };
  const originalEnd = { x: mirrorCenter.x, y: mirrorCenter.y + halfHeight };
  
  const rotatePoint = (point, center, angle) => {
    const x = point.x - center.x;
    const y = point.y - center.y;
    return {
      x: center.x + x * Math.cos(angle) - y * Math.sin(angle),
      y: center.y + x * Math.sin(angle) + y * Math.cos(angle)
    };
  };
  
  return {
    start: rotatePoint(originalStart, mirrorCenter, mirrorAngle),
    end: rotatePoint(originalEnd, mirrorCenter, mirrorAngle)
  };
}

function findNearestSnappable(point, circle, eye, mirrors, mirrorAngle, mirrorHeight, measurementCoords) {
  const SNAP_DISTANCE = 20; // pixels
  const candidates = [];
  
  // Gather all the possible snap points
  // Measurement start and end point
  // measurementCoords is always passed in in such a way as to not be self-referential
  for (let i = 0; i < measurementCoords.length; i++) {
    const coord = measurementCoords[i];
    candidates.push({
      point: coord.start,
      distance: Math.sqrt((point.x - coord.start.x) ** 2 + (point.y - coord.start.y) ** 2),
      label: 'measurement point'
    })
    candidates.push({
      point: coord.end,
      distance: Math.sqrt((point.x - coord.end.x) ** 2 + (point.y - coord.end.y) ** 2),
      label: 'measurement point'
    })
  }
  // Nearest point on mirror
  if (mirrors.length > 0) {
    //const mirrorHeight = mirrors[0] ? Math.sqrt((mirrorHeight * mirrorHeight)) : 0;
    const mirrorEndpoints = getMirrorEndpoints(mirrors[0], mirrorAngle, mirrorHeight);
    const closest = closestPointOnSegment(point, mirrorEndpoints.start, mirrorEndpoints.end);

    candidates.push({
      point: closest.point,
      distance: closest.distance,
      label: 'mirror'
    });

    const snapDistanceSq = SNAP_DISTANCE * SNAP_DISTANCE; // Avoid sqrt in comparison
    for (let i = 0; i < candidates.length-1; i++) {
      const cand = candidates[i];
      const dx = closest.point.x - cand.point.x;
      const dy = closest.point.y - cand.point.y;
      const distanceSq = dx * dx + dy * dy;
      
      if (distanceSq < snapDistanceSq) {
        candidates.pop();
        break;
      }
    }
  }

  // Circle center
  candidates.push({
    point: { x: circle.x, y: circle.y },
    distance: Math.sqrt((point.x - circle.x) ** 2 + (point.y - circle.y) ** 2),
    label: 'circle'
  });
  // Eye center
  candidates.push({
    point: { x: eye.x, y: eye.y },
    distance: Math.sqrt((point.x - eye.x) ** 2 + (point.y - eye.y) ** 2),
    label: 'eye'
  });
  // Virtual image
  const imageVisible = canSeeVirtualImage(circle, eye, mirrors, mirrorAngle, RAY_COUNT, RAY_ANGLE_SPREAD, mirrorHeight);
  if (imageVisible) {
    const mirrorEndpoints = getMirrorEndpoints(mirrors[0], mirrorAngle, mirrorHeight);
    const viPoint = reflectPointAcrossLine(circle, mirrorEndpoints.start, mirrorEndpoints.end);
    candidates.push({
      point: { x: viPoint.x, y: viPoint.y },
      distance: Math.sqrt((point.x - viPoint.x) ** 2 + (point.y - viPoint.y) ** 2),
      label: 'virtual image'
    });
  }
  
  // Return closest if within snap distance
  const nearest = candidates.reduce((a, b) => a.distance < b.distance ? a : b);
  
  if (nearest.distance < SNAP_DISTANCE) {
    return nearest.point;
  }
  
  return null;
}

function findCentralRayIntersection(circle, rayAngle, mirrors, mirrorAngle, mirrorHeight) {
  // The central ray is the one at rayAngle (middle of the spread)
  const mirrorCenter = mirrors[0];
  const mirrorEndpoints = getMirrorEndpoints(mirrorCenter, mirrorAngle, mirrorHeight);
  
  const hit = rayHitsMirror(
    { x: circle.x, y: circle.y },
    rayAngle,
    mirrorEndpoints.start,
    mirrorEndpoints.end,
    10000
  );
  
  if (!hit) return null;
  
  return {
    hitPoint: hit.hitPoint,
    mirrorEndpoints: mirrorEndpoints,
    rayAngle: rayAngle
  };
}

/************************************************
 * 
 *   Main App
 * 
************************************************/

export default function Panel1({ mirrorAngle, measuringMode, measurementCoords, setMeasurementCoords, displayBools }) {

  const GRID_SPACING = 50;
  const MIRROR_WIDTH = 10;
  const MIRROR_HEIGHT_RATIO = 0.6;  // Height as fraction of canvas height
  const MAX_RAY_DISTANCE = 1000;
  const EYE_HEIGHT = 50; // pixels
  const EYE_WIDTH = 40; // pixels

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const eyeImageRef = useRef(null);
  // This Boolean exists solely to make sure the final drawing occurs after
  // the eye image has loaded
  const [eyeImageLoaded, setEyeImageLoaded] = useState(false);
  
  // Canvas dimensions; gets written over on initialization
  const [canvasDims, setCanvasDims] = useState({ width: 800, height: 600 });
  // Mirror center; gets written over on initialization
  const [mirrors, setMirrors] = useState([{ x: 400, y: 300 }]);
  const [rayAngle, setRayAngle] = useState(8*Math.PI/180);

  // Objects and dragging variables
  const [circle, setCircle] = useState({ x: 300, y: 200, radius: 8 });
  const [eye, setEye] = useState({ x: 300, y: 400 });
  // Event handler state variables
  // A string that can be '', 'object', 'eye'
  const [hovering, setHovering] = useState('')
  // A string that can be '', 'object', 'eye'
  const [dragging, setDragging] = useState('')
  // Used for dragging seamlessly
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  // On initialization: resize canvas to fill container, then set the
  // mirror to be centered vertically and horizontally on the sized canvas.
  // Also, load the eye image and make sure it's loaded.
  // Dependency array = [] means it runs once on initialization
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // Load the eye image, trigger a redraw once loaded
    const img = new Image();
    img.src = eyeImage;
    img.onload = () => {
      eyeImageRef.current = img;
      setEyeImageLoaded(true);  // Trigger redraw
    };

    // Rezise the canvas
    const resizeCanvas = () => {
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      canvas.width = newWidth;
      canvas.height = newHeight;
      setCanvasDims({ width: newWidth, height: newHeight });
    };
    resizeCanvas();

    // Put the mirror center in the center of canvas
    // Round the horizontal position to the nearest grid line
    const mirrorCenterX = Math.round(canvasDims.width / 2 / GRID_SPACING) * GRID_SPACING;
    const mirrorCenterY = canvasDims.height / 2;
    setMirrors([{ x: mirrorCenterX, y: mirrorCenterY }]);

    // Make simulation responsive to window size changes
    //window.addEventListener('resize', resizeCanvas);
    //return () => window.removeEventListener('resize', resizeCanvas);
  }, []);

  // Adding Escape and backspace event handlers for during measurement mode
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (measuringMode) {
        if (e.key === 'Escape' && dragging === 'measuring') {
          setMeasurementCoords(measurementCoords.slice(0, -1));
          setDragging('');
        } else if (e.key === 'Backspace' && measurementCoords.length > 0) {
          setMeasurementCoords(measurementCoords.slice(0, -1));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [measuringMode, dragging, measurementCoords]);

  // Set the ray angle any time the circle, eye, or mirrors are changed
  // The idea is to set it to the angle that makes the rays go into the eye when
  // they do so (i.e. when the virtual image is visible), and to do nothing otherwise.
  useEffect(() => {
    if (mirrors.length === 0) return;
    const mirrorHeight = canvasDims.height * MIRROR_HEIGHT_RATIO;
    const imageVisible = canSeeVirtualImage(circle, eye, mirrors, mirrorAngle, RAY_COUNT, RAY_ANGLE_SPREAD, mirrorHeight);
    //console.log(imageVisible);
    if (!imageVisible) return;
    
    const mirrorCenter = mirrors[0];
    const mirrorEndpoints = getMirrorEndpoints(mirrorCenter, mirrorAngle, canvasDims.height * MIRROR_HEIGHT_RATIO);
    const reflectedEye = reflectPointAcrossLine(eye, mirrorEndpoints.start, mirrorEndpoints.end);
    const angleToReflectedEye = Math.atan2(
      reflectedEye.y - circle.y,
      reflectedEye.x - circle.x
    );
    
    setRayAngle(angleToReflectedEye);
  }, [circle, eye, mirrors, mirrorAngle, canvasDims]);

  // When canvas dims change, recenter the mirror horizontally but keep y-position
  useEffect(() => {
    if (mirrors.length === 0) return;
    
    const mirrorCenterX = Math.round(canvasDims.width / 2 / GRID_SPACING) * GRID_SPACING;
    const mirrorCenterY = canvasDims.height / 2;
    setMirrors([{ x: mirrorCenterX, y: mirrorCenterY }]);
  }, [canvasDims]);

  // Draw everything
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // Clear canvas
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid
    ctx.strokeStyle = displayBools.gridOn ? '#e0e0e0' : '#ffffff';
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

    // Some things that will be used a lot
    const mirrorHeight = canvasDims.height * MIRROR_HEIGHT_RATIO;
    // Calculate visibility once
    const imageVisible = canSeeVirtualImage(circle, eye, mirrors, mirrorAngle, RAY_COUNT, RAY_ANGLE_SPREAD, mirrorHeight);
    // Get the mirror endpoints... if there's ever no mirrors, well, give up
    let mirrorEndpoints = null;
    if (mirrors.length > 0) {
      mirrorEndpoints = getMirrorEndpoints(mirrors[0], mirrorAngle, mirrorHeight);
    } else {
      return;
    }

    // Draw mirror (using placed and rotated endpoints)
    ctx.strokeStyle = '#3498db';
    ctx.lineWidth = MIRROR_WIDTH;
    ctx.beginPath();
    ctx.moveTo(mirrorEndpoints.start.x, mirrorEndpoints.start.y);
    ctx.lineTo(mirrorEndpoints.end.x, mirrorEndpoints.end.y);
    ctx.stroke();

    // Calculate ray segments for drawing
    var allRaySegments = [];
    if (imageVisible) {
      for (let i = 0; i < RAY_COUNT; i++) {
        const angle = rayAngle + (i / (RAY_COUNT - 1) - 0.5) * RAY_ANGLE_SPREAD;
        const raySegments = traceRay(
          { x: circle.x, y: circle.y },
          angle,
          mirrors,
          mirrorAngle,
          mirrorHeight,
          5,
          MAX_RAY_DISTANCE
        );
        allRaySegments.push(...raySegments);
      }
      // Truncate ray segments at the eye if they're entering the eye
      if (imageVisible) {
        const eyeHitbox = 25;
        allRaySegments = allRaySegments.map(seg => {
          if (seg.bounced) {
            const closest = closestPointOnSegment(eye, seg.start, seg.end);
            // If eye is close to this segment, truncate at closest point
            if (closest.distance < eyeHitbox && closest.t < 1) {
              return { ...seg, end: closest.point };
            }
          }
          return seg;
        });
      }
      // Draw the ray segments
      ctx.strokeStyle = '#202020';
      ctx.lineWidth = 1.5;
      allRaySegments.forEach(seg => {
        ctx.beginPath();
        ctx.moveTo(seg.start.x, seg.start.y);
        ctx.lineTo(seg.end.x, seg.end.y);
        ctx.stroke();
      });
    }

    // Draw additional rays if desired
    if (displayBools.showAddlRays) {
      const ADDL_RAYS_NUM = 20;
      var addlRaySegments = [];
      for (let i = 0; i < ADDL_RAYS_NUM; i++) {
        const angle = i*2*Math.PI/ADDL_RAYS_NUM;
        const raySegments = traceRay(
          { x: circle.x, y: circle.y },
          angle,
          mirrors,
          mirrorAngle,
          mirrorHeight,
          5,
          MAX_RAY_DISTANCE
        );
        addlRaySegments.push(...raySegments);
      }
      // Truncate ray segments at the eye if they're entering the eye
      const eyeHitbox = 25;
      addlRaySegments = addlRaySegments.map(seg => {
        if (seg.bounced) {
          const closest = closestPointOnSegment(eye, seg.start, seg.end);
          // If eye is close to this segment, truncate at closest point
          if (closest.distance < eyeHitbox && closest.t < 1) {
            return { ...seg, end: closest.point };
          }
        }
        return seg;
      });
      // Draw the ray segments
      ctx.strokeStyle = '#206491';
      ctx.lineWidth = 1.0;
      addlRaySegments.forEach(seg => {
        ctx.beginPath();
        ctx.moveTo(seg.start.x, seg.start.y);
        ctx.lineTo(seg.end.x, seg.end.y);
        ctx.stroke();
      });
      // The next thing we will do is calculate tracebacks for all the rays
      // We want these additional rays to be part of that, so let's push
      // these rays into allRaySegments
      allRaySegments.push(...addlRaySegments);
    }

    // Draw virtual rays and image if visible
    if (imageVisible && displayBools.showVirtualImage) {
      ctx.strokeStyle = '#999999'; //was #999999
      ctx.lineWidth = 1.5;
      ctx.setLineDash([10, 8]);
      
      allRaySegments.forEach(seg => {
        if (seg.bounced) {
          const virtualRay = extendRayThroughMirror(seg, { start: mirrorEndpoints.start, end: mirrorEndpoints.end }, circle);
          if (virtualRay) {
            ctx.beginPath();
            ctx.moveTo(virtualRay.start.x, virtualRay.start.y);
            ctx.lineTo(virtualRay.end.x, virtualRay.end.y);
            ctx.stroke();
          }
        }
      });
      
      ctx.setLineDash([]); // Reset to solid lines
      
      // Draw virtual image
      const virtualImage = reflectPointAcrossLine(circle, mirrorEndpoints.start, mirrorEndpoints.end);
      ctx.fillStyle = '#3498db80';
      ctx.beginPath();
      ctx.arc(virtualImage.x, virtualImage.y, circle.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#2980b980';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Draw circle
    ctx.fillStyle = '#3498db';
    ctx.beginPath();
    ctx.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2980b9';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw eye
    // if (eyeImageRef.current && eyeImageRef.current.complete) {
    //   ctx.drawImage(eyeImageRef.current, eye.x - EYE_WIDTH / 2, eye.y - EYE_HEIGHT / 2, EYE_WIDTH, EYE_HEIGHT);
    // }
    // Draw eye
    let eyeAngle = 0
    const hitData = findCentralRayIntersection(circle, rayAngle, mirrors, mirrorAngle, mirrorHeight);
    if (hitData && imageVisible) {
      const hitPoint = hitData.hitPoint;
      eyeAngle = Math.atan2(hitPoint.y - eye.y, hitPoint.x - eye.x);
    }
    if (eyeImageRef.current && eyeImageRef.current.complete) {
      ctx.save();
      ctx.translate(eye.x, eye.y);           // Move origin to eye center
      ctx.rotate(eyeAngle);                  // Rotate around that point
      ctx.drawImage(eyeImageRef.current, -EYE_WIDTH / 2, -EYE_HEIGHT / 2, EYE_WIDTH, EYE_HEIGHT);
      ctx.restore();
    }

    // Draw measurements if active
    if (displayBools.showMeasurements && measurementCoords) {
      for (let i = 0; i < measurementCoords.length; i++) {
        const coord = measurementCoords[i];

        if ((i === measurementCoords.length - 1) && (coord.start == coord.end)) {
          ctx.fillStyle = '#303030';
          ctx.beginPath();
          ctx.arc(coord.start.x, coord.start.y, 4, 0, Math.PI * 2);
          ctx.fill();
          break;
        }

        const dx = coord.end.x - coord.start.x;
        const dy = coord.end.y - coord.start.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Draw line
        ctx.strokeStyle = '#303030';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(coord.start.x, coord.start.y);
        ctx.lineTo(coord.end.x, coord.end.y);
        ctx.stroke();

        // Draw end caps
        ctx.fillStyle = '#303030';
        ctx.beginPath();
        ctx.arc(coord.start.x, coord.start.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(coord.end.x, coord.end.y, 4, 0, Math.PI * 2);
        ctx.fill();

        // Draw distance label
        const midX = (coord.start.x + coord.end.x) / 2;
        const midY = (coord.start.y + coord.end.y) / 2;
        ctx.fillStyle = '#303030';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${(distance/50.0).toFixed(2)} cm`, midX, midY - 15);
      }
    }

    // Draw normal line to the mirror
    if (displayBools.normalView) {
      let mirrorNormal = getMirrorNormal(mirrorEndpoints.start, mirrorEndpoints.end);
      // Normal line will always be on the same side of the mirror as the eye;
      // check via dot product with eye-mirror vector. Use the mirror endpoint
      // start to form the vector.
      const dotProductCheck = mirrorNormal.x*(eye.x - mirrorEndpoints.start.x) + mirrorNormal.y*(eye.y - mirrorEndpoints.start.y);
      if (dotProductCheck < 0) {
        mirrorNormal = { x: -mirrorNormal.x, y: -mirrorNormal.y };
      }
      const hitData = findCentralRayIntersection(circle, rayAngle, mirrors, mirrorAngle, mirrorHeight);
      let startPoint = mirrors[0]
      if (hitData && imageVisible) {
        startPoint = hitData.hitPoint
      } else {
        startPoint = { x: startPoint.x - mirrorNormal.x*250, y: startPoint.y - mirrorNormal.y*250 }
      }
      ctx.strokeStyle = '#236d9e';
      ctx.lineWidth = 2.0;
      ctx.setLineDash([7, 7]);
      ctx.beginPath();
      ctx.moveTo(startPoint.x, startPoint.y);
      ctx.lineTo(startPoint.x + mirrorNormal.x * 500, startPoint.y + mirrorNormal.y * 500);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw the incident and reflected angles
      if (displayBools.anglesView && hitData && imageVisible) {
        const LBL_MULT = 1.25;
        const REFL_ARC_ADD = 10;
        const hitPoint = hitData.hitPoint;
        const normalAngle = Math.atan2(mirrorNormal.y, mirrorNormal.x);
        const incidentRayAngle = Math.atan2(circle.y - hitPoint.y, circle.x - hitPoint.x);
        const reflectedRayAngle = Math.atan2(eye.y - hitPoint.y, eye.x - hitPoint.x);

        const incidentArcRadius = Math.sqrt((circle.x - hitPoint.x)**2 + (circle.y - hitPoint.y)**2);
        const reflectedArcRadius = Math.sqrt((eye.x - hitPoint.x)**2 + (eye.y - hitPoint.y)**2);

        /*
        Drawing arcs in JSX is incredibly stupid. The start and end angles are measured *clockwise*
        from the positive x-axis, and by default the arc between them is drawn clockwise. In other
        words, the drawing direction isn't set by the one that produces the shortest arc, it's set by
        some default or some input condition. So we need to determine this direction ourselves. All
        angles wrap at ±180°, so we must also contend with that.

        The shortest way I found to do it is this. Normally (e.g. if both angles are positive and neither
        has wrapped), then if the incident angle is greater than the normal angle, we need to draw clockwise.
        If one of the angles has wrapped, we can tell by checking |normal angle - incident angle| > 180°, 
        which it can never be due to the physics of the situation alone. If that happens, we know we have 
        wrapping to contend with; to fix this, we add 2*pi to the negative one. That brings the original
        condition back to being enforced correctly. 
        */

        // cond = 0 means neither angle will be adjusted, 1 = normalAngle, 2 = incidentRayAngle
        let cond = 0;
        if (Math.abs(normalAngle - incidentRayAngle) > Math.PI) {
          if (normalAngle < 0) {
            cond = 1;
          } else {
            cond = 2;
          }
        }      
        // Draw the incident angle arc
        ctx.strokeStyle = '#27ae60';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(
          hitPoint.x,
          hitPoint.y,
          incidentArcRadius/2,
          normalAngle,
          incidentRayAngle, (incidentRayAngle + 2*Math.PI*(cond === 2)) < (normalAngle + 2*Math.PI*(cond === 1))
        );
        ctx.stroke();
        // For the incident angle label
        const incidentMidAngle = (normalAngle + incidentRayAngle + 2*Math.PI*(cond === 1) + 2*Math.PI*(cond === 2)) / 2;
        const labelRadius = incidentArcRadius/2 + 25; // arc radius + offset
        const labelX = hitPoint.x + labelRadius * Math.cos(incidentMidAngle);
        const labelY = hitPoint.y + labelRadius * Math.sin(incidentMidAngle);

        ctx.fillStyle = '#27ae60';
        ctx.font = '16px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          (Math.abs(incidentRayAngle + 2*Math.PI*(cond === 2) - normalAngle - 2*Math.PI*(cond === 1)) * 180 / Math.PI).toFixed(1) + "°",
          labelX,
          labelY
        );
        
        // Now we will apply the same logic to the reflected ray. It's kind of crazy that we can apply the
        // exact same logic, but there are actually two subtle sign flips. First, there is one sign flip
        // caused by starting both arcs (incident and reflected) at the normal angle. Second, there is a 
        // subtle sign flip caused by enforcing both incidentAngle < normalAngle *and* reflectedAngle < normalAngle.
        // This is due to the law of reflection: reflectedAngle = 2*normalAngle - incidentAngle (ignoring wrapping).
        // So reflectedAngle < normalAngle really means incidentAngle > normalAngle! Physics.
        cond = 0;
        if (Math.abs(normalAngle - reflectedRayAngle) > Math.PI) {
          if (normalAngle < 0) {
            cond = 1;
          } else {
            cond = 2;
          }
        }
        // Reflected angle arc
        ctx.strokeStyle = '#9b59b6';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(
          hitPoint.x,
          hitPoint.y,
          reflectedArcRadius/2,
          normalAngle,
          reflectedRayAngle, (reflectedRayAngle + 2*Math.PI*(cond === 2)) < (normalAngle + 2*Math.PI*(cond === 1))
        );
        ctx.stroke();
        // For the incident angle label
        const reflectedMidAngle = (normalAngle + reflectedRayAngle + 2*Math.PI*(cond === 1) + 2*Math.PI*(cond === 2)) / 2;
        const reflectedLabelRadius = reflectedArcRadius/2 + 25; // arc radius + offset
        const labelXR = hitPoint.x + reflectedLabelRadius * Math.cos(reflectedMidAngle);
        const labelYR = hitPoint.y + reflectedLabelRadius * Math.sin(reflectedMidAngle);

        ctx.fillStyle = '#9b59b6';
        ctx.font = '16px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          (Math.abs(reflectedRayAngle + 2*Math.PI*(cond === 2) - normalAngle - 2*Math.PI*(cond === 1)) * 180 / Math.PI).toFixed(1) + "°",
          labelXR,
          labelYR
        );
      }
    }
  }, [circle, eye, mirrors, rayAngle, canvasDims, eyeImageLoaded, mirrorAngle, measuringMode, measurementCoords, displayBools]);
  // Note that rayAngle is required here, even though it's a dependency on cricle + eye + mirrors,
  // because those things updating sets ray angle which triggers a redraw

  // Pointer handlers
  function senseElements(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const distToCircle = Math.sqrt((mouseX - circle.x) ** 2 + (mouseY - circle.y) ** 2);
    const distToEye = Math.sqrt((mouseX - eye.x) ** 2 + (mouseY - eye.y) ** 2);

    if (distToEye < 25) { // Eye hitbox
      return({ element: 'eye', x: mouseX - eye.x, y: mouseY - eye.y })
    } else if (distToCircle < circle.radius + 5) {
      return({ element: 'circle', x: mouseX - circle.x, y: mouseY - circle.y })
    } else {
      return({ element: '', x: 0, y: 0 })
    }
  }

  const handlePointerDown = (e) => {
    // If in measuring mode, start measurement
    if (measuringMode) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      let startPoint = { x: mouseX, y: mouseY };

      // Snap if Shift is held
      if (e.shiftKey) {
        const mirrorHeight = canvasDims.height * MIRROR_HEIGHT_RATIO;
        const snapped = findNearestSnappable(startPoint, circle, eye, mirrors, mirrorAngle, mirrorHeight, measurementCoords);
        if (snapped) {
          startPoint = snapped;
        }
      }

      setMeasurementCoords([ ...measurementCoords, { start: startPoint, end: startPoint }]);
      setDragging('measuring');
      return;
    }

    const sensedElement = senseElements(e)

    if (sensedElement.element === 'eye') { // Eye hitbox
      setDragging('eye');
      setOffset({ x: sensedElement.x, y: sensedElement.y });
    } else if (sensedElement.element === 'circle') {
      setDragging('circle');
      setOffset({ x: sensedElement.x, y: sensedElement.y });
    }
  };

  const handlePointerMove = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Handle measurement dragging
    if (measuringMode) {
      setHovering('')
      if (dragging === 'measuring') {
        let endPoint = { x: mouseX, y: mouseY };
        // Snap if Shift is held
        if (e.shiftKey) {
          const mirrorHeight = canvasDims.height * MIRROR_HEIGHT_RATIO;
          const snapped = findNearestSnappable(endPoint, circle, eye, mirrors, mirrorAngle, mirrorHeight, measurementCoords.slice(0, -1));
          if (snapped) {
            endPoint = snapped;
          }
        }
        setMeasurementCoords(measurementCoords => [
          ...measurementCoords.slice(0, -1),
          { ...measurementCoords[measurementCoords.length - 1], end: endPoint }
        ])
        return;
      }
      return;
    }

    const sensedElement = senseElements(e)

    if (dragging === '') {
      setHovering(sensedElement.element)
    } else if (dragging == 'eye') {
      setEye({
        x: Math.max(20, Math.min(canvas.width - 20, mouseX - offset.x)),
        y: Math.max(20, Math.min(canvas.height - 20, mouseY - offset.y)),
      });
    } else if (dragging == 'circle') {
      setCircle({
        ...circle,
        x: Math.max(circle.radius, Math.min(canvas.width - circle.radius, mouseX - offset.x)),
        y: Math.max(circle.radius, Math.min(canvas.height - circle.radius, mouseY - offset.y)),
      });
    }
  };

  const handlePointerUp = () => {
    setDragging('');
    // If we were in measurement mode and the user was trying to snap with Shift, it's possible
    // that they left a 0-px measurement; let's clean that up here
    if (measuringMode && measurementCoords.length > 0) {
      const lastMeas = measurementCoords.at(-1);
      const dx = lastMeas.start.x - lastMeas.end.x;
      const dy = lastMeas.start.y - lastMeas.end.y;
      if ((dx*dx + dy*dy) < 1e-8) {
        setMeasurementCoords(measurementCoords.slice(0, -1));
      }
    }
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
          cursor: measuringMode ? 'crosshair' : (dragging != '' ? 'grabbing' : (hovering != '' ? 'move' : 'default')),
          display: 'block',
        }}
      />
    </div>
  );
}